/**
 * AI chat sessions on top of the Claude Agent SDK. Each session maps to a Claude Code session
 * (resumed between turns) and streams events to the UI over SSE (see worker.ts /ai/events).
 * Authentication is whatever the Claude Code CLI is logged in with (subscription or API key).
 */
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { query, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
  AiAccount,
  AiContext,
  AiEffort,
  AiEvent,
  AiMessage,
  AiMessagePart,
  AiModelOption,
  AiRateLimit,
  AiSessionDetail,
  AiSessionInfo,
  AiSettings,
  AiStatus,
  AiUiAction,
} from "@shared/types";
import { CONFIG_DIR, connections } from "../connections";
import { DriverError } from "../drivers";
import { createDbToolServer } from "./tools";

const SESSIONS_FILE = join(CONFIG_DIR, "ai-sessions.json");
const SETTINGS_FILE = join(CONFIG_DIR, "ai-settings.json");
const MAX_TURNS = 40;

const EFFORTS: AiEffort[] = ["low", "medium", "high", "xhigh", "max"];

/** Used only until the CLI has been asked (or when it cannot be started). */
const FALLBACK_MODELS: AiModelOption[] = [
  { value: "", label: "Claude Code default", description: "Whatever your Claude Code is configured to use", supportsEffort: true, effortLevels: EFFORTS },
  { value: "opus", label: "Opus", description: "For complex work", supportsEffort: true, effortLevels: EFFORTS },
  { value: "sonnet", label: "Sonnet", description: "Efficient for simpler tasks", supportsEffort: true, effortLevels: EFFORTS },
  { value: "haiku", label: "Haiku", description: "Fastest for quick answers", supportsEffort: true, effortLevels: EFFORTS },
];

/**
 * Models and account as the CLI reports them for the logged-in user. Starts a Claude Code process in
 * streaming-input mode without ever sending a prompt (no tokens spent), asks, and closes it. Cached.
 */
let probeCache: { at: number; models: AiModelOption[]; account: AiAccount | null; authMode: string } | null = null;
async function probeCli(): Promise<{ models: AiModelOption[]; account: AiAccount | null }> {
  await loadSettings();
  const key = settings.authMode + (settings.apiKey ?? "");
  if (probeCache && probeCache.authMode === key && Date.now() - probeCache.at < 5 * 60_000) return probeCache;
  let models = FALLBACK_MODELS;
  let account: AiAccount | null = null;
  async function* never(): AsyncGenerator<never> {
    await new Promise<void>(() => {});
  }
  const q = query({
    prompt: never() as unknown as AsyncIterable<never>,
    options: {
      tools: [],
      settingSources: [],
      systemPrompt: "probe",
      maxTurns: 1,
      env: sdkEnv(),
      cwd: CONFIG_DIR,
      pathToClaudeCodeExecutable: resolveClaudeExecutable(),
    },
  });
  try {
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("CLI probe timed out")), 15_000));
    const [list, info] = await Promise.race([Promise.all([q.supportedModels(), q.accountInfo()]), timeout]);
    models = list.map((m) => ({
      value: m.value === "default" ? "" : m.value,
      label: m.value === "default" ? `Default (${m.description || m.resolvedModel || "Claude Code setting"})` : m.displayName,
      description: m.value === "default" ? m.resolvedModel : m.description,
      resolvedModel: m.resolvedModel,
      supportsEffort: Boolean(m.supportsEffort),
      effortLevels: (m.supportedEffortLevels ?? (m.supportsEffort ? EFFORTS : [])) as AiEffort[],
    }));
    models = latestPerFamily(models);
    if (!models.some((m) => m.value === "")) models.unshift(FALLBACK_MODELS[0]!);
    account = {
      loggedIn: true,
      email: info.email,
      orgName: info.organization,
      subscriptionType: info.subscriptionType,
      apiProvider: info.apiProvider,
      authMethod: info.tokenSource ?? info.apiKeySource,
    };
  } catch (error) {
    console.warn("[ai] CLI probe failed:", error instanceof Error ? error.message : error);
  } finally {
    try {
      q.close();
    } catch {
      // already closed
    }
  }
  probeCache = { at: Date.now(), models, account, authMode: key };
  return probeCache;
}

const DEFAULT_SETTINGS: AiSettings = { authMode: "subscription", apiKey: null, defaultModel: null, defaultEffort: null };
let settings: AiSettings = { ...DEFAULT_SETTINGS };
let settingsLoaded = false;

