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
