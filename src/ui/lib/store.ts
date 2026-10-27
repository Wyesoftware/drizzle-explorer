import { create } from "zustand";
import type { RoutineInfo, RowFilter, SavedQuery, SortSpec } from "@shared/types";

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
  /** Set when the tab edits an entry of the SQL library: Save updates it in place. */
  savedId?: string;
}

/**
 * The assistant's playground (assistant mode, right pane): a SQL editor the chat fills through tool calls.
 * One per chat session, kept outside the explore-mode tab list.
 */
export interface Playground {
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

export type Tab = TableTab | SqlTab | RoutineTab;

const playgroundSqlId = (sessionId: string) => `playground:${sessionId}:sql`;

export const tableTabId = (connectionId: string, schema: string | null, table: string) =>
  `table:${connectionId}:${schema ?? ""}:${table}`;
export const routineTabId = (connectionId: string, routine: Pick<RoutineInfo, "schema" | "name" | "identityArgs">) =>
  `routine:${connectionId}:${routine.schema ?? ""}:${routine.name}(${routine.identityArgs})`;

interface AppState {
  tabs: Tab[];
  activeTabId: string | null;
  sqlCounter: number;
  /** Section shown by the full-page settings overlay; null = closed. Tabs underneath stay mounted. */
  settings: SettingsSection | null;
  /** Assistant playgrounds by chat session id. */
  playgrounds: Record<string, Playground>;
  openTable: (
    connectionId: string,
    schema: string | null,
    table: string,
    options?: { filter?: RowFilter; sort?: SortSpec[] },
  ) => void;
  openSqlEditor: (connectionId: string | null, sql?: string) => void;
  /** Opens (or focuses) the tab of a saved query. */
  openSavedQuery: (query: SavedQuery) => void;
  openRoutine: (connectionId: string, routine: RoutineInfo) => void;
  /** Creates the playground for a chat session if it does not exist yet. */
  ensurePlayground: (sessionId: string, title: string) => void;
  updatePlayground: (sessionId: string, patch: Partial<Pick<Playground, "title" | "connectionId">>) => void;
  removePlayground: (sessionId: string) => void;
  playgroundQuery: (sessionId: string, title: string, connectionId: string, sql: string, run: boolean) => void;
  /** Patches a tab; also reaches the playgrounds' nested SQL editors by their own id. */
  updateTab: (id: string, patch: Partial<Tab>) => void;
  /** Opens the settings page over the workspace, optionally jumping to a section. */
  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;
  closeTab: (id: string) => void;
  closeConnectionTabs: (connectionId: string) => void;
  setActiveTab: (id: string) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  sqlCounter: 0,
  settings: null,
  playgrounds: {},

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

  openSavedQuery(query) {
    const id = `saved:${query.id}`;
    const existing = get().tabs.find((t) => t.id === id);
    if (existing) {
      set({ activeTabId: id });
      return;
    }
    set((s) => ({
      tabs: [...s.tabs, { id, kind: "sql", connectionId: query.connectionId, title: query.name, sql: query.sql, savedId: query.id }],
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
    set((s) => ({ settings: section ?? s.settings ?? "general" }));
  },
  closeSettings() {
    set({ settings: null });
  },
  updateTab(id, patch) {
    set((s) => {
      if (s.tabs.some((t) => t.id === id)) return { tabs: s.tabs.map((t) => (t.id === id ? ({ ...t, ...patch } as Tab) : t)) };
      const owner = Object.values(s.playgrounds).find((p) => p.sql.id === id);
      if (!owner) return {};
      const sql = { ...owner.sql, ...patch } as SqlTab;
      return { playgrounds: { ...s.playgrounds, [owner.sessionId]: { ...owner, sql, connectionId: sql.connectionId } } };
    });
  },

  ensurePlayground(sessionId, title) {
    if (get().playgrounds[sessionId]) return;
    const playground: Playground = {
      sessionId,
      title,
      connectionId: null,
      sql: { id: playgroundSqlId(sessionId), kind: "sql", connectionId: null, title: "Playground", sql: "", runVersion: 0 },
    };
    set((s) => ({ playgrounds: { ...s.playgrounds, [sessionId]: playground } }));
  },

  updatePlayground(sessionId, patch) {
    set((s) => {
      const p = s.playgrounds[sessionId];
      return p ? { playgrounds: { ...s.playgrounds, [sessionId]: { ...p, ...patch } } } : {};
    });
  },

  removePlayground(sessionId) {
    set((s) => {
      const { [sessionId]: _gone, ...rest } = s.playgrounds;
      return { playgrounds: rest };
    });
  },

  playgroundQuery(sessionId, title, connectionId, sql, run) {
    get().ensurePlayground(sessionId, title);
    set((s) => {
      const p = s.playgrounds[sessionId]!;
      return {
        playgrounds: {
          ...s.playgrounds,
          [sessionId]: {
            ...p,
            connectionId,
            sql: { ...p.sql, connectionId, sql, runVersion: run ? (p.sql.runVersion ?? 0) + 1 : p.sql.runVersion },
          },
        },
      };
    });
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
