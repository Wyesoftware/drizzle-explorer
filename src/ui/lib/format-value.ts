/**
 * Per-column display formatting (dates, timezones, epoch numbers). Pure functions, no React.
 */

export type DatePreset = "iso" | "local" | "date" | "time" | "relative" | "custom";
export type EpochUnit = "auto" | "s" | "ms" | "us" | "ns";
/** "utc", "local", or an IANA zone such as "Europe/Kyiv". */
export type TimeZoneChoice = string;

export type ColumnFormat =
  | { kind: "auto" }
  | { kind: "raw" }
  | { kind: "date"; preset: DatePreset; pattern?: string; timeZone: TimeZoneChoice; epoch: EpochUnit }
  | { kind: "number"; grouping: boolean; decimals: number | null };

export interface FormatDefaults {
  datePreset: DatePreset;
  datePattern: string;
  timeZone: TimeZoneChoice;
}

export const DEFAULT_FORMAT_DEFAULTS: FormatDefaults = {
  datePreset: "iso",
  datePattern: "YYYY-MM-DD HH:mm:ss",
  timeZone: "utc",
};

export const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: "iso", label: "ISO 8601 (2026-10-24T17:56:41.000Z)" },
  { value: "local", label: "Readable (Oct 24, 2026, 17:56:41)" },
  { value: "date", label: "Date only (2026-10-24)" },
  { value: "time", label: "Time only (17:56:41)" },
  { value: "relative", label: "Relative (3 hours ago)" },
  { value: "custom", label: "Custom pattern" },
];

export const EPOCH_UNITS: { value: EpochUnit; label: string }[] = [
  { value: "auto", label: "Auto-detect by magnitude" },
  { value: "s", label: "Seconds" },
  { value: "ms", label: "Milliseconds" },
  { value: "us", label: "Microseconds" },
  { value: "ns", label: "Nanoseconds" },
];

export function isDateType(dataType: string | null | undefined): boolean {
  return /timestamp|datetime|\bdate\b|\btime\b/i.test(dataType ?? "");
}

export function isNumericType(dataType: string | null | undefined): boolean {
  return /int|numeric|decimal|real|double|float|serial|money|number/i.test(dataType ?? "");
}

export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function resolveTimeZone(choice: TimeZoneChoice): string {
  if (!choice || choice === "utc") return "UTC";
  if (choice === "local") return localTimeZone();
  return choice;
}

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const NO_ZONE = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?)?$/;

/** Interpret a cell value as a Date. Strings without a zone are treated as UTC (what databases hand back). */
export function parseDateValue(value: unknown, epoch: EpochUnit = "auto"): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number" || typeof value === "bigint" || (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim()))) {
    const n = typeof value === "bigint" ? Number(value) : Number(value);
    if (!Number.isFinite(n)) return null;
    const ms = epochToMillis(n, epoch);
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value !== "string") return null;
  let text = value.trim();
  if (NO_ZONE.test(text)) {
    text = text.replace(" ", "T");
    if (text.length > 10) text += "Z";
    else text += "T00:00:00Z";
  }
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : new Date(ms);
}

export function epochToMillis(n: number, unit: EpochUnit): number {
  const abs = Math.abs(n);
  const resolved: Exclude<EpochUnit, "auto"> =
    unit !== "auto" ? unit : abs < 1e11 ? "s" : abs < 1e14 ? "ms" : abs < 1e17 ? "us" : "ns";
  switch (resolved) {
    case "s":
      return n * 1000;
    case "ms":
      return n;
    case "us":
      return n / 1000;
    case "ns":
      return n / 1_000_000;
  }
}

const partsCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
      timeZoneName: "longOffset",
      weekday: "short",
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

interface DateParts {
  YYYY: string;
  MM: string;
  DD: string;
  HH: string;
  mm: string;
  ss: string;
  SSS: string;
  Z: string;
  ddd: string;
}

function dateParts(date: Date, timeZone: string): DateParts {
  const parts = partsFormatter(timeZone).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const offset = get("timeZoneName").replace(/^GMT/, "");
  return {
    YYYY: get("year"),
    MM: get("month"),
    DD: get("day"),
    HH: get("hour"),
    mm: get("minute"),
    ss: get("second"),
    SSS: get("fractionalSecond").padEnd(3, "0"),
    Z: offset === "" ? "+00:00" : offset,
    ddd: get("weekday"),
  };
}

/** Tokens: YYYY MM DD HH mm ss SSS Z ddd. Anything else is copied verbatim. */
export function formatPattern(date: Date, pattern: string, timeZone: string): string {
  const p = dateParts(date, timeZone);
  return pattern.replace(/YYYY|MM|DD|HH|mm|ss|SSS|ddd|Z/g, (token) => p[token as keyof DateParts]);
}

