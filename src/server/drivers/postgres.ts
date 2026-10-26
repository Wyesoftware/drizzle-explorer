import { SQL } from "bun";
import { conflictClause } from "./upsert";
import { selectList } from "./select";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sql";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql/postgres/driver";
import { ROW_KEY_COLUMN } from "@shared/types";
import type {
  DistinctValuesResult,
  ColumnInfo,
  ForeignKeyInfo,
  IndexInfo,
  LookupRow,
  MutateResult,
  PostgresConnectionConfig,
  QueryResult,
  RowChange,
  RoutineInfo,
  RoutineKind,
  SchemaInfo,
  TableDetails,
  TableInfo,
  TableKind,
  TableRowsRequest,
  TableRowsResult,
  ConflictMode,
  InsertOptions,
} from "@shared/types";
import { columnsFromRows, serializeRows, toNumber } from "../serialize";
import { clampLimit, clampOffset, DriverError, type Driver } from "./types";
import { buildWhere, escapeLike, orderBy } from "./filters";
import { distinctQuery, pickLabelColumns, toDistinctValues } from "./distinct";

/** Column types that make a readable label for lookups and set filters. */
const PG_TEXT_TYPES = /text|char|name|citext/i;
import { applicationName } from "../identity";

/** Sentinel used to roll back the read-only transaction in executeReadOnly. */
class ReadOnlyRollback extends Error {
  constructor() {
    super("read-only rollback");
    this.name = "ReadOnlyRollback";
  }
}

/** Shape of what Bun's SQL client returns: an array of rows with extra metadata props. */
type BunSqlResult = Record<string, unknown>[] & { count?: number; command?: string };

const KIND_MAP: Record<string, TableKind> = {
  r: "table",
  p: "table",
  v: "view",
  m: "materialized_view",
  f: "foreign_table",
};

const FK_ACTION: Record<string, string> = {
  a: "NO ACTION",
  r: "RESTRICT",
  c: "CASCADE",
  n: "SET NULL",
  d: "SET DEFAULT",
};

const SYSTEM_SCHEMAS = new Set(["pg_catalog", "information_schema"]);

export class PostgresDriver implements Driver {
  readonly dialect = "postgres" as const;
  private client: SQL | null = null;
  private db: BunSQLDatabase | null = null;

  constructor(private readonly config: PostgresConnectionConfig) {}

  private get database(): BunSQLDatabase {
    if (!this.db) throw new DriverError("Not connected");
    return this.db;
  }

  async connect(): Promise<{ serverVersion: string }> {
    const common = {
      max: 4,
      idleTimeout: 120,
      connectionTimeout: 15,
      // Shows up in pg_stat_activity.application_name as "Drizzle Explorer (<os user>)".
      connection: { application_name: applicationName() },
    };
    const { config } = this;
    this.client = config.url
      ? new SQL(config.url, common)
      : new SQL({
          adapter: "postgres",
          hostname: config.host ?? "localhost",
          port: config.port ?? 5432,
          database: config.database ?? config.user ?? "postgres",
          username: config.user ?? "postgres",
          password: config.password ?? "",
          tls: config.ssl ? true : undefined,
          ...common,
        });
    this.db = drizzle({ client: this.client });
    try {
      const rows = (await this.db.execute(sql`select version() as version`)) as BunSqlResult;
      return { serverVersion: String(rows[0]?.version ?? "PostgreSQL") };
    } catch (error) {
      await this.close();
      throw wrapError(error);
    }
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.db = null;
    if (client) await client.close().catch(() => {});
  }

  async listSchemas(): Promise<SchemaInfo[]> {
    const rows = (await this.run(sql`
      select n.nspname as name
      from pg_catalog.pg_namespace n
      where n.nspname not like 'pg\\_temp\\_%' and n.nspname not like 'pg\\_toast%'
      order by (n.nspname in ('pg_catalog', 'information_schema') or n.nspname like 'pg\\_%'), n.nspname
    `)) as BunSqlResult;
    return rows.map((r) => {
      const name = String(r.name);
      return { name, isSystem: SYSTEM_SCHEMAS.has(name) || name.startsWith("pg_") };
    });
  }

