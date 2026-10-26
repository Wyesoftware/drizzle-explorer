/**
 * UI preferences store: `ui-state.json` in the config directory, next to `connections.json`.
 * The UI keeps its persisted zustand stores (settings, column formats, theme) here instead of
 * localStorage, because the backend port — and therefore the page origin — changes on every launch.
 * Entries are opaque strings keyed by store name.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_DIR } from "./connections";

const FILE = join(CONFIG_DIR, "ui-state.json");

let entries: Record<string, string> | null = null;
let writing: Promise<void> = Promise.resolve();

async function load(): Promise<Record<string, string>> {
  if (entries) return entries;
  try {
    const file = Bun.file(FILE);
    if (await file.exists()) {
      const parsed = (await file.json()) as { entries?: Record<string, string> };
      entries = parsed.entries && typeof parsed.entries === "object" ? parsed.entries : {};
    } else entries = {};
  } catch (error) {
    console.warn("[prefs] could not read ui-state.json, starting empty:", error);
    entries = {};
  }
  return entries;
}

export async function getUiState(): Promise<Record<string, string>> {
  return { ...(await load()) };
}

/** Sets (or deletes, with null) one entry and persists the file; writes are serialized. */
export async function setUiState(key: string, value: string | null): Promise<void> {
  const current = await load();
  if (value === null) delete current[key];
  else current[key] = value;
  writing = writing.then(async () => {
    await mkdir(CONFIG_DIR, { recursive: true });
    await Bun.write(FILE, JSON.stringify({ version: 1, entries: current }, null, 2));
  });
  await writing;
}
