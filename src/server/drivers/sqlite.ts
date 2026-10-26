import { Database } from "bun:sqlite";
import { sql } from "drizzle-orm";
import { drizzle, type SQLiteBunDatabase } from "drizzle-orm/bun-sqlite";
import { ROW_KEY_COLUMN } from "@shared/types";
import type {
  DistinctValuesResult,
  ColumnInfo,
  DumpMode,
  ForeignKeyInfo,
  IndexInfo,
  LookupRow,
  MutateResult,
  QueryResult,
  RowChange,
  RoutineInfo,
  SchemaInfo,
  TableKind,
  SqliteConnectionConfig,
  TableDetails,
  TableInfo,
  TableRowsRequest,
  TableRowsResult,
  InsertOptions,
} from "@shared/types";
import { columnsFromRows, serializeRows, toNumber } from "../serialize";
import { clampLimit, clampOffset, DriverError, type Driver, type Progress } from "./types";
import { conflictClause } from "./upsert";
import { selectList } from "./select";
import { buildWhere, escapeLike, orderBy } from "./filters";
import { distinctQuery, pickLabelColumns, toDistinctValues } from "./distinct";

/** Column types that make a readable label for lookups and set filters. */
const SQLITE_TEXT_TYPES = /text|char|clob|string/i;

type Row = Record<string, unknown>;

export class SqliteDriver implements Driver {
  readonly dialect = "sqlite" as const;
  private sqlite: Database | null = null;
  private db: SQLiteBunDatabase | null = null;

  constructor(private readonly config: SqliteConnectionConfig) {}

  private get database(): SQLiteBunDatabase {
    if (!this.db) throw new DriverError("Not connected");
    return this.db;
  }

  async connect(): Promise<{ serverVersion: string }> {
    const { file, readonly } = this.config;
    if (!file) throw new DriverError("SQLite file path is required");
    try {
      this.sqlite = new Database(file, readonly ? { readonly: true } : { create: true, readwrite: true });
      this.db = drizzle({ client: this.sqlite });
      const row = this.db.get<{ version: string }>(sql`select sqlite_version() as version`);
      return { serverVersion: `SQLite ${row?.version ?? ""}`.trim() };
    } catch (error) {
      await this.close();
      throw wrapError(error);
    }
  }

  async close(): Promise<void> {
    const sqlite = this.sqlite;
    this.sqlite = null;
    this.db = null;
    sqlite?.close();
    this.readOnlyDb?.close();
    this.readOnlyDb = null;
  }

  async listSchemas(): Promise<SchemaInfo[]> {
    const rows = this.all(sql`pragma database_list`);
    return rows.map((r) => ({ name: String(r.name), isSystem: r.name === "temp" }));
  }

  async listTables(schema: string | null): Promise<TableInfo[]> {
    const schemaName = schema ?? "main";
    const rows = this.all(sql`
      select name, type from ${sql.identifier(schemaName)}.sqlite_master
      where type in ('table', 'view') and name not like 'sqlite\\_%' escape '\\'
      order by type, name
    `);
    return rows.map((r) => ({
      schema: schemaName,
      name: String(r.name),
      kind: r.type === "view" ? "view" : "table",
      rowEstimate: null,
      comment: null,
    }));
  }