  async listTables(schema: string | null): Promise<TableInfo[]> {
    const schemaName = schema ?? "public";
    const rows = (await this.run(sql`
      select c.relname as name, c.relkind::text as kind, c.reltuples::bigint as row_estimate,
             pg_catalog.obj_description(c.oid, 'pg_class') as comment
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = ${schemaName} and c.relkind in ('r', 'p', 'v', 'm', 'f')
      order by c.relname
    `)) as BunSqlResult;
    return rows.map((r) => {
      const estimate = toNumber(r.row_estimate);
      return {
        schema: schemaName,
        name: String(r.name),
        kind: KIND_MAP[String(r.kind)] ?? "table",
        rowEstimate: estimate === null || estimate < 0 ? null : estimate,
        comment: (r.comment as string | null) ?? null,
      };
    });
  }

  async tableDetails(schema: string | null, table: string): Promise<TableDetails> {
    const schemaName = schema ?? "public";
    const [tables, columns, indexes, foreignKeys] = await Promise.all([
      this.listTables(schemaName),
      this.columns(schemaName, table),
      this.indexes(schemaName, table),
      this.foreignKeys(schemaName, table),
    ]);
    const tableInfo = tables.find((t) => t.name === table);
    if (!tableInfo) throw new DriverError(`Relation "${schemaName}"."${table}" not found`);
    return { table: tableInfo, columns, indexes, foreignKeys, ddl: null };
  }

  private async columns(schema: string, table: string): Promise<ColumnInfo[]> {
    const rows = (await this.run(sql`
      select a.attnum as ordinal, a.attname as name,
             pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
             not a.attnotnull as nullable,
             pg_catalog.pg_get_expr(d.adbin, d.adrelid) as default_value,
             pg_catalog.col_description(a.attrelid, a.attnum) as comment,
             exists (
               select 1 from pg_catalog.pg_index i
               where i.indrelid = a.attrelid and i.indisprimary and a.attnum = any (i.indkey)
             ) as is_primary_key,
             (select array_agg(e.enumlabel order by e.enumsortorder) from pg_catalog.pg_enum e where e.enumtypid = a.atttypid) as enum_values
      from pg_catalog.pg_attribute a
      join pg_catalog.pg_class c on c.oid = a.attrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where n.nspname = ${schema} and c.relname = ${table} and a.attnum > 0 and not a.attisdropped
      order by a.attnum
    `)) as BunSqlResult;
    return rows.map((r) => ({
      ordinal: toNumber(r.ordinal) ?? 0,
      name: String(r.name),
      dataType: String(r.data_type),
      nullable: Boolean(r.nullable),
      defaultValue: (r.default_value as string | null) ?? null,
      isPrimaryKey: Boolean(r.is_primary_key),
      comment: (r.comment as string | null) ?? null,
      enumValues: r.enum_values ? toStringArray(r.enum_values) : undefined,
    }));
  }

  async lookupRows(schema: string | null, table: string, keyColumn: string, query: string, limit: number): Promise<LookupRow[]> {
    const schemaName = schema ?? "public";
    const relation = sql`${sql.identifier(schemaName)}.${sql.identifier(table)}`;
    const textColumns = pickLabelColumns(await this.columns(schemaName, table), keyColumn, PG_TEXT_TYPES);
    const searched = [keyColumn, ...textColumns];
    const pattern = `%${escapeLike(query.trim())}%`;
    const where = query.trim()
      ? sql` where ${sql.join(
          searched.map((c) => sql`cast(${sql.identifier(c)} as text) ilike ${pattern} ${sql.raw("escape '\\'")}`),
          sql` or `,
        )}`
      : sql``;
    const rows = (await this.run(
      sql`select ${sql.join(
        searched.map((c) => sql.identifier(c)),
        sql`, `,
      )} from ${relation}${where} order by ${sql.identifier(keyColumn)} limit ${limit}`,
    )) as BunSqlResult;
    return serializeRows(rows).map((r) => ({
      key: r[keyColumn],
      label: textColumns
        .map((c) => r[c])
        .filter((v) => v !== null && v !== undefined && v !== "")
        .join(" · "),
    }));
  }

