/** Types shared between the Bun backend (server) and the React UI. */

export type Dialect = "postgres" | "sqlite";

export interface PostgresConnectionConfig {
  id: string;
  name: string;
  dialect: "postgres";
  /** Full connection URL. When set, host/port/etc. are ignored. */
  url?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean;
  createdAt: string;
}

export interface SqliteConnectionConfig {
  id: string;
  name: string;
  dialect: "sqlite";
  /** Absolute path to the database file, or ":memory:". */
  file: string;
  readonly?: boolean;
  createdAt: string;
}

export type ConnectionConfig = PostgresConnectionConfig | SqliteConnectionConfig;

export interface ConnectionStatus {
  id: string;
  connected: boolean;
  serverVersion?: string;
  error?: string;
}

export interface SchemaInfo {
  name: string;
  isSystem: boolean;
}

export type TableKind = "table" | "view" | "materialized_view" | "foreign_table";

export interface TableInfo {
  /** null for dialects without schemas (sqlite) */
  schema: string | null;
  name: string;
  kind: TableKind;
  /** Estimated row count where cheaply available. */
  rowEstimate: number | null;
  comment?: string | null;
}

export interface ColumnInfo {
  ordinal: number;
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  comment?: string | null;
  /** Allowed values for enum columns (PostgreSQL enum types, SQLite CHECK (col IN (...))). */
  enumValues?: string[];
}

/** A candidate row from a referenced table, for foreign-key pickers. */
export interface LookupRow {
  key: unknown;
  label: string;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
  definition: string | null;
}

export interface ForeignKeyInfo {
  name: string;
  columns: string[];
  refSchema: string | null;
  refTable: string;
  refColumns: string[];
  onDelete: string | null;
  onUpdate: string | null;
}

export interface TableDetails {
  table: TableInfo;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  foreignKeys: ForeignKeyInfo[];
  /** CREATE statement where the dialect exposes it (sqlite). */
  ddl: string | null;
}

export interface ResultColumn {
  name: string;
  dataType: string | null;
}

/** A row is a plain object keyed by column name. Values are JSON-safe (see serializeValue). */
export type ResultRow = Record<string, unknown>;

export interface QueryResult {
  columns: ResultColumn[];
  rows: ResultRow[];
  /** Rows affected for DML, or number of rows returned. null when unknown. */
  rowCount: number | null;
  /** Command tag such as SELECT / INSERT / UPDATE when the driver exposes it. */
  command: string | null;
  durationMs: number;
}

export interface SortSpec {
  column: string;
  direction: "asc" | "desc";
}

export type FilterOp =
  | "eq"
  | "neq"
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "contains"
  | "starts"
  | "ends"
  | "like"
  | "in"
  | "is_null"
  | "is_not_null";

export interface FilterSpec {
  column: string;
  op: FilterOp;
  /** Text value; the database casts it to the column type. Comma-separated for `in` unless `values` is set. */
  value?: string;
  /** Explicit list for `in` (values may contain commas); takes precedence over `value`. */
  values?: string[];
  /** Also match NULL: the condition becomes `(… or col is null)`. Set filters use it for the "(NULL)" entry. */
  orNull?: boolean;
}

/** One candidate of a set filter: the column value plus, for foreign keys, a label from the referenced row. */
export interface DistinctValue {
  value: unknown;
  /** Text columns of the referenced row joined with " · "; null when the column is not a foreign key. */
  label: string | null;
}

/** Distinct values of one column, for set filters. `values` excludes NULL; `hasNull` reports it separately. */
export interface DistinctValuesResult {
  values: DistinctValue[];
  hasNull: boolean;
  /** More distinct values exist than `limit` allowed. */
  hasMore: boolean;
}

