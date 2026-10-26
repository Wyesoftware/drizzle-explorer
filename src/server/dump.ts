/**
 * Database dump & restore.
 *  - PostgreSQL: delegates to pg_dump / pg_restore / psql (must be installed, like DBeaver).
 *  - SQLite: native SQL dump/restore implemented in the driver.
 * Both run as background jobs; the UI polls the log.
 */
import { delimiter, join } from "node:path";
import { applicationName } from "./identity";
import type { DumpFormat, DumpRequest, PostgresConnectionConfig, RestoreRequest, ToolsInfo } from "@shared/types";
import { connections } from "./connections";
import { DriverError } from "./drivers";
import { startJob, type JobHandle } from "./jobs";

const EXTRA_BIN_DIRS = [
  "/opt/homebrew/opt/libpq/bin",
  "/opt/homebrew/bin",
  "/usr/local/opt/libpq/bin",
  "/usr/local/bin",
  "/Applications/Postgres.app/Contents/Versions/latest/bin",
  "/usr/lib/postgresql/16/bin",
  "/usr/lib/postgresql/17/bin",
  "/usr/pgsql-17/bin",
  "/usr/pgsql-16/bin",
  "C:\\Program Files\\PostgreSQL\\17\\bin",
  "C:\\Program Files\\PostgreSQL\\16\\bin",
];

function searchDirs(): string[] {
  const dirs = [process.env.DRIZZLE_EXPLORER_PG_BIN, ...(process.env.PATH ?? "").split(delimiter), ...EXTRA_BIN_DIRS];
  return [...new Set(dirs.filter((d): d is string => Boolean(d)))];
}

function findTool(name: string): string | null {
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  for (const dir of searchDirs()) {
    const candidate = join(dir, exe);
    if (Bun.which(candidate)) return candidate;
  }
  return null;
}

export function detectTools(): ToolsInfo {
  return {
    pg_dump: findTool("pg_dump"),
    pg_restore: findTool("pg_restore"),
    psql: findTool("psql"),
    searched: searchDirs(),
  };
}

function requireTool(name: "pg_dump" | "pg_restore" | "psql"): string {
  const path = detectTools()[name];
  if (!path) {
    throw new DriverError(
      `${name} was not found. Install the PostgreSQL client tools (macOS: brew install libpq) or set DRIZZLE_EXPLORER_PG_BIN to their directory.`,
      "TOOL_MISSING",
    );
  }
  return path;
}

/** Connection flags shared by pg_dump / pg_restore / psql, with the password passed via the environment. */
function pgConnection(config: PostgresConnectionConfig): { args: string[]; env: Record<string, string> } {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), PGCONNECT_TIMEOUT: "15", PGAPPNAME: applicationName() };
  if (config.url) return { args: [`--dbname=${config.url}`], env };
  if (config.password) env.PGPASSWORD = config.password;
  const args = [
    `--host=${config.host ?? "localhost"}`,
    `--port=${config.port ?? 5432}`,
    `--username=${config.user ?? "postgres"}`,
    `--dbname=${config.database ?? config.user ?? "postgres"}`,
  ];
  if (config.ssl) env.PGSSLMODE = "require";
  return { args, env };
}

const VERSION_HINT =
  "Hint: this dump was written by a newer pg_dump than the target server (transaction_timeout exists since PostgreSQL 17). " +
  "Restore with 'Stop at the first error' off, or use client tools matching the server version.";

interface ProcessResult {
  code: number;
  /** True when a known-benign error pattern was seen (used for hints). */
  versionMismatch: boolean;
  ignoredErrors: boolean;
}

