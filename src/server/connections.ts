import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ConnectionConfig, ConnectionStatus } from "@shared/types";
import { createDriver, DriverError, type Driver } from "./drivers";

export const CONFIG_DIR =
  process.env.DRIZZLE_EXPLORER_CONFIG_DIR ?? join(homedir(), ".config", "drizzle-explorer");
const CONNECTIONS_FILE = join(CONFIG_DIR, "connections.json");

interface LiveConnection {
  driver: Driver;
  serverVersion: string;
}

class ConnectionManager {
  private configs: ConnectionConfig[] | null = null;
  private live = new Map<string, LiveConnection>();
  private errors = new Map<string, string>();

  async list(): Promise<ConnectionConfig[]> {
    if (this.configs) return this.configs;
    try {
      const file = Bun.file(CONNECTIONS_FILE);
      if (await file.exists()) {
        const parsed = (await file.json()) as { connections?: ConnectionConfig[] };
        this.configs = Array.isArray(parsed.connections) ? parsed.connections : [];
      } else {
        this.configs = [];
      }
    } catch (error) {
      console.error(`Failed to read ${CONNECTIONS_FILE}:`, error);
      this.configs = [];
    }
    return this.configs;
  }

  async get(id: string): Promise<ConnectionConfig> {
    const config = (await this.list()).find((c) => c.id === id);
    if (!config) throw new DriverError(`Connection ${id} not found`, "NOT_FOUND");
    return config;
  }

  async save(config: ConnectionConfig): Promise<ConnectionConfig> {
    const list = await this.list();
    const normalized: ConnectionConfig = {
      ...config,
      id: config.id || crypto.randomUUID(),
      name: config.name?.trim() || defaultName(config),
      createdAt: config.createdAt || new Date().toISOString(),
    };
    const index = list.findIndex((c) => c.id === normalized.id);
    if (index >= 0) {
      list[index] = normalized;
      // Settings changed: drop the live connection so the next use reconnects.
      await this.disconnect(normalized.id);
    } else {
      list.push(normalized);
    }
    await this.persist();
    return normalized;
  }

  async remove(id: string): Promise<boolean> {
    const list = await this.list();
    const index = list.findIndex((c) => c.id === id);
    if (index < 0) return false;
    await this.disconnect(id);
    list.splice(index, 1);
    await this.persist();
    return true;
  }

  async test(config: ConnectionConfig): Promise<{ ok: true; serverVersion: string }> {
    const driver = createDriver(config);
    try {
      const { serverVersion } = await driver.connect();
      return { ok: true, serverVersion };
    } finally {
      await driver.close();
    }
  }

  async connect(id: string): Promise<ConnectionStatus> {
    const existing = this.live.get(id);
    if (existing) return { id, connected: true, serverVersion: existing.serverVersion };
    const config = await this.get(id);
    const driver = createDriver(config);
    try {
      const { serverVersion } = await driver.connect();
      this.live.set(id, { driver, serverVersion });
      this.errors.delete(id);
      return { id, connected: true, serverVersion };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.errors.set(id, message);
      throw error;
    }
  }

  async disconnect(id: string): Promise<ConnectionStatus> {
    const existing = this.live.get(id);
    this.live.delete(id);
    if (existing) await existing.driver.close();
    return { id, connected: false };
  }

  /** Returns a live driver, connecting lazily on first use. */
  async driver(id: string): Promise<Driver> {
    const existing = this.live.get(id);
    if (existing) return existing.driver;
    await this.connect(id);
    return this.live.get(id)!.driver;
  }

  async status(): Promise<ConnectionStatus[]> {
    const list = await this.list();
    return list.map((c) => {
      const live = this.live.get(c.id);
      return live
        ? { id: c.id, connected: true, serverVersion: live.serverVersion }
        : { id: c.id, connected: false, error: this.errors.get(c.id) };
    });
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.live.keys()].map((id) => this.disconnect(id)));
  }

  private async persist(): Promise<void> {
    await mkdir(CONFIG_DIR, { recursive: true });
    await Bun.write(CONNECTIONS_FILE, JSON.stringify({ version: 1, connections: this.configs ?? [] }, null, 2));
  }
}

function defaultName(config: ConnectionConfig): string {
  if (config.dialect === "sqlite") return config.file.split("/").pop() || "SQLite";
  if (config.url) {
    try {
      const u = new URL(config.url);
      return `${u.hostname}${u.pathname}`;
    } catch {
      return "PostgreSQL";
    }
  }
  return `${config.database ?? "postgres"}@${config.host ?? "localhost"}`;
}

export const connections = new ConnectionManager();