export const FILTER_OPS: { op: FilterOp; label: string; needsValue: boolean }[] = [
  { op: "eq", label: "=", needsValue: true },
  { op: "neq", label: "≠", needsValue: true },
  { op: "lt", label: "<", needsValue: true },
  { op: "lte", label: "≤", needsValue: true },
  { op: "gt", label: ">", needsValue: true },
  { op: "gte", label: "≥", needsValue: true },
  { op: "contains", label: "contains", needsValue: true },
  { op: "starts", label: "starts with", needsValue: true },
  { op: "ends", label: "ends with", needsValue: true },
  { op: "like", label: "LIKE", needsValue: true },
  { op: "in", label: "IN (a, b, …)", needsValue: true },
  { op: "is_null", label: "IS NULL", needsValue: false },
  { op: "is_not_null", label: "IS NOT NULL", needsValue: false },
];

export interface RowFilter {
  filters?: FilterSpec[];
  /** Raw SQL appended as `AND (…)`. Runs as-is against the user's database. */
  where?: string;
}

/** One output column of an export: a table column or a raw SQL expression, under `name`. */
export interface ExportColumn {
  /** Column name in the file. */
  name: string;
  /** Table column to read; null when `expression` is used. */
  source: string | null;
  /** Raw SQL evaluated by the database per row (e.g. `upper(label)`, `now()`); null when `source` is used. */
  expression: string | null;
}

export interface TableRowsRequest extends RowFilter {
  connectionId: string;
  schema: string | null;
  table: string;
  limit: number;
  offset: number;
  sort?: SortSpec[];
  /** Custom select list (exports). When set, rows are read-only: no key columns are returned. */
  select?: ExportColumn[];
}

export type RoutineKind = "function" | "procedure" | "aggregate" | "window" | "trigger";

export interface RoutineInfo {
  schema: string | null;
  name: string;
  kind: RoutineKind;
  /** Argument list as the database prints it, e.g. "integer, text". */
  identityArgs: string;
  returnType: string | null;
  language: string;
  /** Full CREATE statement where available. */
  definition: string | null;
  comment: string | null;
}

export type ExportFormat = "csv" | "json" | "xlsx";

export type ExportSource =
  | ({ kind: "table"; connectionId: string; schema: string | null; table: string; sort?: SortSpec[]; limit?: number } & RowFilter)
  | { kind: "sql"; connectionId: string; sql: string };

export interface ExportRequest {
  source: ExportSource;
  format: ExportFormat;
  /** Absolute destination path. */
  path: string;
  /** Output columns for table sources (default: every table column as is). Ignored for SQL sources. */
  columns?: ExportColumn[];
}

export interface ExportResult {
  path: string;
  rows: number;
  bytes: number;
  durationMs: number;
}

export interface ImportInspectResult {
  format: ExportFormat;
  columns: string[];
  rowCount: number;
  sample: ResultRow[];
}

/** One target column of an import/transfer: filled from a source column or from a SQL expression. */
export interface ColumnMapping {
  /** Column name in the target table. */
  target: string;
  /** Column name in the source (file column or source table column); null when `expression` is used. */
  source: string | null;
  /**
   * Raw SQL evaluated by the target database for every row instead of a source value, e.g. `now()`,
   * `'imported'`, `gen_random_uuid()`. Null when `source` is used.
   */
  expression: string | null;
}

/** What INSERT does when a row violates the primary key / a unique constraint. */
export type ConflictMode = "error" | "ignore" | "update";

export interface InsertOptions {
  /** Extra target columns filled with raw SQL per row (appended after the bound columns). */
  expressions?: { column: string; sql: string }[];
  /** Default "error". "update" upserts on the table's primary key and needs one. */
  onConflict?: ConflictMode;
}

export interface ImportRequest {
  connectionId: string;
  schema: string | null;
  table: string;
  path: string;
  format?: ExportFormat;
  mapping: ColumnMapping[];
  /** Treat empty strings as NULL (CSV/XLSX). */
  emptyAsNull: boolean;
  onConflict?: ConflictMode;
}

export interface ImportResult {
  inserted: number;
  durationMs: number;
}

export interface TransferRequest {
  source: ExportSource;
  target: { connectionId: string; schema: string | null; table: string };
  mapping: ColumnMapping[];
  onConflict?: ConflictMode;
}

export interface TransferResult {
  copied: number;
  durationMs: number;
}

export type JobKind = "dump" | "restore" | "update";
export type JobState = "running" | "done" | "failed" | "cancelled";