async function runProcess(
  job: JobHandle,
  cmd: string,
  args: string[],
  env: Record<string, string>,
  options: { allowExitCode?: (result: ProcessResult) => boolean } = {},
): Promise<ProcessResult> {
  job.log(`$ ${[cmd, ...args.map(redact)].join(" ")}`);
  const result: ProcessResult = { code: 0, versionMismatch: false, ignoredErrors: false };
  const proc = Bun.spawn([cmd, ...args], { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const onAbort = () => proc.kill();
  job.signal.addEventListener("abort", onAbort, { once: true });
  const pump = async (stream: ReadableStream<Uint8Array> | null) => {
    if (!stream) return;
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of stream) {
      buffer += decoder.decode(chunk, { stream: true });
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() ?? "";
      for (const line of parts) if (line.trim()) emit(line);
    }
    buffer += decoder.decode();
    if (buffer.trim()) emit(buffer);
  };
  const emit = (line: string) => {
    job.log(line);
    if (/unrecognized configuration parameter "transaction_timeout"/.test(line) && !result.versionMismatch) {
      result.versionMismatch = true;
      job.log(VERSION_HINT);
    }
    if (/errors ignored on restore/.test(line)) result.ignoredErrors = true;
  };
  const [code] = await Promise.all([proc.exited, pump(proc.stdout), pump(proc.stderr)]);
  job.signal.removeEventListener("abort", onAbort);
  result.code = code;
  if (job.signal.aborted) throw new DriverError("Cancelled");
  if (code !== 0 && !options.allowExitCode?.(result)) {
    throw new DriverError(`${cmd.split("/").pop()} exited with code ${code}`);
  }
  return result;
}

function redact(arg: string): string {
  return arg.replace(/(:\/\/[^:/@]+:)[^@]+@/, "$1***@");
}

export async function startDump(request: DumpRequest): Promise<{ jobId: string }> {
  if (!request.path) throw new DriverError("Destination path is required", "BAD_REQUEST");
  const config = await connections.get(request.connectionId);
  const label = `${config.name}${request.scope.kind === "schema" ? ` / ${request.scope.schema}` : ""}`;

  if (config.dialect === "postgres") {
    const pgDump = requireTool("pg_dump");
    const { args, env } = pgConnection(config);
    if (request.scope.kind === "schema") args.push(`--schema=${request.scope.schema}`);
    if (request.mode === "schema-only") args.push("--schema-only");
    if (request.mode === "data-only") args.push("--data-only");
    args.push(`--format=${request.format === "custom" ? "custom" : "plain"}`);
    if (request.noOwner) args.push("--no-owner");
    if (request.noPrivileges) args.push("--no-privileges");
    args.push("--verbose", "--no-password", `--file=${request.path}`);
    const jobId = startJob("dump", `Dump ${label} → ${request.path}`, async (job) => {
      await runProcess(job, pgDump, args, env);
      const bytes = (await Bun.file(request.path).exists()) ? Bun.file(request.path).size : 0;
      job.log(`wrote ${bytes} bytes`);
      return { path: request.path, bytes };
    });
    return { jobId };
  }

  if (request.format === "custom") throw new DriverError("SQLite dumps are plain SQL only", "BAD_REQUEST");
  const driver = await connections.driver(config.id);
  if (!driver.dumpSql) throw new DriverError("Dump is not supported for this connection");
  const jobId = startJob("dump", `Dump ${label} → ${request.path}`, async (job) => {
    const bytes = await driver.dumpSql!({ path: request.path, mode: request.mode }, job);
    job.log(`wrote ${bytes} bytes`);
    return { path: request.path, bytes };
  });
  return { jobId };
}

async function sniffFormat(path: string): Promise<DumpFormat> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new DriverError(`File not found: ${path}`, "NOT_FOUND");
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  return new TextDecoder().decode(head) === "PGDMP" ? "custom" : "sql";
}

export async function startRestore(request: RestoreRequest): Promise<{ jobId: string }> {
  const config = await connections.get(request.connectionId);
  const format = request.format ?? (await sniffFormat(request.path));

  if (config.dialect === "postgres") {
    const { args, env } = pgConnection(config);
    let cmd: string;
    if (format === "custom") {
      cmd = requireTool("pg_restore");
      if (request.clean) args.push("--clean", "--if-exists");
      if (request.stopOnError) args.push("--exit-on-error");
      args.push("--no-owner", "--no-privileges", "--verbose", "--no-password", request.path);
    } else {
      cmd = requireTool("psql");
      args.push("--no-password", "--echo-errors", `--file=${request.path}`);
      if (request.stopOnError) args.push("--set=ON_ERROR_STOP=1");
    }
    const jobId = startJob("restore", `Restore ${request.path} → ${config.name}`, async (job) => {
      const result = await runProcess(job, cmd, args, env, {
        // pg_restore exits with 1 after finishing when some statements failed; without
        // "stop on error" that is the expected "restored with warnings" outcome.
        allowExitCode: (r) => !request.stopOnError && r.code === 1 && r.ignoredErrors,
      });
      if (result.code !== 0) job.log("Finished with warnings: some statements failed (see above).");
      // Schema changed: reconnect so cached metadata is fresh.
      await connections.disconnect(config.id);
    });
    return { jobId };
  }

  if (format === "custom") throw new DriverError("SQLite can only restore plain SQL scripts", "BAD_REQUEST");
  const driver = await connections.driver(config.id);
  if (!driver.restoreSql) throw new DriverError("Restore is not supported for this connection");
  const jobId = startJob("restore", `Restore ${request.path} → ${config.name}`, async (job) => {
    await driver.restoreSql!({ path: request.path, stopOnError: request.stopOnError }, job);
  });
  return { jobId };
}
