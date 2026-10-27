import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { prefsStorage } from "@/lib/prefs";

/**
 * The app has two separate modes: `explore` = connections sidebar + table/SQL tabs, `assistant` = chat +
 * its playground, nothing else. They never show together.
 */
export type AppMode = "explore" | "assistant";

interface LayoutState {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  toggleMode: () => void;
  /** Connections sidebar hidden (a thin rail with an expand button stays). */
  sidebarCollapsed: boolean;
  /** Last sidebar width in pixels, restored when the panel mounts again. */
  sidebarWidth: number;
  /** Last chat pane width in pixels (assistant mode). */
  aiWidth: number;
  /** Chat thread list (assistant mode) hidden. */
  threadsCollapsed: boolean;
  threadsWidth: number;
  setThreadsCollapsed: (collapsed: boolean) => void;
  setThreadsWidth: (px: number) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (px: number) => void;
  setAiWidth: (px: number) => void;
}

export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 640;
export const AI_MIN = 440;
export const AI_MAX = 960;
export const THREADS_MIN = 200;
export const THREADS_MAX = 440;

/** Persisted panel layout (collapse state + widths). */
export const useLayout = create<LayoutState>()(
  persist(
    (set) => ({
      mode: "explore",
      setMode: (mode) => set({ mode }),
      toggleMode: () => set((s) => ({ mode: s.mode === "explore" ? "assistant" : "explore" })),
      sidebarCollapsed: false,
      sidebarWidth: 300,
      aiWidth: 540,
      threadsCollapsed: false,
      threadsWidth: 260,
      setThreadsCollapsed: (threadsCollapsed) => set({ threadsCollapsed }),
      setThreadsWidth: (px) => set({ threadsWidth: Math.round(px) }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarWidth: (px) => set({ sidebarWidth: Math.round(px) }),
      setAiWidth: (px) => set({ aiWidth: Math.round(px) }),
    }),
    {
      name: "drizzle-explorer.layout",
      version: 1,
      storage: createJSONStorage(() => prefsStorage),
      partialize: ({ mode, sidebarCollapsed, sidebarWidth, aiWidth, threadsCollapsed, threadsWidth }) => ({
        mode,
        sidebarCollapsed,
        sidebarWidth,
        aiWidth,
        threadsCollapsed,
        threadsWidth,
      }),
    },
  ),
);