export interface JobInfo {
  id: string;
  kind: JobKind;
  title: string;
  state: JobState;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  result?: { path?: string; bytes?: number };
  /** Total log lines produced so far (some may have been dropped from the buffer). */
  lineCount: number;
}

export interface JobStatus extends JobInfo {
  /** Log lines starting at the requested offset. */
  lines: string[];
  nextOffset: number;
}

export type DumpScope = { kind: "database" } | { kind: "schema"; schema: string };
export type DumpMode = "full" | "schema-only" | "data-only";
/** `sql` = plain SQL script; `custom` = pg_dump custom archive (PostgreSQL only). */
export type DumpFormat = "sql" | "custom";

export interface DumpRequest {
  connectionId: string;
  scope: DumpScope;
  mode: DumpMode;
  format: DumpFormat;
  path: string;
  /** PostgreSQL: --no-owner / --no-privileges. */
  noOwner: boolean;
  noPrivileges: boolean;
}

export interface RestoreRequest {
  connectionId: string;
  path: string;
  /** Auto-detected from the file when omitted. */
  format?: DumpFormat;
  /** PostgreSQL custom archives: drop objects before recreating (--clean --if-exists). */
  clean: boolean;
  /** Stop at the first error instead of continuing. */
  stopOnError: boolean;
}

// ---- AI assistant -------------------------------------------------------------------------------

export type AiMessagePart =
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; input: unknown; output?: string; isError?: boolean };

export interface AiMessage {
  id: string;
  role: "user" | "assistant";
  parts: AiMessagePart[];
  createdAt: string;
  /** Assistant turns: cost and timing reported by the SDK. */
  stats?: { costUsd?: number; durationMs?: number; turns?: number };
  error?: string;
}

export type AiEffort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AiSessionInfo {
  id: string;
  title: string;
  /** null = app default from settings. */
  model: string | null;
  /** null = app default from settings. */
  effort: AiEffort | null;
  createdAt: string;
  updatedAt: string;
  running: boolean;
  messageCount: number;
}

export type AiAuthMode = "subscription" | "apiKey";

export interface AiSettings {
  authMode: AiAuthMode;
  /** Stored locally in plain text, like connection passwords. */
  apiKey: string | null;
  defaultModel: string | null;
  defaultEffort: AiEffort | null;
}

export interface AiAccount {
  loggedIn: boolean;
  authMethod?: string;
  email?: string;
  orgName?: string;
  subscriptionType?: string;
  apiProvider?: string;
}

export interface AiRateLimit {
  status: "allowed" | "allowed_warning" | "rejected";
  rateLimitType?: string;
  /** 0..1 fraction of the window used. */
  utilization?: number;
  resetsAt?: number;
  isUsingOverage?: boolean;
  observedAt: string;
}

export interface AiModelOption {
  value: string;
  label: string;
  description?: string;
  /** Concrete model id the alias resolves to (e.g. "claude-fable-5-1"). */
  resolvedModel?: string;
  supportsEffort: boolean;
  /** Effort levels this model accepts; empty when effort is unsupported. */
  effortLevels: AiEffort[];
}

export interface AiSessionDetail extends AiSessionInfo {
  messages: AiMessage[];
}

/** What the UI is looking at when the user sends a message. */
export interface AiContext {
  connectionId?: string | null;
  schema?: string | null;
  table?: string | null;
  filters?: FilterSpec[];
  where?: string;
  sql?: string;
}

/** Everything the assistant shows lands in its playground tab (a SQL editor), never in the chat. */
export type AiUiAction = { kind: "playground_query"; connectionId: string; sql: string; run: boolean };

/** Server → UI stream events for one session (SSE). */
export type AiEvent =
  | { type: "turn_started"; messageId: string }
  | { type: "text_delta"; messageId: string; text: string }
  | { type: "assistant_text"; messageId: string; text: string }
  | { type: "tool_call"; messageId: string; id: string; name: string; input: unknown }
  | { type: "tool_result"; messageId: string; id: string; output: string; isError: boolean }
  | { type: "ui_action"; action: AiUiAction }
  | { type: "turn_done"; messageId: string; stats: AiMessage["stats"] }
  | { type: "turn_error"; messageId: string; message: string }
  | { type: "status"; text: string };