  async distinctValues(
    schema: string | null,
    table: string,
    column: string,
    search: string,
    limit: number,
    ref?: { schema: string | null; table: string; column: string },
  ): Promise<DistinctValuesResult> {
    const relation = sql`${sql.identifier(schema ?? "public")}.${sql.identifier(table)}`;
    const col = sql.identifier(column);
    const refSchema = ref?.schema ?? "public";
    const labelColumns = ref ? pickLabelColumns(await this.columns(refSchema, ref.table), ref.column, PG_TEXT_TYPES) : [];
    const query = distinctQuery({
      dialect: "postgres",
      relation,
      column,
      search: search.trim(),
      limit,
      ref: ref ? { relation: sql`${sql.identifier(refSchema)}.${sql.identifier(ref.table)}`, column: ref.column, labelColumns } : undefined,
    });
    const values = toDistinctValues(serializeRows((await this.run(query)) as BunSqlResult), labelColumns.length);
    const nulls = search.trim()
      ? []
      : ((await this.run(sql`select 1 as x from ${relation} where ${col} is null limit 1`)) as BunSqlResult);
    return { values: values.slice(0, limit), hasNull: nulls.length > 0, hasMore: values.length > limit };
  }

  private async indexes(schema: string, table: string): Promise<IndexInfo[]> {
    const rows = (await this.run(sql`
      select i.relname as name, ix.indisunique as is_unique, ix.indisprimary as is_primary,
             pg_catalog.pg_get_indexdef(ix.indexrelid) as definition,
             array(
               select pg_catalog.pg_get_indexdef(ix.indexrelid, k, true)
               from generate_series(1, ix.indnatts) as k
             ) as columns
      from pg_catalog.pg_index ix
      join pg_catalog.pg_class t on t.oid = ix.indrelid
      join pg_catalog.pg_class i on i.oid = ix.indexrelid
      join pg_catalog.pg_namespace n on n.oid = t.relnamespace
      where n.nspname = ${schema} and t.relname = ${table}
      order by ix.indisprimary desc, i.relname
    `)) as BunSqlResult;
    return rows.map((r) => ({
      name: String(r.name),
      columns: toStringArray(r.columns),
      unique: Boolean(r.is_unique),
      primary: Boolean(r.is_primary),
      definition: (r.definition as string | null) ?? null,
    }));
  }

  private async foreignKeys(schema: string, table: string): Promise<ForeignKeyInfo[]> {
    const rows = (await this.run(sql`
      select con.conname as name,
             (select array_agg(a.attname order by u.ord)
                from unnest(con.conkey) with ordinality as u(attnum, ord)
                join pg_catalog.pg_attribute a on a.attrelid = con.conrelid and a.attnum = u.attnum) as columns,
             rn.nspname as ref_schema, rc.relname as ref_table,
             (select array_agg(a.attname order by u.ord)
                from unnest(con.confkey) with ordinality as u(attnum, ord)
                join pg_catalog.pg_attribute a on a.attrelid = con.confrelid and a.attnum = u.attnum) as ref_columns,
             con.confdeltype::text as on_delete, con.confupdtype::text as on_update
      from pg_catalog.pg_constraint con
      join pg_catalog.pg_class c on c.oid = con.conrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      join pg_catalog.pg_class rc on rc.oid = con.confrelid
      join pg_catalog.pg_namespace rn on rn.oid = rc.relnamespace
      where con.contype = 'f' and n.nspname = ${schema} and c.relname = ${table}
      order by con.conname
    `)) as BunSqlResult;
    return rows.map((r) => ({
      name: String(r.name),
      columns: toStringArray(r.columns),
      refSchema: String(r.ref_schema),
      refTable: String(r.ref_table),
      refColumns: toStringArray(r.ref_columns),
      onDelete: FK_ACTION[String(r.on_delete)] ?? null,
      onUpdate: FK_ACTION[String(r.on_update)] ?? null,
    }));
  }

