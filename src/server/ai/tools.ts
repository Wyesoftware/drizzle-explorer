/**
 * Tools the assistant can call. Data access is read-only and goes through the same drivers as the UI.
 * Anything the user should *see* is pushed to the assistant's playground tab via UI actions; the
 * tool result returned to the model is a compact copy so it can summarize, never to be echoed.
 */
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { AiUiAction, QueryResult } from "@shared/types";
import { connections } from "../connections";

const MAX_ROWS = 300;
const MAX_CELL = 200;
const MAX_TEXT = 30_000;

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }] };
}

function error(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Compact, size-capped rendering of a result set for the model's eyes only. */
function renderResult(result: QueryResult, extra: Record<string, unknown> = {}) {
  const rows = result.rows.slice(0, MAX_ROWS).map((r) =>
    result.columns.map((c) => {
      const v = r[c.name];
      if (v === null || v === undefined) return null;
      const s = typeof v === "object" ? JSON.stringify(v) : String(v);
      return s.length > MAX_CELL ? `${s.slice(0, MAX_CELL)}…` : s;
    }),
  );
  const payload = {
    note: "Shown to the user in the playground. Summarize; do not repeat rows or SQL in chat.",
    columns: result.columns.map((c) => c.name),
    rows,
    rowCount: result.rowCount,
    truncated: result.rows.length > MAX_ROWS ? `showing ${MAX_ROWS} of ${result.rows.length} rows` : undefined,
    ...extra,
  };
  let out = JSON.stringify(payload);
  if (out.length > MAX_TEXT) out = `${out.slice(0, MAX_TEXT)}… (output truncated at ${MAX_TEXT} chars; narrow the query)`;
  return text(out);
}

export function createDbToolServer(emit: (action: AiUiAction) => void) {
  const listConnections = tool(
    "list_connections",
    "List the database connections configured in the app (id, name, dialect, connected).",
    {},
    async () => {
      const [list, status] = await Promise.all([connections.list(), connections.status()]);
      return text(
        list.map((c) => ({
          id: c.id,
          name: c.name,
          dialect: c.dialect,
          connected: status.find((s) => s.id === c.id)?.connected ?? false,
        })),
      );
    },
    { annotations: { readOnlyHint: true } },
  );

  const listSchemas = tool(
    "list_schemas",
    "List schemas of a connection (SQLite has only `main`).",
    { connectionId: z.string() },
    async ({ connectionId }) => {
      try {
        return text(await (await connections.driver(connectionId)).listSchemas());
      } catch (e) {
        return error(message(e));
      }
    },
    { annotations: { readOnlyHint: true } },
  );

  const listTables = tool(
    "list_tables",
    "List tables and views in a schema with approximate row counts.",
    { connectionId: z.string(), schema: z.string().nullable().describe("null = default schema (public / main)") },
    async ({ connectionId, schema }) => {
      try {
        const tables = await (await connections.driver(connectionId)).listTables(schema);
        return text(tables.map((t) => ({ name: t.name, kind: t.kind, rows: t.rowEstimate, comment: t.comment ?? undefined })));
      } catch (e) {
        return error(message(e));
      }
    },
    { annotations: { readOnlyHint: true } },
  );

  const describeTable = tool(
    "describe_table",
    "Columns (name, type, nullable, default, primary key, enum values), indexes and foreign keys of a table. Use it before writing joins.",
    { connectionId: z.string(), schema: z.string().nullable(), table: z.string() },
    async ({ connectionId, schema, table }) => {
      try {
        const d = await (await connections.driver(connectionId)).tableDetails(schema, table);
        return text({
          table: d.table,
          columns: d.columns.map((c) => ({
            name: c.name,
            type: c.dataType,
            nullable: c.nullable,
            default: c.defaultValue ?? undefined,
            pk: c.isPrimaryKey || undefined,
            enum: c.enumValues,
            comment: c.comment ?? undefined,
          })),
          indexes: d.indexes.map((i) => ({ name: i.name, columns: i.columns, unique: i.unique })),
          foreignKeys: d.foreignKeys.map((f) => ({
            columns: f.columns,
            ref: `${f.refSchema ? `${f.refSchema}.` : ""}${f.refTable}(${f.refColumns.join(",")})`,
          })),
        });
      } catch (e) {
        return error(message(e));
      }
    },
    { annotations: { readOnlyHint: true } },
  );

  const runQuery = tool(
    "run_query",
    "Run a read-only SQL query (SELECT / WITH, joins, aggregations, or browsing rows with WHERE/ORDER BY/LIMIT) and show both the SQL and its results in the assistant playground. Writes are rejected. Use the connection's dialect (PostgreSQL or SQLite) and always add LIMIT when listing rows. You receive a compact copy of the results to summarize.",
    { connectionId: z.string(), sql: z.string() },
    async ({ connectionId, sql }) => {
      try {
        const result = await (await connections.driver(connectionId)).executeReadOnly(sql);
        emit({ kind: "playground_query", connectionId, sql, run: true });
        return renderResult(result, { durationMs: Math.round(result.durationMs) });
      } catch (e) {
        return error(message(e));
      }
    },
  );

  const draftQuery = tool(
    "draft_query",
    "Put a SQL query into the playground editor WITHOUT running it, for the user to review, edit or run themselves (e.g. heavy queries or when the user asked for a query rather than results).",
    { connectionId: z.string(), sql: z.string() },
    async ({ connectionId, sql }) => {
      emit({ kind: "playground_query", connectionId, sql, run: false });
      return text("The query is now in the playground editor (not executed). Tell the user to review it there; do not repeat it in chat.");
    },
  );

  return createSdkMcpServer({
    name: "db",
    version: "1.0.0",
    tools: [listConnections, listSchemas, listTables, describeTable, runQuery, draftQuery],
  });
}