  async tableDetails(schema: string | null, table: string): Promise<TableDetails> {
    const schemaName = schema ?? "main";
    const master = this.all(sql`
      select name, type, sql from ${sql.identifier(schemaName)}.sqlite_master
      where type in ('table', 'view') and name = ${table}
    `)[0];
    if (!master) throw new DriverError(`Relation "${schemaName}"."${table}" not found`);

    const ddl = (master.sql as string | null) ?? "";
    const columns: ColumnInfo[] = this.all(sql`select * from pragma_table_xinfo(${table}, ${schemaName})`)
      .filter((r) => toNumber(r.hidden) !== 1) // skip hidden virtual-table columns
      .map((r) => {
        const name = String(r.name);
        const enumValues = checkInValues(ddl, name);
        return {
          ordinal: (toNumber(r.cid) ?? 0) + 1,
          name,
          dataType: String(r.type || "") || "ANY",
          nullable: !Boolean(toNumber(r.notnull)),
          defaultValue: (r.dflt_value as string | null) ?? null,
          isPrimaryKey: (toNumber(r.pk) ?? 0) > 0,
          comment: null,
          enumValues,
        };
      });

    const indexRows = this.all(sql`select * from pragma_index_list(${table}, ${schemaName})`);
    const indexes: IndexInfo[] = indexRows.map((ix) => {
      const name = String(ix.name);
      const cols = this.all(sql`select * from pragma_index_info(${name}, ${schemaName})`)
        .sort((a, b) => (toNumber(a.seqno) ?? 0) - (toNumber(b.seqno) ?? 0))
        .map((c) => (c.name === null ? "<expression>" : String(c.name)));
      const def = this.all(sql`
        select sql from ${sql.identifier(schemaName)}.sqlite_master where type = 'index' and name = ${name}
      `)[0];
      return {
        name,
        columns: cols,
        unique: Boolean(toNumber(ix.unique)),
        primary: ix.origin === "pk",
        definition: (def?.sql as string | null) ?? null,
      };
    });

    const fkRows = this.all(sql`select * from pragma_foreign_key_list(${table}, ${schemaName})`);
    const grouped = new Map<string, ForeignKeyInfo>();
    for (const r of fkRows.sort((a, b) => (toNumber(a.seq) ?? 0) - (toNumber(b.seq) ?? 0))) {
      const id = String(r.id);
      const fk = grouped.get(id) ?? {
        name: `fk_${table}_${id}`,
        columns: [],
        refSchema: schemaName,
        refTable: String(r.table),
        refColumns: [],
        onDelete: (r.on_delete as string | null) ?? null,
        onUpdate: (r.on_update as string | null) ?? null,
      };
      fk.columns.push(String(r.from));
      fk.refColumns.push(r.to === null ? "<rowid>" : String(r.to));
      grouped.set(id, fk);
    }

    return {
      table: {
        schema: schemaName,
        name: String(master.name),
        kind: master.type === "view" ? "view" : "table",
        rowEstimate: null,
        comment: null,
      },
      columns,
      indexes,
      foreignKeys: [...grouped.values()],
      ddl: (master.sql as string | null) ?? null,
    };
  }

  async fetchRows(request: Omit<TableRowsRequest, "connectionId">): Promise<TableRowsResult> {
    const schemaName = request.schema ?? "main";
    const limit = clampLimit(request.limit);
    const offset = clampOffset(request.offset);
    const relation = sql`${sql.identifier(schemaName)}.${sql.identifier(request.table)}`;
    const where = buildWhere(request, "sqlite");
    const whereClause = where ? sql` where ${where}` : sql``;
    const tail = sql`${whereClause}${orderBy(request.sort)} limit ${limit} offset ${offset}`;

    if (request.select?.length) {
      // Custom projection (exports): plain select, no row keys.
      const started = performance.now();
      const rows = this.all(sql`select ${selectList(request.select)} from ${relation}${tail}`);
      const total = toNumber(this.all(sql`select count(*) as total from ${relation}${whereClause}`)[0]?.total);
      return {
        columns: columnsFromRows(rows),
        rows: serializeRows(rows),
        rowCount: rows.length,
        command: "SELECT",
        durationMs: performance.now() - started,
        total,
        keyColumns: [],
      };
    }
    const details = await this.tableDetails(schemaName, request.table);
    const primaryKey = details.columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
    let keyColumns = primaryKey;

    const started = performance.now();
    let rows: Row[];
    if (primaryKey.length || details.table.kind === "view") {
      rows = this.all(sql`select * from ${relation}${tail}`);
      if (!primaryKey.length) keyColumns = [];
    } else {
      // No primary key: address rows by rowid (fails for WITHOUT ROWID tables → read-only).
      try {
        rows = this.all(sql`select rowid as ${sql.identifier(ROW_KEY_COLUMN)}, * from ${relation}${tail}`);
        keyColumns = [ROW_KEY_COLUMN];
      } catch {
        rows = this.all(sql`select * from ${relation}${tail}`);
        keyColumns = [];
      }
    }
    const total = toNumber(this.all(sql`select count(*) as total from ${relation}${whereClause}`)[0]?.total);
    const durationMs = performance.now() - started;

    const columns = details.columns.length
      ? details.columns.map((c) => ({ name: c.name, dataType: c.dataType }))
      : columnsFromRows(rows).filter((c) => c.name !== ROW_KEY_COLUMN);
    return { columns, rows: serializeRows(rows), rowCount: rows.length, command: "SELECT", durationMs, total, keyColumns };
  }