  async fetchRows(request: Omit<TableRowsRequest, "connectionId">): Promise<TableRowsResult> {
    const schemaName = request.schema ?? "public";
    const limit = clampLimit(request.limit);
    const offset = clampOffset(request.offset);
    const relation = sql`${sql.identifier(schemaName)}.${sql.identifier(request.table)}`;
    const where = buildWhere(request, "postgres");
    const whereClause = where ? sql` where ${where}` : sql``;
    const tail = sql`${whereClause}${orderBy(request.sort)} limit ${limit} offset ${offset}`;

    const started = performance.now();
    if (request.select?.length) {
      // Custom projection (exports): plain select, no row keys.
      const [rows, countRows] = (await Promise.all([
        this.run(sql`select ${selectList(request.select)} from ${relation}${tail}`),
        this.run(sql`select count(*)::bigint as total from ${relation}${whereClause}`),
      ])) as [BunSqlResult, BunSqlResult];
      return {
        columns: columnsFromRows(rows),
        rows: serializeRows(rows),
        rowCount: rows.length,
        command: "SELECT",
        durationMs: performance.now() - started,
        total: toNumber(countRows[0]?.total),
        keyColumns: [],
      };
    }
    const columnInfos = await this.columns(schemaName, request.table);
    const primaryKey = columnInfos.filter((c) => c.isPrimaryKey).map((c) => c.name);
    let keyColumns = primaryKey;
    let rowsPromise: Promise<unknown>;
    if (primaryKey.length) {
      rowsPromise = this.run(sql`select * from ${relation}${tail}`);
    } else {
      // No primary key: address rows by ctid. Views have no ctid, so fall back to read-only rows.
      keyColumns = [ROW_KEY_COLUMN];
      rowsPromise = this.run(sql`select *, ctid::text as ${sql.identifier(ROW_KEY_COLUMN)} from ${relation}${tail}`).catch(
        () => {
          keyColumns = [];
          return this.run(sql`select * from ${relation}${tail}`);
        },
      );
    }
    const [rows, countRows] = (await Promise.all([
      rowsPromise,
      this.run(sql`select count(*)::bigint as total from ${relation}${whereClause}`),
    ])) as [BunSqlResult, BunSqlResult];
    const durationMs = performance.now() - started;

    const columns = columnInfos.length
      ? columnInfos.map((c) => ({ name: c.name, dataType: c.dataType }))
      : columnsFromRows(rows).filter((c) => c.name !== ROW_KEY_COLUMN);
    return {
      columns,
      rows: serializeRows(rows),
      rowCount: rows.length,
      command: "SELECT",
      durationMs,
      total: toNumber(countRows[0]?.total),
      keyColumns,
    };
  }