export function formatRelative(date: Date, now = Date.now()): string {
  const diffSec = Math.round((date.getTime() - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(diffSec, "second");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diffSec / 86400), "day");
  if (abs < 86400 * 365) return rtf.format(Math.round(diffSec / (86400 * 30)), "month");
  return rtf.format(Math.round(diffSec / (86400 * 365)), "year");
}

export function formatDate(date: Date, preset: DatePreset, pattern: string | undefined, timeZoneChoice: TimeZoneChoice): string {
  const timeZone = resolveTimeZone(timeZoneChoice);
  switch (preset) {
    case "iso":
      return timeZone === "UTC" ? date.toISOString() : formatPattern(date, "YYYY-MM-DDTHH:mm:ss.SSSZ", timeZone);
    case "local":
      return new Intl.DateTimeFormat(undefined, {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(date);
    case "date":
      return formatPattern(date, "YYYY-MM-DD", timeZone);
    case "time":
      return formatPattern(date, "HH:mm:ss", timeZone);
    case "relative":
      return formatRelative(date);
    case "custom":
      return formatPattern(date, pattern || "YYYY-MM-DD HH:mm:ss", timeZone);
  }
}

export function formatNumber(value: unknown, grouping: boolean, decimals: number | null): string | null {
  const n = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isFinite(n)) return null;
  return new Intl.NumberFormat(undefined, {
    useGrouping: grouping,
    minimumFractionDigits: decimals ?? undefined,
    maximumFractionDigits: decimals ?? 20,
  }).format(n);
}

/**
 * Returns the display text for a cell, or null to fall back to the default rendering.
 * `auto` applies the date defaults to date-typed columns and leaves everything else alone.
 */
export function formatCellValue(
  value: unknown,
  format: ColumnFormat | undefined,
  dataType: string | null | undefined,
  defaults: FormatDefaults,
): string | null {
  if (value === null || value === undefined) return null;
  const f = format ?? { kind: "auto" };
  switch (f.kind) {
    case "raw":
      return null;
    case "auto": {
      if (!isDateType(dataType)) return null;
      if (defaults.datePreset === "iso" && defaults.timeZone === "utc") return null; // identical to the raw value
      const d = parseDateValue(value, "auto");
      return d ? formatDate(d, defaults.datePreset, defaults.datePattern, defaults.timeZone) : null;
    }
    case "date": {
      const d = parseDateValue(value, f.epoch);
      return d ? formatDate(d, f.preset, f.pattern, f.timeZone) : null;
    }
    case "number":
      return formatNumber(value, f.grouping, f.decimals);
  }
}

export function describeFormat(format: ColumnFormat | undefined): string | null {
  if (!format || format.kind === "auto") return null;
  if (format.kind === "raw") return "raw";
  if (format.kind === "number") return format.grouping ? "1,234" : "number";
  const zone = format.timeZone === "utc" ? "UTC" : format.timeZone === "local" ? "local" : format.timeZone;
  return `${format.preset === "custom" ? format.pattern : format.preset} · ${zone}`;
}

// ---- editing helpers: wall-clock text in a zone ⇄ Date ------------------------------------------

export type DateEditMode = "date" | "datetime" | "time";

export function dateEditMode(dataType: string | null | undefined): DateEditMode | null {
  const t = (dataType ?? "").toLowerCase();
  if (/timestamp|datetime/.test(t)) return "datetime";
  if (/\bdate\b/.test(t)) return "date";
  if (/\btime\b/.test(t)) return "time";
  return null;
}

/** Whether the database stores an instant (timestamptz) rather than a naive wall-clock value. */
export function dateTypeHasZone(dataType: string | null | undefined): boolean {
  return /with time zone|timestamptz|timetz/i.test(dataType ?? "");
}

/** Value for a native <input type="datetime-local|date|time"> showing the instant in `zone`. */
export function toWallInput(date: Date, zone: string, mode: DateEditMode): string {
  switch (mode) {
    case "date":
      return formatPattern(date, "YYYY-MM-DD", zone);
    case "time":
      return formatPattern(date, "HH:mm:ss", zone);
    default:
      return formatPattern(date, "YYYY-MM-DDTHH:mm:ss", zone);
  }
}

function zoneOffsetMs(utcMs: number, zone: string): number {
  const parts = partsFormatter(zone).formatToParts(new Date(utcMs));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Interprets `YYYY-MM-DDTHH:mm[:ss]` as wall-clock time in `zone` and returns the UTC instant. */
export function fromWallInput(text: string, zone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/.exec(text.trim());
  if (!m) return null;
  const [, y, mo, d, h = "0", mi = "0", s = "0", ms = "0"] = m;
  const guess = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), Number(ms.padEnd(3, "0")));
  const tz = resolveTimeZone(zone);
  let utc = guess - zoneOffsetMs(guess, tz);
  utc = guess - zoneOffsetMs(utc, tz); // second pass handles DST boundaries
  const date = new Date(utc);
  return Number.isNaN(date.getTime()) ? null : date;
}
