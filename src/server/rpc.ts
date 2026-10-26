import type { RpcMethodName, RpcMethods, RpcParams, RpcRequest, RpcResponse, RpcResult } from "@shared/types";
import { CONFIG_DIR, connections } from "./connections";
import { pickFile } from "./dialogs";
import { DriverError } from "./drivers";
import { exportData, inspectImport, runImport, transferRows } from "./transfer";
import { detectTools, startDump, startRestore } from "./dump";
import { cancelJob, jobStatus, listJobs } from "./jobs";
import { ai } from "./ai/sessions";
import { APP_VERSION, BUILD_TIME, checkUpdate, openExternal, installUpdate } from "./app";
import { getUiState, setUiState } from "./prefs";

type Handlers = {
  [M in RpcMethodName]: (params: RpcParams<M>) => Promise<RpcResult<M>> | RpcResult<M>;
};

const handlers: Handlers = {
  "system.info": () => ({
    version: APP_VERSION,
    build: BUILD_TIME,
    bunVersion: Bun.version,
    platform: process.platform,
    arch: process.arch,
    standalone: Boolean((Bun as unknown as { isStandaloneExecutable?: boolean }).isStandaloneExecutable),
    configDir: CONFIG_DIR,
  }),
  "system.pickFile": async (params) => ({ path: await pickFile(params) }),
  "system.openExternal": async ({ url }) => {
    await openExternal(url);
    return { ok: true as const };
  },
  "ui.state": () => getUiState(),
  "ui.setState": async ({ key, value }) => {
    await setUiState(key, value);
    return { ok: true as const };
  },
  "app.checkUpdate": () => checkUpdate(),
  "app.installUpdate": () => installUpdate(),

  "connections.list": () => connections.list(),
  "connections.save": ({ config }) => connections.save(config),
  "connections.delete": async ({ id }) => ({ deleted: await connections.remove(id) }),
  "connections.test": ({ config }) => connections.test(config),
  "connections.connect": ({ id }) => connections.connect(id),
  "connections.disconnect": ({ id }) => connections.disconnect(id),
  "connections.status": () => connections.status(),

  "schema.schemas": async ({ connectionId }) => (await connections.driver(connectionId)).listSchemas(),
  "schema.tables": async ({ connectionId, schema }) => (await connections.driver(connectionId)).listTables(schema),
  "schema.table": async ({ connectionId, schema, table }) =>
    (await connections.driver(connectionId)).tableDetails(schema, table),
  "schema.routines": async ({ connectionId, schema }) => (await connections.driver(connectionId)).listRoutines(schema),
  "schema.dropTable": async ({ connectionId, schema, table, kind, cascade }) => {
    await (await connections.driver(connectionId)).dropTable(schema, table, kind, cascade);
    return { ok: true as const };
  },
  "schema.truncateTable": async ({ connectionId, schema, table, cascade, restartIdentity }) => {
    await (await connections.driver(connectionId)).truncateTable(schema, table, { cascade, restartIdentity });
    return { ok: true as const };
  },
  "schema.dropRoutine": async ({ connectionId, schema, name, identityArgs, kind }) => {
    await (await connections.driver(connectionId)).dropRoutine(schema, name, identityArgs, kind);
    return { ok: true as const };
  },

  "data.rows": async ({ connectionId, ...request }) => (await connections.driver(connectionId)).fetchRows(request),
  "data.lookup": async ({ connectionId, schema, table, keyColumn, query, limit }) =>
    (await connections.driver(connectionId)).lookupRows(schema, table, keyColumn, query ?? "", Math.min(limit ?? 50, 200)),
  "data.distinct": async ({ connectionId, schema, table, column, search, limit, ref }) =>
    (await connections.driver(connectionId)).distinctValues(schema, table, column, search ?? "", Math.min(limit ?? 100, 1000), ref),
  "data.mutate": async ({ connectionId, schema, table, changes }) => {
    if (!changes.length) throw new DriverError("No changes to apply", "BAD_REQUEST");
    return (await connections.driver(connectionId)).mutateRows(schema, table, changes);
  },

  "sql.execute": async ({ connectionId, sql }) => {
    if (!sql.trim()) throw new DriverError("Query is empty");
    return (await connections.driver(connectionId)).execute(sql);
  },

  "data.export": (params) => exportData(params),
  "data.transfer": (params) => transferRows(params),
  "import.inspect": ({ path, format }) => inspectImport(path, format),
  "import.run": (params) => runImport(params),

  "tools.detect": () => detectTools(),
  "dump.start": (params) => startDump(params),
  "restore.start": (params) => startRestore(params),
  "jobs.list": () => listJobs(),
  "jobs.status": ({ id, offset }) => jobStatus(id, offset),
  "jobs.cancel": ({ id }) => cancelJob(id),

  "ai.status": () => ai.status(),
  "ai.sessions": () => ai.list(),
  "ai.session": ({ id }) => ai.detail(id),
  "ai.create": ({ model, effort }) => ai.create(model, effort),
  "ai.delete": async ({ id }) => ({ deleted: await ai.remove(id) }),
  "ai.configure": ({ id, model, effort }) => ai.configure(id, { model, effort }),
  "ai.updateSettings": (patch) => ai.updateSettings(patch),
  "ai.send": ({ id, text, context }) => ai.send(id, text, context),
  "ai.cancel": async ({ id }) => ({ cancelled: await ai.cancel(id) }),
};

export function isRpcMethod(name: unknown): name is RpcMethodName {
  return typeof name === "string" && Object.hasOwn(handlers, name);
}

export async function handleRpc(request: unknown): Promise<RpcResponse> {
  if (!request || typeof request !== "object") {
    return { ok: false, error: { message: "Invalid RPC request", code: "BAD_REQUEST" } };
  }
  const { method, params } = request as Partial<RpcRequest>;
  if (!isRpcMethod(method)) {
    return { ok: false, error: { message: `Unknown method: ${String(method)}`, code: "UNKNOWN_METHOD" } };
  }
  try {
    const handler = handlers[method] as (p: unknown) => unknown;
    const result = await handler(params ?? {});
    return { ok: true, result };
  } catch (error) {
    if (error instanceof DriverError) {
      return { ok: false, error: { message: error.message, code: error.code, detail: error.detail } };
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[rpc] ${method} failed:`, error);
    return { ok: false, error: { message } };
  }
}