  async mutateRows(schema: string | null, table: string, changes: RowChange[]): Promise<MutateResult> {
    const started = performance.now();
    const schemaName = schema ?? "public";
    const relation = sql`${sql.identifier(schemaName)}.${sql.identifier(table)}`;
    const types = new Map((await this.columns(schemaName, table)).map((c) => [c.name, c.dataType]));
    const bind = (column: string, value: unknown) => sql`${paramCoercer(types.get(column) ?? "")(value)}`;
    const keyCondition = (key: Record<string, unknown>) =>
      sql.join(
        Object.entries(key).map(([k, v]) =>
          k === ROW_KEY_COLUMN ? sql`ctid = ${String(v)}::tid` : sql`${sql.identifier(k)} = ${bind(k, v)}`,
        ),
        sql` and `,
      );
    const result: MutateResult = { inserted: 0, updated: 0, deleted: 0, durationMs: 0 };

    await this.database.transaction(async (tx) => {
      for (const [index, change] of changes.entries()) {
        try {
          if (change.kind === "insert") {
            const entries = Object.entries(change.values);
            const query = entries.length
              ? sql`insert into ${relation} (${sql.join(
                  entries.map(([k]) => sql.identifier(k)),
                  sql`, `,
                )}) values (${sql.join(
                  entries.map(([k, v]) => bind(k, v)),
                  sql`, `,
                )})`
              : sql`insert into ${relation} default values`;
            await tx.execute(query);
            result.inserted++;
          } else if (change.kind === "update") {
            const entries = Object.entries(change.values);
            if (!entries.length) continue;
            const res = (await tx.execute(
              sql`update ${relation} set ${sql.join(
                entries.map(([k, v]) => sql`${sql.identifier(k)} = ${bind(k, v)}`),
                sql`, `,
              )} where ${keyCondition(change.key)}`,
            )) as unknown as BunSqlResult;
            if (res.count !== 1) throw new DriverError(`matched ${res.count ?? 0} rows instead of exactly 1`);
            result.updated++;
          } else {
            const res = (await tx.execute(sql`delete from ${relation} where ${keyCondition(change.key)}`)) as unknown as BunSqlResult;
            if (res.count !== 1) throw new DriverError(`matched ${res.count ?? 0} rows instead of exactly 1`);
            result.deleted++;
          }
        } catch (error) {
          const cause = wrapError(error);
          throw new DriverError(`Change #${index + 1} (${change.kind}) failed: ${cause.message}. Nothing was saved.`, cause.code, cause.detail);
        }
      }
    });
    result.durationMs = performance.now() - started;
    return result;
  }

  async listRoutines(schema: string | null): Promise<RoutineInfo[]> {
    const schemaName = schema ?? "public";
    const rows = (await this.run(sql`
      select p.proname as name, p.prokind::text as kind, l.lanname as language,
             pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_args,
             case when p.prokind = 'p' then null else pg_catalog.pg_get_function_result(p.oid) end as return_type,
             case when p.prokind in ('f', 'p', 'w') then pg_catalog.pg_get_functiondef(p.oid) else null end as definition,
             pg_catalog.obj_description(p.oid, 'pg_proc') as comment
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      join pg_catalog.pg_language l on l.oid = p.prolang
      where n.nspname = ${schemaName}
        and not exists (select 1 from pg_catalog.pg_depend d where d.objid = p.oid and d.deptype = 'e')
      order by p.proname, 4
    `)) as BunSqlResult;
    return rows.map((r) => {
      const returnType = (r.return_type as string | null) ?? null;
      let kind: RoutineKind = "function";
      if (r.kind === "p") kind = "procedure";
      else if (r.kind === "a") kind = "aggregate";
      else if (r.kind === "w") kind = "window";
      else if (returnType === "trigger" || returnType === "event_trigger") kind = "trigger";
      return {
        schema: schemaName,
        name: String(r.name),
        kind,
        identityArgs: String(r.identity_args ?? ""),
        returnType,
        language: String(r.language),
        definition: (r.definition as string | null) ?? null,
        comment: (r.comment as string | null) ?? null,
      };
    });
  }