  async mutateRows(schema: string | null, table: string, changes: RowChange[]): Promise<MutateResult> {
    const sqlite = this.sqlite;
    if (!sqlite) throw new DriverError("Not connected");
    const started = performance.now();
    const schemaName = schema ?? "main";
    const relation = sql`${sql.identifier(schemaName)}.${sql.identifier(table)}`;
    const types = new Map((await this.tableDetails(schemaName, table)).columns.map((c) => [c.name, c.dataType]));
    const bind = (column: string, value: unknown) => sql`${coerceSqliteValue(types.get(column) ?? "", value)}`;
    const keyCondition = (key: Record<string, unknown>) =>
      sql.join(
        Object.entries(key).map(([k, v]) =>
          k === ROW_KEY_COLUMN ? sql`rowid = ${Number(v)}` : sql`${sql.identifier(k)} = ${bind(k, v)}`,
        ),
        sql` and `,
      );
    const result: MutateResult = { inserted: 0, updated: 0, deleted: 0, durationMs: 0 };

    const run = sqlite.transaction(() => {
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
            this.database.run(query);
            result.inserted++;
          } else if (change.kind === "update") {
            const entries = Object.entries(change.values);
            if (!entries.length) continue;
            const res = this.database.run(
              sql`update ${relation} set ${sql.join(
                entries.map(([k, v]) => sql`${sql.identifier(k)} = ${bind(k, v)}`),
                sql`, `,
              )} where ${keyCondition(change.key)}`,
            );
            if (toNumber(res.changes) !== 1) throw new DriverError(`matched ${toNumber(res.changes) ?? 0} rows instead of exactly 1`);
            result.updated++;
          } else {
            const res = this.database.run(sql`delete from ${relation} where ${keyCondition(change.key)}`);
            if (toNumber(res.changes) !== 1) throw new DriverError(`matched ${toNumber(res.changes) ?? 0} rows instead of exactly 1`);
            result.deleted++;
          }
        } catch (error) {
          const cause = wrapError(error);
          throw new DriverError(`Change #${index + 1} (${change.kind}) failed: ${cause.message}. Nothing was saved.`, cause.code);
        }
      }
    });
    try {
      run();
    } catch (error) {
      throw wrapError(error);
    }
    result.durationMs = performance.now() - started;
    return result;
  }

  async lookupRows(schema: string | null, table: string, keyColumn: string, query: string, limit: number): Promise<LookupRow[]> {
    const schemaName = schema ?? "main";
    const relation = sql`${sql.identifier(schemaName)}.${sql.identifier(table)}`;
    const textColumns = pickLabelColumns((await this.tableDetails(schemaName, table)).columns, keyColumn, SQLITE_TEXT_TYPES);
    const searched = [keyColumn, ...textColumns];
    const pattern = `%${escapeLike(query.trim())}%`;
    const where = query.trim()
      ? sql` where ${sql.join(
          searched.map((c) => sql`cast(${sql.identifier(c)} as text) like ${pattern} ${sql.raw("escape '\\'")}`),
          sql` or `,
        )}`
      : sql``;
    const rows = this.all(
      sql`select ${sql.join(
        searched.map((c) => sql.identifier(c)),
        sql`, `,
      )} from ${relation}${where} order by ${sql.identifier(keyColumn)} limit ${limit}`,
    );
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
    const relation = sql`${sql.identifier(schema ?? "main")}.${sql.identifier(table)}`;
    const col = sql.identifier(column);
    const refSchema = ref?.schema ?? "main";
    const labelColumns = ref ? pickLabelColumns((await this.tableDetails(refSchema, ref.table)).columns, ref.column, SQLITE_TEXT_TYPES) : [];
    const query = distinctQuery({
      dialect: "sqlite",
      relation,
      column,
      search: search.trim(),
      limit,
      ref: ref ? { relation: sql`${sql.identifier(refSchema)}.${sql.identifier(ref.table)}`, column: ref.column, labelColumns } : undefined,
    });
    const values = toDistinctValues(serializeRows(this.all(query)), labelColumns.length);
    const nulls = search.trim() ? [] : this.all(sql`select 1 as x from ${relation} where ${col} is null limit 1`);
    return { values: values.slice(0, limit), hasNull: nulls.length > 0, hasMore: values.length > limit };
  }

  /** SQLite has no stored routines. */
  async listRoutines(): Promise<RoutineInfo[]> {
    return [];
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
    const schemaName = schema ?? "main";
    const relation = sql`${sql.identifier(schemaName)}.${sql.identifier(table)}`;
    const allColumns = [...columns, ...expressions.map((e) => e.column)];
    const cols = sql.join(
      allColumns.map((c) => sql.identifier(c)),
      sql`, `,
    );
    const exprSql = expressions.map((e) => sql.raw(e.sql)); // user-written SQL per row, raw by design
    const values = sql.join(
      rows.map((row) => sql`(${sql.join([...row.map((v) => sql`${toSqliteParam(v)}`), ...exprSql], sql`, `)})`),
      sql`, `,
    );
    const primaryKey =
      options.onConflict === "update"
        ? (await this.tableDetails(schemaName, table)).columns.filter((c) => c.isPrimaryKey).map((c) => c.name)
        : [];
    const conflict = conflictClause(options.onConflict, allColumns, primaryKey);
    try {
      const result = this.database.run(sql`insert into ${relation} (${cols}) values ${values}${conflict}`);
      return toNumber(result.changes) ?? rows.length;
    } catch (error) {
      throw wrapError(error);
    }
  }

  async dropTable(schema: string | null, table: string, kind: TableKind, _cascade: boolean): Promise<void> {
    const relation = sql`${sql.identifier(schema ?? "main")}.${sql.identifier(table)}`;
    this.runSql(sql`drop ${kind === "view" ? sql.raw("view") : sql.raw("table")} ${relation}`);
  }

  async truncateTable(
    schema: string | null,
    table: string,
    options: { cascade: boolean; restartIdentity: boolean },
  ): Promise<void> {
    const schemaName = schema ?? "main";
    this.runSql(sql`delete from ${sql.identifier(schemaName)}.${sql.identifier(table)}`);
    if (options.restartIdentity) {
      const hasSequence = this.all(
        sql`select 1 as x from ${sql.identifier(schemaName)}.sqlite_master where type = 'table' and name = 'sqlite_sequence'`,
      ).length;
      if (hasSequence) this.runSql(sql`delete from ${sql.identifier(schemaName)}.sqlite_sequence where name = ${table}`);
    }
  }

  async dropRoutine(): Promise<void> {
    throw new DriverError("SQLite has no stored routines");
  }

  /** Native equivalent of `sqlite3 .dump`: schema DDL followed by INSERTs, in a transaction. */
  async dumpSql(options: { path: string; mode: DumpMode }, progress: Progress): Promise<number> {
    const sqlite = this.sqlite;
    if (!sqlite) throw new DriverError("Not connected");
    const writer = Bun.file(options.path).writer();
    let bytes = 0;
    const write = (text: string) => {
      bytes += Buffer.byteLength(text);
      writer.write(text);
    };
    const objects = sqlite
      .query<{ type: string; name: string; sql: string | null; tbl_name: string }, []>(
        "select type, name, tbl_name, sql from sqlite_master where sql is not null order by rowid",
      )
      .all();
    const tables = objects.filter((o) => o.type === "table" && !o.name.startsWith("sqlite_"));
    const withSchema = options.mode !== "data-only";
    const withData = options.mode !== "schema-only";
    try {
      write("PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\n");
      for (const t of tables) {
        if (progress.signal.aborted) throw new DriverError("Cancelled");
        if (withSchema) write(`${t.sql};\n`);
        if (!withData) continue;
        const ident = quoteIdent(t.name);
        let count = 0;
        for (const row of sqlite.query(`select * from ${ident}`).iterate() as Iterable<Record<string, unknown>>) {
          write(`INSERT INTO ${ident} VALUES(${Object.values(row).map(sqlLiteral).join(",")});\n`);
          count++;
          if (count % 500 === 0) {
            await writer.flush();
            await Bun.sleep(0);
            if (progress.signal.aborted) throw new DriverError("Cancelled");
          }
        }
        progress.log(`${t.name}: ${count} rows`);
      }
      if (withData && objects.some((o) => o.name === "sqlite_sequence")) {
        write("DELETE FROM sqlite_sequence;\n");
        for (const row of sqlite.query("select name, seq from sqlite_sequence").all() as { name: string; seq: number }[]) {
          write(`INSERT INTO sqlite_sequence VALUES(${sqlLiteral(row.name)},${sqlLiteral(row.seq)});\n`);
        }
      }
      if (withSchema) {
        for (const o of objects.filter((o) => o.type !== "table" && !o.name.startsWith("sqlite_"))) {
          write(`${o.sql};\n`);
        }
        progress.log(`schema objects: ${objects.length}`);
      }
      write("COMMIT;\n");
      await writer.end();
      return bytes;
    } catch (error) {
      await Promise.resolve(writer.end()).catch(() => {});
      throw wrapError(error);
    }
  }

  /** Executes a SQL script. Statements run one by one so errors can be reported with context. */
  async restoreSql(options: { path: string; stopOnError: boolean }, progress: Progress): Promise<void> {
    const sqlite = this.sqlite;
    if (!sqlite) throw new DriverError("Not connected");
    const text = await Bun.file(options.path).text();
    const statements = splitSqlStatements(text);
    progress.log(`${statements.length} statements`);
    let ok = 0;
    let failed = 0;
    for (let i = 0; i < statements.length; i++) {
      if (progress.signal.aborted) throw new DriverError("Cancelled");
      const statement = statements[i]!;
      try {
        sqlite.run(statement);
        ok++;
      } catch (error) {
        failed++;
        const message = error instanceof Error ? error.message : String(error);
        progress.log(`statement ${i + 1} failed: ${message}\n  ${statement.slice(0, 160).replace(/\s+/g, " ")}`);
        if (options.stopOnError) throw new DriverError(`Stopped at statement ${i + 1}: ${message}`);
      }
      if (i % 500 === 0) await Bun.sleep(0);
    }
    progress.log(`done: ${ok} ok, ${failed} failed`);
    if (failed > 0 && ok === 0) throw new DriverError("Every statement failed");
  }

  private readOnlyDb: Database | null = null;

  /** Uses a second, read-only handle on the same file; in-memory databases fall back to a statement check. */
  async executeReadOnly(sqlText: string): Promise<QueryResult> {
    const { file } = this.config;
    const started = performance.now();
    try {
      if (file === ":memory:" || file.startsWith("file::memory")) {
        if (!/^\s*(select|with|explain|pragma)\b/i.test(sqlText)) throw new DriverError("Only SELECT queries are allowed here");
        return this.execute(sqlText);
      }
      this.readOnlyDb ??= new Database(file, { readonly: true });
      const statement = this.readOnlyDb.prepare(sqlText);
      const rows = statement.all() as Row[];
      const columns = statement.columnNames.map((name) => ({ name, dataType: null }));
      statement.finalize();
      return { columns, rows: serializeRows(rows), rowCount: rows.length, command: "SELECT", durationMs: performance.now() - started };
    } catch (error) {
      throw wrapError(error);
    }
  }

  private runSql(query: ReturnType<typeof sql>): void {
    try {
      this.database.run(query);
    } catch (error) {
      throw wrapError(error);
    }
  }

  async execute(sqlText: string): Promise<QueryResult> {
    const sqlite = this.sqlite;
    if (!sqlite) throw new DriverError("Not connected");
    const started = performance.now();
    try {
      // Prepare once to learn whether the statement produces rows (and its column names).
      const statement = sqlite.prepare(sqlText);
      const columnNames = statement.columnNames;
      statement.finalize();
      if (columnNames.length > 0) {
        const rows = this.database.all<Row>(sql.raw(sqlText));
        return {
          columns: columnNames.map((name) => ({ name, dataType: null })),
          rows: serializeRows(rows),
          rowCount: rows.length,
          command: "SELECT",
          durationMs: performance.now() - started,
        };
      }
      const result = this.database.run(sql.raw(sqlText));
      return {
        columns: [],
        rows: [],
        rowCount: toNumber(result.changes),
        command: commandOf(sqlText),
        durationMs: performance.now() - started,
      };
    } catch (error) {
      throw wrapError(error);
    }
  }

  private all(query: ReturnType<typeof sql>): Row[] {
    try {
      return this.database.all<Row>(query);
    } catch (error) {
      throw wrapError(error);
    }
  }
}

