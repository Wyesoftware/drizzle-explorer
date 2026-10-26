/**
 * Export, import and table-to-table transfer. Rows flow through the drivers in batches so that
 * exports and transfers of large tables do not have to fit in memory (xlsx is the exception).
 */
import { extname } from "node:path";
import type {
  ColumnMapping,
  ExportFormat,
  ExportRequest,
  ExportResult,
  ExportSource,
  ImportInspectResult,
  ImportRequest,
  ImportResult,
  ResultColumn,
  ResultRow,
  TransferRequest,
  TransferResult,
  InsertOptions,
  ExportColumn,
} from "@shared/types";
import { connections } from "./connections";
import { DriverError, type Driver } from "./drivers";
import { csvLine, parseCsv } from "./formats/csv";
import { readXlsx, writeXlsx } from "./formats/xlsx";

const PAGE_SIZE = 1000;
/** Keep well under PostgreSQL's 65535 and SQLite's 32766 bind-parameter limits. */
const MAX_PARAMS_PER_INSERT = 30_000;

type BatchHandler = (columns: ResultColumn[], rows: ResultRow[]) => Promise<void> | void;

/** Reads a source (table with filters, or ad-hoc SQL) page by page and hands batches to `onBatch`. */
async function readSource(source: ExportSource, onBatch: BatchHandler, select?: ExportColumn[]): Promise<number> {
  const driver = await connections.driver(source.connectionId);
  let total = 0;
  if (source.kind === "sql") {
    const result = await driver.execute(source.sql);
    await onBatch(result.columns, result.rows);
    return result.rows.length;
  }
  const max = source.limit && source.limit > 0 ? source.limit : Infinity;
  let offset = 0;
  while (total < max) {
    const limit = Math.min(PAGE_SIZE, max - total);
    const page = await driver.fetchRows({
      schema: source.schema,
      table: source.table,
      limit,
      offset,
      sort: source.sort,
      filters: source.filters,
      where: source.where,
      select: select?.length ? select : undefined,
    });
    if (page.rows.length === 0) break;
    await onBatch(page.columns, page.rows);
    total += page.rows.length;
    offset += page.rows.length;
    if (page.rows.length < limit) break;
  }
  return total;
}

export function formatFromPath(path: string, explicit?: ExportFormat): ExportFormat {
  if (explicit) return explicit;
  switch (extname(path).toLowerCase()) {
    case ".csv":
      return "csv";
    case ".json":
      return "json";
    case ".xlsx":
    case ".xls":
      return "xlsx";
    default:
      throw new DriverError(`Cannot infer format from "${path}"; choose csv, json or xlsx`, "BAD_FORMAT");
  }
}

export async function exportData(request: ExportRequest): Promise<ExportResult> {
  const started = performance.now();
  const { format, path } = request;
  if (!path) throw new DriverError("Destination path is required", "BAD_REQUEST");

  if (format === "xlsx") {
    let columns: string[] = [];
    const rows: unknown[][] = [];
    const count = await readSource(
      request.source,
      (cols, batch) => {
        if (columns.length === 0) columns = cols.map((c) => c.name);
        for (const row of batch) rows.push(columns.map((c) => row[c]));
      },
      request.columns,
    );
    const bytes = writeXlsx(columns, rows);
    await Bun.write(path, bytes);
    return { path, rows: count, bytes: bytes.byteLength, durationMs: performance.now() - started };
  }

  const file = Bun.file(path);
  const writer = file.writer();
  let bytes = 0;
  const write = (chunk: string) => {
    bytes += Buffer.byteLength(chunk);
    writer.write(chunk);
  };
  let columns: string[] = [];
  let written = 0;
  try {
    if (format === "json") write("[");
    const count = await readSource(
      request.source,
      (cols, batch) => {
        if (columns.length === 0) {
          columns = cols.map((c) => c.name);
          if (format === "csv") write(csvLine(columns));
        }
        for (const row of batch) {
          if (format === "csv") {
            write(csvLine(columns.map((c) => row[c])));
          } else {
            write((written === 0 ? "\n" : ",\n") + JSON.stringify(row));
          }
          written++;
        }
      },
      request.columns,
    );
    if (format === "json") write(written ? "\n]\n" : "]\n");
    await writer.end();
    return { path, rows: count, bytes, durationMs: performance.now() - started };
  } catch (error) {
    await Promise.resolve(writer.end()).catch(() => {});
    throw error;
  }
}

interface ParsedFile {
  format: ExportFormat;
  columns: string[];
  rows: unknown[][];
}

