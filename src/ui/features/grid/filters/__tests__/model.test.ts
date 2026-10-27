import { describe, expect, test } from "bun:test";
import { matchesModel } from "../model";

describe("matchesModel", () => {
  test("null handling", () => {
    expect(matchesModel({ op: "is_null" }, null)).toBe(true);
    expect(matchesModel({ op: "is_null" }, "x")).toBe(false);
    expect(matchesModel({ op: "is_not_null" }, 0)).toBe(true);
    expect(matchesModel({ op: "eq", value: "1" }, null)).toBe(false);
    expect(matchesModel({ op: "eq", value: "1", orNull: true }, null)).toBe(true);
    expect(matchesModel(null, null)).toBe(true);
  });

  test("numbers compare numerically, strings lexically", () => {
    expect(matchesModel({ op: "gt", value: "9" }, 10)).toBe(true);
    expect(matchesModel({ op: "gt", value: "9" }, "10")).toBe(true);
    expect(matchesModel({ op: "lte", value: "2.5" }, 2.5)).toBe(true);
    expect(matchesModel({ op: "eq", value: "1" }, "01")).toBe(true);
    expect(matchesModel({ op: "lt", value: "b" }, "a")).toBe(true);
    expect(matchesModel({ op: "gte", value: "2026-01-01" }, "2026-03-04 10:00:00")).toBe(true);
  });

  test("text operators are case-insensitive", () => {
    expect(matchesModel({ op: "contains", value: "ann" }, "Joanna")).toBe(true);
    expect(matchesModel({ op: "starts", value: "jo" }, "Joanna")).toBe(true);
    expect(matchesModel({ op: "ends", value: "NA" }, "Joanna")).toBe(true);
    expect(matchesModel({ op: "like", value: "j%a" }, "Joanna")).toBe(true);
    expect(matchesModel({ op: "like", value: "j_anna" }, "Joanna")).toBe(true);
    expect(matchesModel({ op: "like", value: "j_nna" }, "Joanna")).toBe(false);
    expect(matchesModel({ op: "like", value: "50%" }, "50% off")).toBe(true);
  });

  test("in uses the explicit list or the comma-separated value", () => {
    expect(matchesModel({ op: "in", value: "1, 2, 3" }, 2)).toBe(true);
    expect(matchesModel({ op: "in", values: ["a,b", "c"] }, "a,b")).toBe(true);
    expect(matchesModel({ op: "in", values: ["a"] }, "b")).toBe(false);
    expect(matchesModel({ op: "neq", value: "x" }, { k: 1 })).toBe(true);
  });
});
