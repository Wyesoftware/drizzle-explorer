import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import type { SavedQuery } from "@shared/types";
import { CONFIG_DIR } from "./connections";
import { DriverError } from "./drivers";

const QUERIES_FILE = join(CONFIG_DIR, "queries.json");

/**
 * The SQL library: queries the user saved by name per connection (`threadId === null`), plus one
 * unnamed entry per assistant chat holding the latest SQL of its playground (`threadId` set). Only
 * the named ones are listed; a chat's entry can be copied into the library with `save`.
 */
let cache: SavedQuery[] | null = null;

async function all(): Promise<SavedQuery[]> {
  if (cache) return cache;
  try {
    const file = Bun.file(QUERIES_FILE);
    if (await file.exists()) {
      const parsed = (await file.json()) as { queries?: SavedQuery[] };
      cache = Array.isArray(parsed.queries) ? parsed.queries : [];
    } else {
      cache = [];
    }
  } catch (error) {
    console.error(`Failed to read ${QUERIES_FILE}:`, error);
    cache = [];
  }
  return cache;
}

let persistTimer: ReturnType<typeof setTimeout> | undefined;
function persist(): void {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(async () => {
    try {
      await mkdir(CONFIG_DIR, { recursive: true });
      await Bun.write(QUERIES_FILE, JSON.stringify({ version: 1, queries: cache ?? [] }, null, 2));
    } catch (error) {
      console.error(`Failed to write ${QUERIES_FILE}:`, error);
    }
  }, 200);
}

export const queries = {
  /** Named queries, newest first; optionally only those of one connection. */
  async list(connectionId?: string | null): Promise<SavedQuery[]> {
    const list = (await all()).filter((q) => q.threadId === null && (!connectionId || q.connectionId === connectionId));
    return list.sort((a, b) => a.name.localeCompare(b.name));
  },

  async save(input: { id?: string | null; connectionId: string | null; name: string; sql: string }): Promise<SavedQuery> {
    const list = await all();
    const name = input.name.trim().slice(0, 120);
    if (!name) throw new DriverError("Give the query a name", "BAD_REQUEST");
    const now = new Date().toISOString();
    const existing = input.id ? list.find((q) => q.id === input.id && q.threadId === null) : undefined;
    if (existing) {
      existing.name = name;
      existing.sql = input.sql;
      existing.connectionId = input.connectionId;
      existing.updatedAt = now;
      persist();
      return existing;
    }
    const created: SavedQuery = {
      id: crypto.randomUUID(),
      connectionId: input.connectionId,
      threadId: null,
      name,
      sql: input.sql,
      createdAt: now,
      updatedAt: now,
    };
    list.push(created);
    persist();
    return created;
  },

  async remove(id: string): Promise<boolean> {
    const list = await all();
    const index = list.findIndex((q) => q.id === id);
    if (index < 0) return false;
    list.splice(index, 1);
    persist();
    return true;
  },

  /** Drops the named queries of a deleted connection (chat entries keep their SQL). */
  async removeForConnection(connectionId: string): Promise<void> {
    cache = (await all()).filter((q) => !(q.threadId === null && q.connectionId === connectionId));
    persist();
  },

  async thread(threadId: string): Promise<SavedQuery | null> {
    return (await all()).find((q) => q.threadId === threadId) ?? null;
  },

  /** Latest SQL of a chat's playground (written by the assistant's tools and by edits in the editor). */
  async setThread(threadId: string, connectionId: string | null, sql: string): Promise<SavedQuery> {
    const list = await all();
    const now = new Date().toISOString();
    let entry = list.find((q) => q.threadId === threadId);
    if (!entry) {
      entry = { id: crypto.randomUUID(), connectionId, threadId, name: "", sql, createdAt: now, updatedAt: now };
      list.push(entry);
    } else {
      entry.connectionId = connectionId;
      entry.sql = sql;
      entry.updatedAt = now;
    }
    persist();
    return entry;
  },

  async removeThread(threadId: string): Promise<void> {
    cache = (await all()).filter((q) => q.threadId !== threadId);
    persist();
  },
};