export interface AiStatus {
  /** Claude Code binary / SDK runtime resolved. */
  available: boolean;
  detail: string;
  settings: AiSettings;
  /** From `claude auth status` (subscription mode). */
  account: AiAccount | null;
  /** Model the CLI resolved for the last turn (from the SDK init message). */
  lastModel: string | null;
  /** Credential source the CLI reported for the last turn (e.g. "oauth", "ANTHROPIC_API_KEY"). */
  lastApiKeySource: string | null;
  /** Latest rate-limit events, keyed by window type. */
  rateLimits: AiRateLimit[];
  models: AiModelOption[];
  efforts: AiEffort[];
}

/** GitHub repository whose releases carry the app builds; fixed at build time, not user-configurable. */
export const UPDATE_REPO = "Wyesoftware/drizzle-explorer";

export interface UpdateAsset {
  name: string;
  url: string;
  size: number;
  /** Download URL of the `<name>.sha256` asset published next to it, if any. */
  checksumUrl: string | null;
}

export interface UpdateCheck {
  current: string;
  latest: string | null;
  /** Release page to open in the browser. */
  url: string | null;
  upToDate: boolean;
  publishedAt?: string | null;
  error?: string;
  /** Release asset built for this platform/arch (see scripts/package.ts naming), if the release has one. */
  asset?: UpdateAsset | null;
  /** True when `app.installUpdate` can replace this installation in place (packaged app + matching asset). */
  installable?: boolean;
}

export interface ToolsInfo {
  pg_dump: string | null;
  pg_restore: string | null;
  psql: string | null;
  /** Directories that were searched, for the "not found" hint. */
  searched: string[];
}

export interface TableRowsResult extends QueryResult {
  /** Exact total row count (COUNT(*)), null if it could not be computed. */
  total: number | null;
  /**
   * Columns that identify a row for editing: the primary key, or the hidden `__key` column
   * (ctid / rowid) when the table has no primary key. Empty when rows cannot be addressed (views).
   */
  keyColumns: string[];
}

/** Name of the hidden row-address column added when a table has no primary key. */
export const ROW_KEY_COLUMN = "__key";

export type RowChange =
  | { kind: "insert"; values: Record<string, unknown> }
  | { kind: "update"; key: Record<string, unknown>; values: Record<string, unknown> }
  | { kind: "delete"; key: Record<string, unknown> };

export interface MutateRequest {
  connectionId: string;
  schema: string | null;
  table: string;
  changes: RowChange[];
}

export interface MutateResult {
  inserted: number;
  updated: number;
  deleted: number;
  durationMs: number;
}

export interface SystemInfo {
  version: string;
  /** ISO time of `bun run build` (null in dev); shown in the status bar to tell builds apart. */
  build: string | null;
  bunVersion: string;
  platform: string;
  arch: string;
  standalone: boolean;
  configDir: string;
}

/**
 * RPC surface. Keys are method names, values are (params) => result.
 * The server implements this; the UI calls it through a typed proxy.
 */
export interface RpcMethods {
  "system.info": (params: Record<string, never>) => SystemInfo;
  "system.pickFile": (params: { title?: string; save?: boolean }) => { path: string | null };
  "system.openExternal": (params: { url: string }) => { ok: true };
  /** UI preferences persisted in the config dir (`ui-state.json`): opaque strings keyed by store name. */
  "ui.state": (params: Record<string, never>) => Record<string, string>;
  "ui.setState": (params: { key: string; value: string | null }) => { ok: true };
  "app.checkUpdate": (params: Record<string, never>) => UpdateCheck;
  /** Downloads the matching release asset, verifies its checksum, swaps the installation and restarts (job). */
  "app.installUpdate": (params: Record<string, never>) => { jobId: string };