  async insertRows(
    schema: string | null,
    table: string,
    columns: string[],
    rows: unknown[][],
    options: InsertOptions = {},
  ): Promise<number> {
    const expressions = options.expressions ?? [];
    if (rows.length === 0 || columns.length + expressions.length === 0) return 0;
    const schemaName = schema ?? "public";
    const relation = sql`${sql.identifier(schemaName)}.${sql.identifier(table)}`;
    const columnInfos = await this.columns(schemaName, table);
    const types = new Map(columnInfos.map((c) => [c.name, c.dataType]));
    const coercers = columns.map((c) => paramCoercer(types.get(c) ?? ""));
    const allColumns = [...columns, ...expressions.map((e) => e.column)];
    const cols = sql.join(
      allColumns.map((c) => sql.identifier(c)),
      sql`, `,
    );
    // Expression columns are user-written SQL evaluated per row (e.g. now(), 'constant'); they are raw by design.
    const exprSql = expressions.map((e) => sql.raw(e.sql));
    const values = sql.join(
      rows.map((row) => sql`(${sql.join([...row.map((v, i) => sql`${coercers[i]!(v)}`), ...exprSql], sql`, `)})`),
      sql`, `,
    );
    const conflict = conflictClause(options.onConflict, allColumns, columnInfos.filter((c) => c.isPrimaryKey).map((c) => c.name));
    const result = (await this.run(sql`insert into ${relation} (${cols}) values ${values}${conflict}`)) as BunSqlResult;
    return result.count ?? rows.length;
  }

  async dropTable(schema: string | null, table: string, kind: TableKind, cascade: boolean): Promise<void> {
    const relation = sql`${sql.identifier(schema ?? "public")}.${sql.identifier(table)}`;
    const keyword =
      kind === "view"
        ? sql.raw("view")
        : kind === "materialized_view"
          ? sql.raw("materialized view")
          : kind === "foreign_table"
            ? sql.raw("foreign table")
            : sql.raw("table");
    await this.run(sql`drop ${keyword} ${relation}${cascade ? sql.raw(" cascade") : sql``}`);
  }

  async truncateTable(
    schema: string | null,
    table: string,
    options: { cascade: boolean; restartIdentity: boolean },
  ): Promise<void> {
    const relation = sql`${sql.identifier(schema ?? "public")}.${sql.identifier(table)}`;
    await this.run(
      sql`truncate table ${relation}${options.restartIdentity ? sql.raw(" restart identity") : sql``}${
        options.cascade ? sql.raw(" cascade") : sql``
      }`,
    );
  }

  async dropRoutine(schema: string | null, name: string, identityArgs: string, kind: RoutineKind): Promise<void> {
    const keyword = kind === "procedure" ? "procedure" : kind === "aggregate" ? "aggregate" : "function";
    // identityArgs comes from pg_get_function_identity_arguments and is required to disambiguate overloads.
    await this.run(
      sql`drop ${sql.raw(keyword)} ${sql.identifier(schema ?? "public")}.${sql.identifier(name)}(${sql.raw(identityArgs)})`,
    );
  }

  async execute(sqlText: string): Promise<QueryResult> {
    const started = performance.now();
    let result: BunSqlResult;
    try {
      // With no bind parameters Bun may already use the simple protocol and return one result per statement.
      result = pickLastResult((await this.database.execute(sql.raw(sqlText))) as BunSqlResult | BunSqlResult[]);
    } catch (error) {
      // The extended protocol rejects multi-statement scripts; retry with the simple protocol,
      // which returns one result per statement. Surface the last statement that produced rows.
      if (this.client && isMultiStatementError(error)) {
        const results = (await this.client.unsafe(sqlText).simple()) as unknown as BunSqlResult | BunSqlResult[];
        result = pickLastResult(results);
      } else {
        throw wrapError(error);
      }
    }
    const durationMs = performance.now() - started;
    const rows = Array.isArray(result) ? result : [];
    const command = result.command ?? null;
    const isSelect = rows.length > 0 || command === "SELECT";
    return {
      columns: columnsFromRows(rows),
      rows: serializeRows(rows),
      rowCount: isSelect ? rows.length : (result.count ?? null),
      command,
      durationMs,
    };
  }

