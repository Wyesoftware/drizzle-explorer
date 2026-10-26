import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { prefsStorage } from "@/lib/prefs";
import { DEFAULT_FORMAT_DEFAULTS, type ColumnFormat, type FormatDefaults } from "./format-value";

/** Scope = table (`table:conn:schema:table`) or connection-wide SQL results (`sql:conn`). */
export type FormatScope = string;

interface FormatState {
  byScope: Record<FormatScope, Record<string, ColumnFormat>>;
  defaults: FormatDefaults;
  setFormat: (scope: FormatScope, column: string, format: ColumnFormat | null) => void;
  setDefaults: (defaults: Partial<FormatDefaults>) => void;
}

export const useFormatStore = create<FormatState>()(
  persist(
    (set) => ({
      byScope: {},
      defaults: DEFAULT_FORMAT_DEFAULTS,
      setFormat: (scope, column, format) =>
        set((s) => {
          const current = { ...(s.byScope[scope] ?? {}) };
          if (!format || format.kind === "auto") delete current[column];
          else current[column] = format;
          const byScope = { ...s.byScope };
          if (Object.keys(current).length) byScope[scope] = current;
          else delete byScope[scope];
          return { byScope };
        }),
      setDefaults: (defaults) => set((s) => ({ defaults: { ...s.defaults, ...defaults } })),
    }),
    { name: "drizzle-explorer.formats", version: 1, storage: createJSONStorage(() => prefsStorage) },
  ),
);

export const tableScope = (connectionId: string, schema: string | null, table: string): FormatScope =>
  `table:${connectionId}:${schema ?? ""}:${table}`;
export const sqlScope = (connectionId: string | null): FormatScope => `sql:${connectionId ?? ""}`;

const EMPTY: Record<string, ColumnFormat> = {};
export function useScopeFormats(scope: FormatScope): Record<string, ColumnFormat> {
  return useFormatStore((s) => s.byScope[scope] ?? EMPTY);
}