  "connections.list": (params: Record<string, never>) => ConnectionConfig[];
  "connections.save": (params: { config: ConnectionConfig }) => ConnectionConfig;
  "connections.delete": (params: { id: string }) => { deleted: boolean };
  "connections.test": (params: { config: ConnectionConfig }) => { ok: true; serverVersion: string };
  "connections.connect": (params: { id: string }) => ConnectionStatus;
  "connections.disconnect": (params: { id: string }) => ConnectionStatus;
  "connections.status": (params: Record<string, never>) => ConnectionStatus[];

  "schema.schemas": (params: { connectionId: string }) => SchemaInfo[];
  "schema.tables": (params: { connectionId: string; schema: string | null }) => TableInfo[];
  "schema.table": (params: { connectionId: string; schema: string | null; table: string }) => TableDetails;
  "schema.routines": (params: { connectionId: string; schema: string | null }) => RoutineInfo[];
  "schema.dropTable": (params: {
    connectionId: string;
    schema: string | null;
    table: string;
    kind: TableKind;
    cascade: boolean;
  }) => { ok: true };
  "schema.truncateTable": (params: {
    connectionId: string;
    schema: string | null;
    table: string;
    cascade: boolean;
    restartIdentity: boolean;
  }) => { ok: true };
  "schema.dropRoutine": (params: {
    connectionId: string;
    schema: string | null;
    name: string;
    identityArgs: string;
    kind: RoutineKind;
  }) => { ok: true };

  "data.rows": (params: TableRowsRequest) => TableRowsResult;
  "data.mutate": (params: MutateRequest) => MutateResult;
  "data.lookup": (params: {
    connectionId: string;
    schema: string | null;
    table: string;
    keyColumn: string;
    query: string;
    limit?: number;
  }) => LookupRow[];
  "data.distinct": (params: {
    connectionId: string;
    schema: string | null;
    table: string;
    column: string;
    /** Case-insensitive "contains" match on the text form of the value (and on the labels, with `ref`). */
    search?: string;
    limit?: number;
    /** Referenced table of a foreign-key column: values are labelled with its text columns. */
    ref?: { schema: string | null; table: string; column: string };
  }) => DistinctValuesResult;

  "sql.execute": (params: { connectionId: string; sql: string }) => QueryResult;

  "data.export": (params: ExportRequest) => ExportResult;
  "data.transfer": (params: TransferRequest) => TransferResult;
  "import.inspect": (params: { path: string; format?: ExportFormat }) => ImportInspectResult;
  "import.run": (params: ImportRequest) => ImportResult;

  "tools.detect": (params: Record<string, never>) => ToolsInfo;
  "dump.start": (params: DumpRequest) => { jobId: string };
  "restore.start": (params: RestoreRequest) => { jobId: string };
  "jobs.list": (params: Record<string, never>) => JobInfo[];
  "jobs.status": (params: { id: string; offset: number }) => JobStatus;
  "jobs.cancel": (params: { id: string }) => JobInfo;

  "ai.status": (params: Record<string, never>) => AiStatus;
  "ai.sessions": (params: Record<string, never>) => AiSessionInfo[];
  "ai.session": (params: { id: string }) => AiSessionDetail;
  "ai.create": (params: { model?: string | null; effort?: AiEffort | null }) => AiSessionInfo;
  "ai.delete": (params: { id: string }) => { deleted: boolean };
  "ai.configure": (params: { id: string; model?: string | null; effort?: AiEffort | null }) => AiSessionInfo;
  "ai.updateSettings": (params: Partial<AiSettings>) => AiSettings;
  "ai.send": (params: { id: string; text: string; context?: AiContext }) => { messageId: string };
  "ai.cancel": (params: { id: string }) => { cancelled: boolean };
}

export type RpcMethodName = keyof RpcMethods;
export type RpcParams<M extends RpcMethodName> = Parameters<RpcMethods[M]>[0];
export type RpcResult<M extends RpcMethodName> = ReturnType<RpcMethods[M]>;

export interface RpcRequest<M extends RpcMethodName = RpcMethodName> {
  method: M;
  params: RpcParams<M>;
}

export type RpcResponse<T = unknown> =
  | { ok: true; result: T }
  | { ok: false; error: { message: string; code?: string; detail?: string } };