  /** Statements run inside a READ ONLY transaction that is always rolled back. */
  async executeReadOnly(sqlText: string): Promise<QueryResult> {
    const started = performance.now();
    let result: BunSqlResult = [] as unknown as BunSqlResult;
    try {
      await this.database.transaction(
        async (tx) => {
          result = pickLastResult((await tx.execute(sql.raw(sqlText))) as BunSqlResult | BunSqlResult[]);
          // Throwing makes drizzle roll back; our own sentinel class survives minification (a class-name
          // check against drizzle's TransactionRollbackError did not).
          throw new ReadOnlyRollback();
        },
        { accessMode: "read only" },
      );
    } catch (error) {
      if (!(error instanceof ReadOnlyRollback)) throw wrapError(error);
    }
    const rows = Array.isArray(result) ? result : [];
    return {
      columns: columnsFromRows(rows),
      rows: serializeRows(rows),
      rowCount: rows.length,
      command: result.command ?? "SELECT",
      durationMs: performance.now() - started,
    };
  }

  private async run(query: ReturnType<typeof sql>): Promise<unknown> {
    try {
      return await this.database.execute(query);
    } catch (error) {
      throw wrapError(error);
    }
  }
}

/**
 * Bun's SQL client encodes parameters according to the column type PostgreSQL reports for the
 * prepared statement: json/jsonb values are JSON-encoded (so a JS string would become a JSON string
 * scalar), everything else is sent as text. Pick a coercion per target column so imported/transferred
 * values land correctly whether they arrive as strings (CSV/XLSX) or structured values (JSON/table).
 */
function paramCoercer(dataType: string): (value: unknown) => unknown {
  const type = dataType.toLowerCase();
  if (type === "json" || type === "jsonb") {
    return (value) => {
      if (value === null || value === undefined) return null;
      if (typeof value === "string") {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      }
      return value;
    };
  }
  if (type.endsWith("[]")) {
    return (value) => {
      if (value === null || value === undefined) return null;
      if (Array.isArray(value)) return pgArrayLiteral(value);
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed.startsWith("[")) {
          try {
            const parsed: unknown = JSON.parse(trimmed);
            if (Array.isArray(parsed)) return pgArrayLiteral(parsed);
          } catch {
            // fall through: treat as a literal
          }
        }
        return value;
      }
      return pgArrayLiteral([value]);
    };
  }
  return toPgParam;
}

/** Default binding: text, so PostgreSQL infers the type from the target column. */
function toPgParam(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Uint8Array) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return pgArrayLiteral(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function pgArrayLiteral(values: unknown[]): string {
  const items = values.map((v) => {
    if (v === null || v === undefined) return "NULL";
    if (Array.isArray(v)) return pgArrayLiteral(v);
    const text = typeof v === "object" ? JSON.stringify(v) : String(v);
    return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  });
  return `{${items.join(",")}}`;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value.startsWith("{") && value.endsWith("}")) {
    return value
      .slice(1, -1)
      .split(",")
      .filter(Boolean)
      .map((s) => s.replace(/^"(.*)"$/, "$1"));
  }
  return [];
}

function pickLastResult(results: BunSqlResult | BunSqlResult[]): BunSqlResult {
  if (Array.isArray(results) && results.length > 0 && Array.isArray(results[0])) {
    const list = results as BunSqlResult[];
    return list.findLast((r) => r.length > 0) ?? list[list.length - 1]!;
  }
  return results as BunSqlResult;
}

function isMultiStatementError(error: unknown): boolean {
  const message = rootCause(error).message;
  return /multiple commands|cannot insert multiple commands/i.test(message);
}

/** drizzle wraps driver errors in DrizzleQueryError("Failed query: …", { cause }); unwrap to the real one. */
function rootCause(error: unknown): Error {
  let current: unknown = error;
  for (let i = 0; i < 5 && current instanceof Error && current.cause instanceof Error; i++) current = current.cause;
  return current instanceof Error ? current : new Error(String(error));
}

function wrapError(error: unknown): DriverError {
  if (error instanceof DriverError) return error;
  const cause = rootCause(error) as Error & {
    code?: string;
    detail?: string;
    hint?: string;
    errno?: string;
    position?: string;
  };
  const detail = [cause.detail, cause.hint, cause.position ? `at position ${cause.position}` : null]
    .filter(Boolean)
    .join("\n") || undefined;
  return new DriverError(cause.message, cause.code ?? cause.errno, detail);
}