async function loadSettings(): Promise<AiSettings> {
  if (settingsLoaded) return settings;
  settingsLoaded = true;
  try {
    const file = Bun.file(SETTINGS_FILE);
    if (await file.exists()) settings = { ...DEFAULT_SETTINGS, ...((await file.json()) as Partial<AiSettings>) };
  } catch (error) {
    console.error("[ai] could not load settings:", error);
  }
  return settings;
}

async function saveSettings(): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await Bun.write(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

/** `claude auth status --json`, cached for a minute. */
let accountCache: { at: number; value: AiAccount | null } | null = null;
async function readAccount(): Promise<AiAccount | null> {
  if (accountCache && Date.now() - accountCache.at < 60_000) return accountCache.value;
  const cli = resolveClaudeExecutable() ?? Bun.which("claude");
  let value: AiAccount | null = null;
  if (cli) {
    try {
      const proc = Bun.spawn([cli, "auth", "status", "--json"], { stdout: "pipe", stderr: "pipe", env: cleanEnv() });
      const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      if (code === 0) {
        const j = JSON.parse(out) as Record<string, unknown>;
        value = {
          loggedIn: Boolean(j.loggedIn),
          authMethod: j.authMethod as string | undefined,
          email: j.email as string | undefined,
          orgName: j.orgName as string | undefined,
          subscriptionType: j.subscriptionType as string | undefined,
          apiProvider: j.apiProvider as string | undefined,
        };
      } else {
        value = { loggedIn: false };
      }
    } catch {
      value = { loggedIn: false };
    }
  }
  accountCache = { at: Date.now(), value };
  return value;
}

/** Environment for the CLI: never leak a stray ANTHROPIC_API_KEY into subscription mode, inject it in API mode. */
function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== "ANTHROPIC_API_KEY") env[k] = v;
  return env;
}

function sdkEnv(): Record<string, string> {
  const env = cleanEnv();
  if (settings.authMode === "apiKey" && settings.apiKey) env.ANTHROPIC_API_KEY = settings.apiKey;
  return env;
}

const rateLimits = new Map<string, AiRateLimit>();
let lastApiKeySource: string | null = null;

const SYSTEM_PROMPT = `You are the data assistant built into Drizzle Explorer, a desktop database client (PostgreSQL and SQLite).
You help the user explore, filter and analyze their databases with the provided tools. All database access is read-only.

The chat is for conversation only. Everything the user should SEE lives in the "Assistant playground" tab, which your tools fill:
- run_query executes SQL and shows the SQL plus the results there (also for browsing or filtering rows: write a SELECT with WHERE / ORDER BY / LIMIT). draft_query puts SQL there without running it.
- NEVER paste result rows, data tables, column dumps or SQL statements into the chat, and never use code blocks. The user has already got them in the playground; refer to it ("see the playground").
- In chat: one to three short sentences. State the key finding in prose (a total, a top value, a comparison), interpret it, and ask a clarifying question when the request is ambiguous (which connection, which table, which time range).

Working rules:
- If you do not know connection ids yet, call list_connections; call describe_table before writing joins or non-trivial SQL.
- Everything goes through SQL: counts, aggregations, joins, and row browsing/filtering alike.
- Use the connection's dialect (PostgreSQL vs SQLite) and add LIMIT when listing rows.
- Never invent data: every number you mention must come from a tool result. Say so when something could not be determined.
- Answer in the user's language.`;

type Listener = (event: AiEvent) => void;

interface Session {
  id: string;
  title: string;
  model: string | null;
  effort: AiEffort | null;
  createdAt: string;
  updatedAt: string;
  messages: AiMessage[];
  sdkSessionId?: string;
  running: boolean;
  abort?: AbortController;
  listeners: Set<Listener>;
}

const sessions = new Map<string, Session>();
let loaded = false;
let lastSeenModel: string | null = null;

async function load(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const file = Bun.file(SESSIONS_FILE);
    if (await file.exists()) {
      const data = (await file.json()) as { sessions?: Omit<Session, "running" | "abort" | "listeners">[] };
      for (const s of data.sessions ?? []) sessions.set(s.id, { ...s, effort: s.effort ?? null, running: false, listeners: new Set() });
    }
  } catch (error) {
    console.error("[ai] could not load sessions:", error);
  }
}