async function readFile(path: string, explicit?: ExportFormat): Promise<ParsedFile> {
  const format = formatFromPath(path, explicit);
  const file = Bun.file(path);
  if (!(await file.exists())) throw new DriverError(`File not found: ${path}`, "NOT_FOUND");
  switch (format) {
    case "csv": {
      const { columns, rows } = parseCsv(await file.text());
      return { format, columns, rows };
    }
    case "json": {
      const parsed: unknown = await file.json();
      const list = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && Array.isArray((parsed as { rows?: unknown }).rows)
          ? (parsed as { rows: unknown[] }).rows
          : null;
      if (!list) throw new DriverError("JSON must be an array of objects (or { rows: [...] })", "BAD_FORMAT");
      const columns: string[] = [];
      const seen = new Set<string>();
      for (const item of list) {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          for (const key of Object.keys(item)) {
            if (!seen.has(key)) {
              seen.add(key);
              columns.push(key);
            }
          }
        }
      }
      const rows = list.map((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? columns.map((c) => (item as Record<string, unknown>)[c] ?? null)
          : columns.map(() => null),
      );
      return { format, columns, rows };
    }
    case "xlsx": {
      const { columns, rows } = readXlsx(await file.arrayBuffer());
      return { format, columns, rows };
    }
  }
}

export async function inspectImport(path: string, explicit?: ExportFormat): Promise<ImportInspectResult> {
  const parsed = await readFile(path, explicit);
  const sample = parsed.rows.slice(0, 5).map((row) => Object.fromEntries(parsed.columns.map((c, i) => [c, row[i] ?? null])));
  return { format: parsed.format, columns: parsed.columns, rowCount: parsed.rows.length, sample };
}

interface Plan {
  /** Mappings that take values from the source, in column order. */
  sourced: { source: string; target: string }[];
  expressions: { column: string; sql: string }[];
}

function planMapping(mapping: ColumnMapping[]): Plan {
  const sourced: Plan["sourced"] = [];
  const expressions: Plan["expressions"] = [];
  const targets = new Set<string>();
  for (const m of mapping) {
    if (!m.target) continue;
    if (targets.has(m.target)) throw new DriverError(`Target column "${m.target}" is mapped twice`, "BAD_REQUEST");
    if (m.expression?.trim()) {
      expressions.push({ column: m.target, sql: m.expression.trim() });
    } else if (m.source) {
      sourced.push({ source: m.source, target: m.target });
    } else continue;
    targets.add(m.target);
  }
  if (!targets.size) throw new DriverError("Map at least one column", "BAD_REQUEST");
  return { sourced, expressions };
}

async function insertInBatches(
  driver: Driver,
  schema: string | null,
  table: string,
  columns: string[],
  rows: unknown[][],
  options: InsertOptions,
): Promise<number> {
  const batchSize = Math.max(1, Math.min(500, Math.floor(MAX_PARAMS_PER_INSERT / Math.max(1, columns.length))));
  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    inserted += await driver.insertRows(schema, table, columns, rows.slice(i, i + batchSize), options);
  }
  return inserted;
}

export async function runImport(request: ImportRequest): Promise<ImportResult> {
  const started = performance.now();
  const plan = planMapping(request.mapping);
  const parsed = await readFile(request.path, request.format);
  const sourceIndex = new Map(parsed.columns.map((c, i) => [c, i]));
  for (const m of plan.sourced) {
    if (!sourceIndex.has(m.source)) throw new DriverError(`Column "${m.source}" not found in file`, "BAD_REQUEST");
  }
  const targetColumns = plan.sourced.map((m) => m.target);
  const rows = parsed.rows.map((row) =>
    plan.sourced.map((m) => {
      const value = row[sourceIndex.get(m.source)!];
      if (request.emptyAsNull && value === "") return null;
      return value ?? null;
    }),
  );
  const driver = await connections.driver(request.connectionId);
  const options: InsertOptions = { expressions: plan.expressions, onConflict: request.onConflict };
  const inserted = await insertInBatches(driver, request.schema, request.table, targetColumns, rows, options);
  return { inserted, durationMs: performance.now() - started };
}

export async function transferRows(request: TransferRequest): Promise<TransferResult> {
  const started = performance.now();
  const plan = planMapping(request.mapping);
  const target = await connections.driver(request.target.connectionId);
  const targetColumns = plan.sourced.map((m) => m.target);
  const options: InsertOptions = { expressions: plan.expressions, onConflict: request.onConflict };
  let copied = 0;
  await readSource(request.source, async (_cols, batch) => {
    const rows = batch.map((row) => plan.sourced.map((m) => row[m.source] ?? null));
    copied += await insertInBatches(target, request.target.schema, request.target.table, targetColumns, rows, options);
  });
  return { copied, durationMs: performance.now() - started };
}
