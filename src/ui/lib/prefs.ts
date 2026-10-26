/**
 * Backend-persisted storage for UI preferences (zustand `persist` stores and the theme).
 *
 * The cache is filled once by `loadPrefs()` before the app module is imported (see main.tsx), so the
 * stores hydrate synchronously from it; writes go to `ui.setState` (debounced per key). This replaces
 * localStorage, which is scoped to the page origin and thus to the backend's dynamic port.
 */
import type { StateStorage } from "zustand/middleware";
import { rpc } from "@/lib/rpc";

const cache = new Map<string, string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const WRITE_DELAY_MS = 300;

/** Keys written by earlier versions to localStorage; copied over once when the backend has nothing yet. */
const LEGACY_KEYS = ["drizzle-explorer.settings", "drizzle-explorer.formats", "drizzle-explorer.theme"];

export async function loadPrefs(): Promise<void> {
  try {
    const state = await rpc("ui.state", {});
    for (const [key, value] of Object.entries(state)) cache.set(key, value);
  } catch (error) {
    console.warn("[prefs] backend unavailable, preferences will not persist:", error);
    return;
  }
  for (const key of LEGACY_KEYS) {
    if (cache.has(key)) continue;
    const legacy = localStorage.getItem(key);
    if (legacy !== null) {
      cache.set(key, legacy);
      void rpc("ui.setState", { key, value: legacy }).then(() => localStorage.removeItem(key));
    }
  }
}

function flush(key: string): void {
  timers.delete(key);
  void rpc("ui.setState", { key, value: cache.get(key) ?? null }).catch((error) => console.warn("[prefs] write failed:", error));
}

function schedule(key: string): void {
  const existing = timers.get(key);
  if (existing) clearTimeout(existing);
  timers.set(key, setTimeout(() => flush(key), WRITE_DELAY_MS));
}

export const prefsStorage: StateStorage = {
  getItem: (key) => cache.get(key) ?? null,
  setItem: (key, value) => {
    cache.set(key, value);
    schedule(key);
  },
  removeItem: (key) => {
    cache.delete(key);
    schedule(key);
  },
};
