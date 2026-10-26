import { describe, expect, test } from "bun:test";
import {
  DEFAULT_FORMAT_DEFAULTS,
  epochToMillis,
  formatCellValue,
  formatDate,
  formatPattern,
  parseDateValue,
} from "../format-value";

describe("parseDateValue", () => {
  test("treats zone-less database strings as UTC", () => {
    expect(parseDateValue("2026-10-24 17:56:41")?.toISOString()).toBe("2026-10-24T17:56:41.000Z");
    expect(parseDateValue("2026-10-24")?.toISOString()).toBe("2026-10-24T00:00:00.000Z");
  });
  test("keeps explicit offsets", () => {
    expect(parseDateValue("2026-10-24T17:56:41+02:00")?.toISOString()).toBe("2026-10-24T15:56:41.000Z");
  });
  test("epoch auto-detection", () => {
    expect(parseDateValue(1_700_000_000)?.toISOString()).toBe("2023-11-14T22:13:20.000Z");
    expect(parseDateValue(1_700_000_000_000)?.toISOString()).toBe("2023-11-14T22:13:20.000Z");
    expect(parseDateValue("1700000000000000")?.toISOString()).toBe("2023-11-14T22:13:20.000Z");
    expect(epochToMillis(5, "s")).toBe(5000);
  });
  test("rejects garbage", () => {
    expect(parseDateValue("hello")).toBeNull();
    expect(parseDateValue(null)).toBeNull();
  });
});

describe("formatting", () => {
  const d = new Date("2026-10-24T17:56:41.123Z");
  test("pattern tokens with timezone", () => {
    expect(formatPattern(d, "YYYY-MM-DD HH:mm:ss.SSS Z", "UTC")).toBe("2026-10-24 17:56:41.123 +00:00");
    expect(formatPattern(d, "YYYY-MM-DD HH:mm Z (ddd)", "Europe/Kyiv")).toBe("2026-10-24 20:56 +03:00 (Sat)");
    expect(formatPattern(d, "DD/MM/YYYY", "America/New_York")).toBe("24/10/2026");
  });
  test("presets", () => {
    expect(formatDate(d, "iso", undefined, "utc")).toBe("2026-10-24T17:56:41.123Z");
    expect(formatDate(d, "iso", undefined, "Europe/Kyiv")).toBe("2026-10-24T20:56:41.123+03:00");
    expect(formatDate(d, "date", undefined, "Asia/Tokyo")).toBe("2026-10-25");
    expect(formatDate(d, "time", undefined, "utc")).toBe("17:56:41");
  });
  test("formatCellValue", () => {
    expect(formatCellValue("2026-10-24T17:56:41.000Z", { kind: "auto" }, "timestamptz", DEFAULT_FORMAT_DEFAULTS)).toBeNull();
    expect(
      formatCellValue("2026-10-24T17:56:41.000Z", { kind: "auto" }, "timestamptz", { ...DEFAULT_FORMAT_DEFAULTS, timeZone: "Europe/Kyiv", datePreset: "custom" }),
    ).toBe("2026-10-24 20:56:41");
    expect(formatCellValue(1_700_000_000, { kind: "date", preset: "date", timeZone: "utc", epoch: "s" }, "bigint", DEFAULT_FORMAT_DEFAULTS)).toBe("2023-11-14");
    expect(formatCellValue("1234567.891", { kind: "number", grouping: true, decimals: 2 }, "numeric", DEFAULT_FORMAT_DEFAULTS)).toBe("1,234,567.89");
    expect(formatCellValue("not a date", { kind: "date", preset: "iso", timeZone: "utc", epoch: "auto" }, "text", DEFAULT_FORMAT_DEFAULTS)).toBeNull();
  });
});

describe("wall-clock editing helpers", () => {
  const { dateEditMode, fromWallInput, toWallInput } = require("../format-value") as typeof import("../format-value");
  test("mode detection", () => {
    expect(dateEditMode("timestamp with time zone")).toBe("datetime");
    expect(dateEditMode("DATETIME")).toBe("datetime");
    expect(dateEditMode("date")).toBe("date");
    expect(dateEditMode("time without time zone")).toBe("time");
    expect(dateEditMode("text")).toBeNull();
  });
  test("round-trips through a zone", () => {
    const d = new Date("2026-10-24T17:56:41.000Z");
    expect(toWallInput(d, "Europe/Kyiv", "datetime")).toBe("2026-10-24T20:56:41");
    expect(fromWallInput("2026-10-24T20:56:41", "Europe/Kyiv")?.toISOString()).toBe("2026-10-24T17:56:41.000Z");
    expect(fromWallInput("2026-10-24T17:56", "utc")?.toISOString()).toBe("2026-10-24T17:56:00.000Z");
    expect(fromWallInput("2026-07-01T12:00", "America/New_York")?.toISOString()).toBe("2026-07-01T16:00:00.000Z");
    expect(fromWallInput("2026-01-01T12:00", "America/New_York")?.toISOString()).toBe("2026-01-01T17:00:00.000Z");
    expect(fromWallInput("garbage", "utc")).toBeNull();
  });
});