/** Extracts `CHECK (col IN ('a','b'))` values for a column from the CREATE TABLE text, if present. */
export function checkInValues(ddl: string, column: string): string[] | undefined {
  const ident = column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:"${ident}"|\\[${ident}\\]|\`${ident}\`|\\b${ident}\\b)\\s+in\\s*\\(([^)]*)\\)`, "i");
  const match = re.exec(ddl);
  if (!match) return undefined;
  // SQLite accepts single- or double-quoted literals in CHECK lists.
  const values = [...match[1]!.matchAll(/'((?:[^']|'')*)'|"((?:[^"]|"")*)"/g)].map((m) =>
    m[1] !== undefined ? m[1].replace(/''/g, "'") : m[2]!.replace(/""/g, '"'),
  );
  return values.length ? values : undefined;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** SQL literal for dump output. */
function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "1" : "0";
  if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString("hex")}'`;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return `'${text.replace(/'/g, "''")}'`;
}

/**
 * Split a script on top-level semicolons, honouring quotes, comments and CREATE TRIGGER … BEGIN … END blocks.
 */
export function splitSqlStatements(text: string): string[] {
  const out: string[] = [];
  let current = "";
  let i = 0;
  let inTrigger = false;
  const flush = () => {
    const trimmed = current.trim();
    if (trimmed && trimmed !== ";") out.push(trimmed);
    current = "";
  };
  while (i < text.length) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (ch === "-" && next === "-") {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`" || ch === "[") {
      const close = ch === "[" ? "]" : ch;
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === close) {
          if (text[j + 1] === close && close !== "]") {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      current += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (!inTrigger && /^create\s+(temp\s+|temporary\s+)?trigger\b/i.test(text.slice(i, i + 40)) && /\s|^/.test(text[i - 1] ?? " ")) {
      inTrigger = true;
    }
    if (ch === ";") {
      current += ch;
      if (inTrigger) {
        if (/\bend\s*;$/i.test(current.trimEnd())) {
          inTrigger = false;
          flush();
        }
      } else {
        flush();
      }
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  flush();
  return out;
}

/** Edits arrive as text; store numbers as numbers in numeric columns so type affinity is preserved. */
function coerceSqliteValue(dataType: string, value: unknown): unknown {
  if (typeof value === "string" && /int|real|numeric|decimal|double|float|num/i.test(dataType) && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    const n = Number(value);
    if (Number.isSafeInteger(n) || !Number.isInteger(n)) return n;
    return BigInt(value.trim());
  }
  return toSqliteParam(value);
}

/** bun:sqlite binds strings, numbers, bigints, null and byte arrays; everything else is coerced. */
function toSqliteParam(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === "object" && !(value instanceof Uint8Array)) return JSON.stringify(value);
  return value;
}

function commandOf(sqlText: string): string | null {
  const match = /^\s*(?:--[^\n]*\n\s*)*([a-zA-Z]+)/.exec(sqlText);
  return match?.[1]?.toUpperCase() ?? null;
}

function wrapError(error: unknown): DriverError {
  if (error instanceof DriverError) return error;
  let cause: unknown = error;
  for (let i = 0; i < 5 && cause instanceof Error && cause.cause instanceof Error; i++) cause = cause.cause;
  if (cause instanceof Error) {
    const anyErr = cause as Error & { code?: string };
    return new DriverError(cause.message, anyErr.code);
  }
  return new DriverError(String(error));
}