let persistTimer: ReturnType<typeof setTimeout> | undefined;
function persist(): void {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(async () => {
    try {
      await mkdir(CONFIG_DIR, { recursive: true });
      const list = [...sessions.values()].map(({ running: _r, abort: _a, listeners: _l, ...rest }) => rest);
      await Bun.write(SESSIONS_FILE, JSON.stringify({ version: 1, sessions: list }, null, 2));
    } catch (error) {
      console.error("[ai] could not save sessions:", error);
    }
  }, 300);
}

function info(s: Session): AiSessionInfo {
  return {
    id: s.id,
    title: s.title,
    model: s.model,
    effort: s.effort ?? null,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    running: s.running,
    messageCount: s.messages.length,
  };
}

async function get(id: string): Promise<Session> {
  await load();
  const s = sessions.get(id);
  if (!s) throw new DriverError(`Chat session ${id} not found`, "NOT_FOUND");
  return s;
}

function emit(s: Session, event: AiEvent): void {
  for (const l of s.listeners) {
    try {
      l(event);
    } catch {
      // listener failures must not break the turn
    }
  }
}

export function resolveClaudeExecutable(): string | undefined {
  // The SDK bundles a native binary via optional dependencies; inside a compiled app that package is not
  // on disk, so fall back to the Claude Code CLI the user has installed (same login).
  const standalone = Boolean((Bun as unknown as { isStandaloneExecutable?: boolean }).isStandaloneExecutable);
  if (!standalone) return undefined;
  const home = process.env.HOME ?? "";
  for (const candidate of ["claude", join(home, ".local/bin/claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"]) {
    const found = Bun.which(candidate);
    if (found) return found;
  }
  return undefined;
}

export const ai = {
  async status(): Promise<AiStatus> {
    await loadSettings();
    const standalone = Boolean((Bun as unknown as { isStandaloneExecutable?: boolean }).isStandaloneExecutable);
    const cli = resolveClaudeExecutable() ?? Bun.which("claude");
    const available = !standalone || Boolean(cli);
    const probe = available ? await probeCli() : { models: FALLBACK_MODELS, account: null };
    const cliAccount = await readAccount();
    // SDK accountInfo has the nicer plan name; the CLI status has loggedIn + email when the SDK could not start.
    const account: AiAccount | null = probe.account
      ? { ...cliAccount, ...probe.account, email: probe.account.email ?? cliAccount?.email, loggedIn: true }
      : cliAccount;
    return {
      available,
      detail: available
        ? `Claude Agent SDK${cli ? ` · ${cli}` : " · bundled runtime"}`
        : "Claude Code CLI not found. Install it and run `claude` once to log in.",
      settings: { ...settings, apiKey: settings.apiKey ? maskKey(settings.apiKey) : null },
      account,
      lastModel: lastSeenModel,
      lastApiKeySource,
      rateLimits: [...rateLimits.values()].sort((a, b) => a.rateLimitType?.localeCompare(b.rateLimitType ?? "") ?? 0),
      models: probe.models,
      efforts: EFFORTS,
    };
  },

  async updateSettings(patch: Partial<AiSettings>): Promise<AiSettings> {
    await loadSettings();
    const next = { ...settings, ...patch };
    // A masked key coming back from the UI means "unchanged".
    if (typeof patch.apiKey === "string" && /^sk-.*…/.test(patch.apiKey)) next.apiKey = settings.apiKey;
    if (patch.apiKey === "") next.apiKey = null;
    settings = next;
    probeCache = null; // credentials may have changed → re-read models/account
    await saveSettings();
    return { ...settings, apiKey: settings.apiKey ? maskKey(settings.apiKey) : null };
  },

  async list(): Promise<AiSessionInfo[]> {
    await load();
    return [...sessions.values()].map(info).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async detail(id: string): Promise<AiSessionDetail> {
    const s = await get(id);
    return { ...info(s), messages: s.messages };
  },

  async create(model: string | null | undefined, effort?: AiEffort | null): Promise<AiSessionInfo> {
    await load();
    const now = new Date().toISOString();
    const s: Session = {
      id: crypto.randomUUID(),
      title: "New chat",
      model: model || null,
      effort: effort ?? null,
      createdAt: now,
      updatedAt: now,
      messages: [],
      running: false,
      listeners: new Set(),
    };
    sessions.set(s.id, s);
    persist();
    return info(s);
  },

  async remove(id: string): Promise<boolean> {
    await load();
    const s = sessions.get(id);
    if (!s) return false;
    s.abort?.abort();
    sessions.delete(id);
    persist();
    return true;
  },

  async configure(id: string, patch: { model?: string | null; effort?: AiEffort | null }): Promise<AiSessionInfo> {
    const s = await get(id);
    if (patch.model !== undefined) s.model = patch.model || null;
    if (patch.effort !== undefined) s.effort = patch.effort || null;
    persist();
    return info(s);
  },

  async subscribe(id: string, listener: Listener): Promise<() => void> {
    const s = await get(id);
    s.listeners.add(listener);
    return () => s.listeners.delete(listener);
  },

  async cancel(id: string): Promise<boolean> {
    const s = await get(id);
    if (!s.running) return false;
    s.abort?.abort();
    return true;
  },

  async send(id: string, text: string, context: AiContext | undefined): Promise<{ messageId: string }> {
    const s = await get(id);
    if (s.running) throw new DriverError("The assistant is still answering; wait or cancel first", "BUSY");
    const trimmed = text.trim();
    if (!trimmed) throw new DriverError("Message is empty", "BAD_REQUEST");

    const now = new Date().toISOString();
    s.messages.push({ id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: trimmed }], createdAt: now });
    if (s.messages.length === 1) s.title = trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed;
    const assistant: AiMessage = { id: crypto.randomUUID(), role: "assistant", parts: [], createdAt: now };
    s.messages.push(assistant);
    s.running = true;
    s.updatedAt = now;
    persist();
    emit(s, { type: "turn_started", messageId: assistant.id });

    void runTurn(s, assistant, await buildPrompt(trimmed, context));
    return { messageId: assistant.id };
  },
};

