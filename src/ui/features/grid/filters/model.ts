import { FILTER_OPS, type FilterOp, type FilterSpec } from "@shared/types";
import type { DateEditMode } from "@/lib/format-value";

/** Where a set filter loads its candidate values from (distinct values of the filtered column). */
export interface SetValuesSource {
  connectionId: string;
  schema: string | null;
  table: string;
  column: string;
  /** Referenced table for foreign-key columns: values get labels from its text columns. */
  ref?: { schema: string | null; table: string; column: string };
}

/** Which filter UI a column gets; chosen by `TableTab.filterFor` from the column type. */
export type ColumnFilterSpec =
  | { type: "text" }
  | { type: "number" }
  | { type: "date"; mode: DateEditMode }
  | { type: "set"; source: SetValuesSource };

/** AG Grid filter model of one column: a `FilterSpec` without the column name (+ UI-only labels of set values). */
export type ColumnFilterModel = Omit<FilterSpec, "column"> & { labels?: Record<string, string> };
export type ColumnFilterModels = Record<string, ColumnFilterModel>;

/** Flattens the grid's filter model (column → model) into server-side conditions. */
export function toFilterSpecs(models: ColumnFilterModels | null | undefined): FilterSpec[] {
  return Object.entries(models ?? {})
    .filter(([, m]) => Boolean(m))
    .map(([column, { labels: _labels, ...m }]) => ({ column, ...m }));
}

export const OPS_BY_TYPE: Record<ColumnFilterSpec["type"], FilterOp[]> = {
  text: ["contains", "starts", "ends", "eq", "neq", "like", "in", "is_null", "is_not_null"],
  number: ["eq", "neq", "lt", "lte", "gt", "gte", "in", "is_null", "is_not_null"],
  date: ["eq", "neq", "lt", "lte", "gt", "gte", "is_null", "is_not_null"],
  set: ["in", "is_null", "is_not_null"],
};

/** Operators shown in the compact picker of the floating row (number and date columns). */
export const FLOATING_OPS: FilterOp[] = ["eq", "neq", "lt", "lte", "gt", "gte", "is_null", "is_not_null"];

const SYMBOLS: Partial<Record<FilterOp, string>> = {
  eq: "=",
  neq: "≠",
  lt: "<",
  lte: "≤",
  gt: ">",
  gte: "≥",
  is_null: "∅",
  is_not_null: "¬∅",
};

export function opSymbol(op: FilterOp): string {
  return SYMBOLS[op] ?? opLabel(op);
}

export function opLabel(op: FilterOp): string {
  return FILTER_OPS.find((o) => o.op === op)?.label ?? op;
}

export function opNeedsValue(op: FilterOp): boolean {
  return FILTER_OPS.find((o) => o.op === op)?.needsValue ?? true;
}

/** Short human description of an active model, for the floating row of set filters and tooltips. */
export function describeModel(model: ColumnFilterModel | null | undefined): string {
  if (!model) return "";
  if (model.op === "in") {
    const parts = [...(model.orNull ? ["(NULL)"] : []), ...(model.values ?? []).map((v) => model.labels?.[v] ?? v)];
    return parts.join(", ");
  }
  if (!opNeedsValue(model.op)) return opLabel(model.op);
  return `${opSymbol(model.op)} ${model.value ?? ""}`;
}

/** Native input type for a date column filter. */
export function dateInputType(mode: DateEditMode): "date" | "datetime-local" | "time" {
  return mode === "datetime" ? "datetime-local" : mode;
}

/** Value as the database should see it: `datetime-local` yields `YYYY-MM-DDTHH:mm`, which SQLite compares badly. */
export function normalizeDateValue(value: string): string {
  return value.replace("T", " ");
}

export function toInputDateValue(value: string): string {
  return value.replace(" ", "T");
}

/** SQL `LIKE` pattern → case-insensitive regular expression (`%` any run, `_` one char). */
function likeToRegExp(pattern: string): RegExp {
  const source = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${source}$`, "is");
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Compares as numbers when both sides are numeric, otherwise as strings (ISO dates compare fine). */
function compare(value: unknown, target: string): number {
  const a = typeof value === "number" ? value : Number(asText(value));
  const b = Number(target);
  if (Number.isFinite(a) && Number.isFinite(b) && asText(value).trim() !== "" && target.trim() !== "") return a - b;
  return asText(value).localeCompare(target);
}

function listOf(model: ColumnFilterModel): string[] {
  return model.values ?? (model.value ?? "").split(",").map((v) => v.trim()).filter(Boolean);
}

/**
 * Client-side evaluation of a column filter model against one cell value, for grids whose rows are
 * already in memory (SQL results). Mirrors the server-side WHERE builder semantics.
 */
export function matchesModel(model: ColumnFilterModel | null | undefined, value: unknown): boolean {
  if (!model) return true;
  const isNull = value === null || value === undefined;
  if (model.op === "is_null") return isNull;
  if (model.op === "is_not_null") return !isNull;
  if (isNull) return Boolean(model.orNull);
  const text = asText(value);
  const target = model.value ?? "";
  const lower = text.toLowerCase();
  switch (model.op) {
    case "eq":
      return compare(value, target) === 0;
    case "neq":
      return compare(value, target) !== 0;
    case "lt":
      return compare(value, target) < 0;
    case "lte":
      return compare(value, target) <= 0;
    case "gt":
      return compare(value, target) > 0;
    case "gte":
      return compare(value, target) >= 0;
    case "contains":
      return lower.includes(target.toLowerCase());
    case "starts":
      return lower.startsWith(target.toLowerCase());
    case "ends":
      return lower.endsWith(target.toLowerCase());
    case "like":
      return likeToRegExp(target).test(text);
    case "in":
      return listOf(model).some((v) => compare(value, v) === 0);
    default:
      return true;
  }
}
