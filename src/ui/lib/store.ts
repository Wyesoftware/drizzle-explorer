import { create } from "zustand";
import type { RoutineInfo, RowFilter, SortSpec } from "@shared/types";

export interface TableTab {
  id: string;
  kind: "table";
  connectionId: string;
  schema: string | null;
  table: string;
  /** Filter to apply when the tab opens (e.g. "open referenced row"). Bumped via `filterVersion`. */
  initialFilter?: RowFilter;
  initialSort?: SortSpec[];
  filterVersion?: number;
}

export interface SqlTab {
  id: string;
  kind: "sql";
  connectionId: string | null;
  title: string;
  sql: string;
  /** Bumped to make the editor execute its current SQL (assistant playground). */
  runVersion?: number;
}

/** The assistant's own tab: a SQL editor it fills through tool calls. */
export interface PlaygroundTab {
  id: string;
  kind: "playground";
  sessionId: string;
  title: string;
  connectionId: string | null;
  sql: SqlTab;
}

export interface RoutineTab {
  id: string;
  kind: "routine";
  connectionId: string;
  routine: RoutineInfo;
}

export type SettingsSection = "general" | "table" | "assistant" | "updates";

/** Full-page settings (single instance, id "settings"). */
export interface SettingsTab {
  id: "settings";
  kind: "settings";
  section: SettingsSection;
}

export type Tab = TableTab | SqlTab | RoutineTab | PlaygroundTab | SettingsTab;

export const SETTINGS_TAB_ID = "settings";

export const playgroundTabId = (sessionId: string) => `playground:${sessionId}`;

export const tableTabId = (connectionId: string, schema: string | null, table: string) =>
  `table:${connectionId}:${schema ?? ""}:${table}`;
export const routineTabId = (connectionId: string, routine: Pick<RoutineInfo, "schema" | "name" | "identityArgs">) =>
  `routine:${connectionId}:${routine.schema ?? ""}:${routine.name}(${routine.identityArgs})`;

interface AppState {
  tabs: Tab[];
  activeTabId: string | null;
  sqlCounter: number;
  openTable: (
    connectionId: string,
    schema: string | null,
    table: string,
    options?: { filter?: RowFilter; sort?: SortSpec[] },
  ) => void;
  openSqlEditor: (connectionId: string | null, sql?: string) => void;
  openRoutine: (connectionId: string, routine: RoutineInfo) => void;
  /** Creates (or focuses) the playground tab for a chat session. */
  ensurePlayground: (sessionId: string, title: string, options?: { activate?: boolean }) => void;
  playgroundQuery: (sessionId: string, title: string, connectionId: string, sql: string, run: boolean) => void;
  updateTab: (id: string, patch: Partial<Tab>) => void;
  /** Opens (or focuses) the settings page, optionally jumping to a section. */
  openSettings: (section?: SettingsSection) => void;
  closeTab: (id: string) => void;
  closeConnectionTabs: (connectionId: string) => void;
  setActiveTab: (id: string) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  sqlCounter: 0,

  openTable(connectionId, schema, table, options) {
    const id = tableTabId(connectionId, schema, table);
    const existing = get().tabs.find((t) => t.id === id);
    if (existing) {
      if (options?.filter || options?.sort) {
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === id && t.kind === "table"
              ? { ...t, initialFilter: options.filter ?? {}, initialSort: options.sort, filterVersion: (t.filterVersion ?? 0) + 1 }
              : t,
          ),
          activeTabId: id,
        }));
      } else {
        set({ activeTabId: id });
      }
      return;
    }
    set((s) => ({
      tabs: [
        ...s.tabs,
        { id, kind: "table", connectionId, schema, table, initialFilter: options?.filter, initialSort: options?.sort, filterVersion: 1 },
      ],
      activeTabId: id,
    }));
  },

  openSqlEditor(connectionId, sql = "") {
    const n = get().sqlCounter + 1;
    const id = `sql:${n}:${Date.now()}`;
    set((s) => ({
      sqlCounter: n,
      tabs: [...s.tabs, { id, kind: "sql", connectionId, title: `SQL ${n}`, sql }],
      activeTabId: id,
    }));
  },

  openRoutine(connectionId, routine) {
    const id = routineTabId(connectionId, routine);
    const existing = get().tabs.find((t) => t.id === id);
    if (existing) {
      set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, routine } : t)), activeTabId: id }));
      return;
    }
    set((s) => ({ tabs: [...s.tabs, { id, kind: "routine", connectionId, routine }], activeTabId: id }));
  },

  openSettings(section) {
    const existing = get().tabs.find((t) => t.id === SETTINGS_TAB_ID) as SettingsTab | undefined;
    if (existing) {
      set((s) => ({
        activeTabId: SETTINGS_TAB_ID,
        tabs: section ? s.tabs.map((t) => (t.id === SETTINGS_TAB_ID ? { ...t, section } : t)) : s.tabs,
      }));
      return;
    }
    const tab: SettingsTab = { id: SETTINGS_TAB_ID, kind: "settings", section: section ?? "general" };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: SETTINGS_TAB_ID }));
  },
  updateTab(id, patch) {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id === id) return { ...t, ...patch } as Tab;
        // The playground's SQL editor is a nested tab addressed by its own id.
        if (t.kind === "playground" && t.sql.id === id) return { ...t, sql: { ...t.sql, ...patch } as SqlTab };
        return t;
      }),
    }));
  },

  ensurePlayground(sessionId, title, options) {
    const id = playgroundTabId(sessionId);
    const existing = get().tabs.find((t) => t.id === id);
    if (existing) {
      if (options?.activate) set({ activeTabId: id });
      return;
    }
    const tab: PlaygroundTab = {
      id,
      kind: "playground",
      sessionId,
      title,
      connectionId: null,
      sql: { id: `${id}:sql`, kind: "sql", connectionId: null, title: "Playground", sql: "", runVersion: 0 },
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: options?.activate ? id : s.activeTabId }));
  },

  playgroundQuery(sessionId, title, connectionId, sql, run) {
    get().ensurePlayground(sessionId, title);
    const id = playgroundTabId(sessionId);
    set((s) => ({
      activeTabId: id,
      tabs: s.tabs.map((t) =>
        t.id === id && t.kind === "playground"
          ? {
              ...t,
              connectionId,
              sql: { ...t.sql, connectionId, sql, runVersion: run ? (t.sql.runVersion ?? 0) + 1 : t.sql.runVersion },
            }
          : t,
      ),
    }));
  },

  closeTab(id) {
    set((s) => {
      const index = s.tabs.findIndex((t) => t.id === id);
      const tabs = s.tabs.filter((t) => t.id !== id);
      let activeTabId = s.activeTabId;
      if (activeTabId === id) activeTabId = tabs[Math.min(index, tabs.length - 1)]?.id ?? null;
      return { tabs, activeTabId };
    });
  },

  closeConnectionTabs(connectionId) {
    set((s) => {
      const tabs = s.tabs.filter((t) => !("connectionId" in t) || t.connectionId !== connectionId);
      const activeTabId = tabs.some((t) => t.id === s.activeTabId) ? s.activeTabId : (tabs.at(-1)?.id ?? null);
      return { tabs, activeTabId };
    });
  },

  setActiveTab(id) {
    set({ activeTabId: id });
  },
}));
