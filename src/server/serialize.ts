import type { ResultColumn, ResultRow } from "@shared/types";

const MAX_BYTES_PREVIEW = 32;

/** Convert a driver value into something JSON.stringify can carry to the UI without loss of meaning. */
export function serializeValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  switch (typeof value) {
    case "bigint":
      return value.toString();
    case "number":
      return Number.isFinite(value) ? value : String(value);
    case "string":
    case "boolean":
      return value;
    case "object": {
      if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
      if (value instanceof Uint8Array) {
        const hex = Buffer.from(value.subarray(0, MAX_BYTES_PREVIEW)).toString("hex");
        return value.byteLength > MAX_BYTES_PREVIEW
          ? `\\x${hex}… (${value.byteLength} bytes)`
          : `\\x${hex}`;
      }
      if (Array.isArray(value)) return value.map(serializeValue);
      return value;
    }
    default:
      return String(value);
  }
}

export function serializeRow(row: Record<string, unknown>): ResultRow {
  const out: ResultRow = {};
  for (const key of Object.keys(row)) out[key] = serializeValue(row[key]);
  return out;
}

export function serializeRows(rows: Record<string, unknown>[]): ResultRow[] {
  return rows.map(serializeRow);
}

/** Derive result columns from row keys when the driver does not expose metadata. */
export function columnsFromRows(rows: Record<string, unknown>[]): ResultColumn[] {
  const first = rows[0];
  if (!first) return [];
  return Object.keys(first).map((name) => ({ name, dataType: null }));
}

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "bigint" ? Number(value) : Number(value);
  return Number.isFinite(n) ? n : null;
}
