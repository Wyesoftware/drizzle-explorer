import type { Dialect, DistinctValuesResult, DumpMode, LookupRow, MutateResult, QueryResult, RowChange, RoutineInfo, RoutineKind, SchemaInfo, TableDetails, TableInfo, TableKind, TableRowsRequest, TableRowsResult, InsertOptions } from "@shared/types";

/** Progress/cancellation handle passed to long-running driver operations. */
export interface Progress {
  log(line: string): void;
  signal: AbortSignal;
}

export interface Driver {
  readonly dialect: Dialect;
  connect(): Promise<{ serverVersion: string }>;
  close(): Promise<void>;
  listSchemas(): Promise<SchemaInfo[]>;
  listTables(schema: string | null): Promise<TableInfo[]>;
  tableDetails(schema: string | null, table: string): Promise<TableDetails>;
  listRoutines(schema: string | null): Promise<RoutineInfo[]>;
  fetchRows(request: Omit<TableRowsRequest, "connectionId">): Promise<TableRowsResult>;
  execute(sqlText: string): Promise<QueryResult>;
  /** Run a query without allowing writes (read-only transaction / read-only connection). */
  executeReadOnly(sqlText: string): Promise<QueryResult>;
  /** Bulk insert. Rows are arrays aligned with `columns`. Returns the number of inserted rows. */
  insertRows(schema: string | null, table: string, columns: string[], rows: unknown[][], options?: InsertOptions): Promise<number>;
  /** Search a table by key or text columns, for foreign-key pickers. */
  lookupRows(schema: string | null, table: string, keyColumn: string, query: string, limit: number): Promise<LookupRow[]>;
  /** Distinct non-null values of a column (ordered), plus whether NULL occurs; for set filters. */
  distinctValues(
    schema: string | null,
    table: string,
    column: string,
    search: string,
    limit: number,
    ref?: { schema: string | null; table: string; column: string },
  ): Promise<DistinctValuesResult>;
  /** Apply inserts/updates/deletes in one transaction. Updates and deletes must affect exactly one row each. */
  mutateRows(schema: string | null, table: string, changes: RowChange[]): Promise<MutateResult>;
  dropTable(schema: string | null, table: string, kind: TableKind, cascade: boolean): Promise<void>;
  truncateTable(
    schema: string | null,
    table: string,
    options: { cascade: boolean; restartIdentity: boolean },
  ): Promise<void>;
  dropRoutine(schema: string | null, name: string, identityArgs: string, kind: RoutineKind): Promise<void>;
  /** Native SQL dump (dialects without external tools). Returns bytes written. */
  dumpSql?(options: { path: string; mode: DumpMode }, progress: Progress): Promise<number>;
  /** Native SQL script restore. */
  restoreSql?(options: { path: string; stopOnError: boolean }, progress: Progress): Promise<void>;
}

export class DriverError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = "DriverError";
  }
}

export function clampLimit(limit: number, max = 10_000): number {
  if (!Number.isFinite(limit) || limit <= 0) return 200;
  return Math.min(Math.floor(limit), max);
}

export function clampOffset(offset: number): number {
  if (!Number.isFinite(offset) || offset < 0) return 0;
  return Math.floor(offset);
}