async function buildPrompt(text: string, context: AiContext | undefined): Promise<string> {
  const list = await connections.list();
  const lines: string[] = [
    `Connections available: ${list.map((c) => `${c.name} (id=${c.id}, ${c.dialect})`).join("; ") || "none"}.`,
  ];
  if (context?.connectionId) {
    const c = list.find((x) => x.id === context.connectionId);
    const where = [
      context.table ? `table ${context.schema ? `${context.schema}.` : ""}${context.table}` : null,
      context.filters?.length ? `filters ${JSON.stringify(context.filters)}` : null,
      context.where ? `raw where "${context.where}"` : null,
      context.sql ? `SQL editor content:\n${context.sql}` : null,
    ].filter(Boolean);
    lines.push(`The user is currently looking at connection ${c?.name ?? context.connectionId} (id=${context.connectionId})${where.length ? `, ${where.join(", ")}` : ""}.`);
  }
  return `[App context]\n${lines.join("\n")}\n[Current date: ${new Date().toISOString().slice(0, 10)}]\n\n${text}`;
}

async function runTurn(s: Session, assistant: AiMessage, prompt: string): Promise<void> {
  const abort = new AbortController();
  s.abort = abort;
  await loadSettings();
  const server = createDbToolServer((action: AiUiAction) => emit(s, { type: "ui_action", action }));
  const model = s.model ?? settings.defaultModel ?? undefined;
  const effort = s.effort ?? settings.defaultEffort ?? undefined;
  const options: Options = {
    model: model || undefined,
    effort: effort ?? undefined,
    env: sdkEnv(),
    resume: s.sdkSessionId,
    mcpServers: { db: server },
    allowedTools: ["mcp__db__*"],
    tools: [],
    systemPrompt: SYSTEM_PROMPT,
    permissionMode: "default",
    settingSources: [],
    maxTurns: MAX_TURNS,
    includePartialMessages: true,
    abortController: abort,
    cwd: CONFIG_DIR,
    pathToClaudeCodeExecutable: resolveClaudeExecutable(),
  };

  let openText: AiMessagePart | null = null; // text part currently receiving deltas
  const ensureText = (): Extract<AiMessagePart, { type: "text" }> => {
    if (openText?.type === "text") return openText;
    const part: AiMessagePart = { type: "text", text: "" };
    assistant.parts.push(part);
    openText = part;
    return part;
  };

  try {
    await mkdir(CONFIG_DIR, { recursive: true });
    for await (const m of query({ prompt, options }) as AsyncIterable<SDKMessage>) {
      if (m.type === "system" && m.subtype === "init") {
        s.sdkSessionId = m.session_id;
        lastSeenModel = m.model ?? lastSeenModel;
        lastApiKeySource = m.apiKeySource ?? lastApiKeySource;
        emit(s, { type: "status", text: `model ${m.model} · auth ${m.apiKeySource}` });
      } else if (m.type === "rate_limit_event") {
        const r = m.rate_limit_info;
        rateLimits.set(r.rateLimitType ?? "default", {
          status: r.status,
          rateLimitType: r.rateLimitType,
          utilization: r.utilization,
          resetsAt: r.resetsAt,
          isUsingOverage: r.isUsingOverage,
          observedAt: new Date().toISOString(),
        });
      } else if (m.type === "stream_event") {
        const e = m.event;
        if (e.type === "content_block_delta" && e.delta.type === "text_delta") {
          ensureText().text += e.delta.text;
          emit(s, { type: "text_delta", messageId: assistant.id, text: e.delta.text });
        }
      } else if (m.type === "assistant") {
        const texts = m.message.content.filter((b) => b.type === "text").map((b) => b.text);
        if (texts.length) {
          const part = ensureText();
          part.text = texts.join("\n");
          emit(s, { type: "assistant_text", messageId: assistant.id, text: part.text });
        }
        openText = null;
        for (const b of m.message.content) {
          if (b.type === "tool_use") {
            assistant.parts.push({ type: "tool", id: b.id, name: shortToolName(b.name), input: b.input });
            emit(s, { type: "tool_call", messageId: assistant.id, id: b.id, name: shortToolName(b.name), input: b.input });
          }
        }
      } else if (m.type === "user") {
        const content = m.message.content;
        if (Array.isArray(content)) {
          for (const b of content) {
            if (b.type !== "tool_result") continue;
            const part = assistant.parts.find((p) => p.type === "tool" && p.id === b.tool_use_id);
            const output = toolResultText(b.content);
            if (part && part.type === "tool") {
              part.output = output;
              part.isError = Boolean(b.is_error);
            }
            emit(s, { type: "tool_result", messageId: assistant.id, id: b.tool_use_id, output, isError: Boolean(b.is_error) });
          }
        }
      } else if (m.type === "result") {
        s.sdkSessionId = m.session_id;
        assistant.stats = { costUsd: m.total_cost_usd, durationMs: m.duration_ms, turns: m.num_turns };
        if (m.subtype !== "success") {
          const message = m.errors?.join("\n") || `Stopped: ${m.subtype}`;
          assistant.error = message;
          emit(s, { type: "turn_error", messageId: assistant.id, message });
        }
      }
    }
    if (!assistant.error) emit(s, { type: "turn_done", messageId: assistant.id, stats: assistant.stats });
  } catch (error) {
    const message = abort.signal.aborted ? "Cancelled" : error instanceof Error ? error.message : String(error);
    assistant.error = message;
    emit(s, { type: "turn_error", messageId: assistant.id, message });
  } finally {
    s.running = false;
    s.abort = undefined;
    s.updatedAt = new Date().toISOString();
    persist();
  }
}

/** Keeps the default entry plus the newest version of each model family (opus, fable, sonnet, haiku…). */
function latestPerFamily(models: AiModelOption[]): AiModelOption[] {
  const parse = (id: string | undefined) => {
    const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(id ?? "");
    return m ? { family: m[1]!, version: Number(m[2]) + Number(m[3] ?? 0) / 100 } : null;
  };
  const best = new Map<string, { model: AiModelOption; version: number }>();
  const others: AiModelOption[] = [];
  for (const m of models) {
    if (m.value === "") continue;
    const p = parse(m.resolvedModel ?? m.value);
    if (!p) {
      others.push(m);
      continue;
    }
    const current = best.get(p.family);
    // Prefer the newer version; on a tie prefer the alias ("opus") over the dated id.
    if (!current || p.version > current.version || (p.version === current.version && !m.value.startsWith("claude-"))) {
      best.set(p.family, { model: m, version: p.version });
    }
  }
  const order = ["fable", "opus", "sonnet", "haiku"];
  const rank = (family: string) => (order.includes(family) ? order.indexOf(family) : order.length);
  const picked = [...best.entries()].sort((a, b) => rank(a[0]) - rank(b[0])).map(([, v]) => v.model);
  return [...models.filter((m) => m.value === ""), ...picked, ...others];
}

function maskKey(key: string): string {
  return key.length > 12 ? `${key.slice(0, 7)}…${key.slice(-4)}` : "…";
}

function shortToolName(name: string): string {
  return name.replace(/^mcp__db__/, "");
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && "text" in b ? String((b as { text: unknown }).text) : JSON.stringify(b)))
      .join("\n");
  }
  return content === undefined ? "" : JSON.stringify(content);
}
