import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowUpIcon,
  BotIcon,
  DatabaseIcon,
  BrainIcon,
  ChevronDownIcon,
  CpuIcon,
  SparklesIcon,
  SquareIcon,
} from "lucide-react";
import type { AiContext, AiEffort, AiEvent } from "@shared/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { NativeSelect } from "@/components/NativeSelect";
import { EmptyState } from "@/components/EmptyState";
import { errorMessage, rpc } from "@/lib/rpc";
import { useAiStore } from "@/lib/ai-store";
import { useAppStore } from "@/lib/store";
import { modKey } from "@/lib/format";
import { cn } from "@/lib/utils";
import { formatSql } from "@/lib/sql-format";
import { ChatMessage } from "./ChatMessage";
import { configureSession, loadSession, markThreadQuery } from "./session-actions";
import { RateLimitBadge } from "./RateLimits";

const EFFORT_LABELS: Record<AiEffort, string> = {
  low: "Low · quick answers",
  medium: "Medium",
  high: "High · thorough",
  xhigh: "Extra high",
  max: "Max · deepest reasoning",
};

/** Chat pane of assistant mode. Talks to the backend over RPC + an SSE stream per session. */
export function AiPanel() {
  const store = useAiStore();
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["ai", "status"], queryFn: () => rpc("ai.status", {}), staleTime: 30_000 });
  const sessions = useQuery({ queryKey: ["ai", "sessions"], queryFn: () => rpc("ai.sessions", {}) });
  const connectionsList = useQuery({ queryKey: ["connections"], queryFn: () => rpc("connections.list", {}) });
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const ensurePlayground = useAppStore((s) => s.ensurePlayground);
  const updatePlayground = useAppStore((s) => s.updatePlayground);
  const playgroundQuery = useAppStore((s) => s.playgroundQuery);
  const updateTab = useAppStore((s) => s.updateTab);
  const playground = useAppStore((s) => (store.activeId ? (s.playgrounds[store.activeId] ?? null) : null));
  // Connection chosen before the first message of a brand-new chat (no playground exists yet).
  const [draftConnectionId, setDraftConnectionId] = useState<string | null>(null);

  // The chat always works on the playground next to it: its connection and whatever SQL is in the editor.
  const connectionId = playground ? playground.connectionId : draftConnectionId;
  const context = useMemo<AiContext | undefined>(() => {
    if (!connectionId) return undefined;
    return { connectionId, sql: playground?.sql.sql.trim() || undefined };
  }, [connectionId, playground?.sql.sql]);

  // Selecting a connection in the chat stores it on the session and the playground editor, so all three agree.
  const selectConnection = (id: string | null) => {
    if (store.activeId) void configureSession(store.activeId, { connectionId: id });
    else setDraftConnectionId(id);
  };
  // Connection changed on the playground side (its own selector, or a query the assistant ran) → persist.
  const active = store.sessions.find((s) => s.id === store.activeId);
  useEffect(() => {
    if (!playground || !active || playground.connectionId === active.connectionId) return;
    void rpc("ai.configure", { id: active.id, connectionId: playground.connectionId }).then(() =>
      queryClient.invalidateQueries({ queryKey: ["ai", "sessions"] }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playground?.connectionId]);

  useEffect(() => {
    if (!sessions.data) return;
    store.setSessions(sessions.data);
    const all = useAppStore.getState().playgrounds;
    for (const s of sessions.data) {
      const p = all[s.id];
      if (p && p.title !== s.title) updatePlayground(s.id, { title: s.title });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions.data]);

  // On mount: re-read the active chat (events while the pane was unmounted are gone) or open the latest one.
  const loadedOnMount = useRef(false);
  useEffect(() => {
    if (loadedOnMount.current || !sessions.data) return;
    loadedOnMount.current = true;
    const id = store.activeId ?? sessions.data[0]?.id;
    if (id) void loadSession(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions.data]);

  // SSE stream per session, connected *before* sending so no event of a brand-new chat is lost.
  const source = useRef<{ id: string; es: EventSource; ready: Promise<void> } | null>(null);
  const connect = useCallback(
    (id: string): Promise<void> => {
      if (source.current?.id === id) return source.current.ready;
      source.current?.es.close();
      const es = new EventSource(`/ai/events?id=${encodeURIComponent(id)}`);
      let resolveReady = () => {};
      const ready = new Promise<void>((resolve) => {
        resolveReady = resolve;
        setTimeout(resolve, 2000);
      });
      es.onmessage = (e) => {
        let event: AiEvent;
        try {
          event = JSON.parse(e.data) as AiEvent;
        } catch {
          return;
        }
        if (event.type === "status") {
          resolveReady();
          if (event.text.startsWith("model ")) void queryClient.invalidateQueries({ queryKey: ["ai", "status"] });
          return;
        }
        if (event.type === "session_updated") {
          void queryClient.invalidateQueries({ queryKey: ["ai", "sessions"] });
          return;
        }
        if (event.type === "ui_action") {
          const a = event.action;
          const sid = useAiStore.getState().activeId;
          if (!sid) return;
          const title = useAiStore.getState().sessions.find((x) => x.id === sid)?.title ?? "chat";
          const dialect = (connectionsList.data ?? []).find((c) => c.id === a.connectionId)?.dialect;
          const formatted = formatSql(a.sql, dialect);
          markThreadQuery(sid, formatted);
          playgroundQuery(sid, title, a.connectionId, formatted, a.run);
          return;
        }
        useAiStore.getState().applyEvent(event);
        if (event.type === "turn_done" || event.type === "turn_error") {
          void queryClient.invalidateQueries({ queryKey: ["ai", "sessions"] });
          void queryClient.invalidateQueries({ queryKey: ["ai", "status"] });
        }
      };
      source.current = { id, es, ready };
      return ready;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [connectionsList.data],
  );
  useEffect(() => {
    if (store.activeId) void connect(store.activeId);
    return () => {
      if (!store.activeId) return;
      source.current?.es.close();
      source.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.activeId]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [store.messages]);

  async function send() {
    const text = input.trim();
    if (!text || store.running) return;
    let id = store.activeId;
    if (!id) {
      const s = await rpc("ai.create", { connectionId: draftConnectionId });
      id = s.id;
      store.setActive(id, []);
      ensurePlayground(id, text.slice(0, 40));
      markThreadQuery(id, "");
      if (draftConnectionId) {
        updateTab(useAppStore.getState().playgrounds[id]!.sql.id, { connectionId: draftConnectionId });
        setDraftConnectionId(null);
      }
      await queryClient.invalidateQueries({ queryKey: ["ai", "sessions"] });
    }
    setInput("");
    store.appendUser({ id: `local-${Date.now()}`, role: "user", parts: [{ type: "text", text }], createdAt: new Date().toISOString() });
    store.setRunning(true);
    try {
      await connect(id);
      const { messageId } = await rpc("ai.send", { id, text, context });
      useAiStore.getState().applyEvent({ type: "turn_started", messageId });
    } catch (e) {
      store.setRunning(false);
      toast.error("Could not send", { description: errorMessage(e) });
    }
  }

  async function configure(patch: { model?: string | null; effort?: AiEffort | null }) {
    if (!store.activeId) return;
    await rpc("ai.configure", { id: store.activeId, ...patch });
    await queryClient.invalidateQueries({ queryKey: ["ai", "sessions"] });
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (!e.shiftKey || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send();
    }
  };

  const st = status.data;
  const modelValue = active?.model ?? st?.settings.defaultModel ?? "";
  const modelLabel = st?.models.find((m) => m.value === modelValue)?.label ?? modelValue ?? "Model";
  const effortValue = active?.effort ?? st?.settings.defaultEffort ?? null;
  const selectedModel = st?.models.find((m) => m.value === modelValue);
  const effortLevels = selectedModel?.effortLevels?.length ? selectedModel.effortLevels : (st?.efforts ?? []);
  const connection = connectionsList.data?.find((c) => c.id === connectionId) ?? null;
  const unavailable = st ? !st.available : false;
  const billing = st?.settings.authMode === "apiKey" ? "API key" : (st?.account?.subscriptionType ?? "subscription");

  return (
    <aside className="flex h-full min-w-0 flex-col bg-background">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <SparklesIcon className="size-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{active?.title ?? "New chat"}</span>
        {connection && (
          <span className="flex shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground" title={`Working on ${connection.name} (${connection.dialect})`}>
            <DatabaseIcon className="size-3" /> {connection.name}
          </span>
        )}
      </header>

      {st && !st.available && <div className="border-b bg-destructive/10 px-3 py-2 text-xs text-destructive">{st.detail}</div>}
      {st?.settings.authMode === "subscription" && st.account && !st.account.loggedIn && (
        <div className="border-b bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
          Not logged in to Claude Code. Run <code>claude</code> and <code>/login</code>, or switch to an API key in Settings → Assistant.
        </div>
      )}

      <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-3 py-3">
        {store.messages.length === 0 ? (
          <EmptyState
            icon={<BotIcon />}
            title="Ask about your data"
            description="Try “How many active users signed up this month?” or “Which users have no posts?”. Queries and results appear in the playground on the right; the chat stays short and read-only."
          />
        ) : (
          store.messages.map((m) => <ChatMessage key={m.id} message={m} />)
        )}
      </div>

      <footer className="shrink-0 border-t p-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <InputGroup className="items-stretch">
            <InputGroupTextarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder={store.running ? "Assistant is working…" : "Ask about your data… (Enter to send, Shift+Enter for a new line)"}
              className="max-h-40 min-h-14 p-3 text-sm"
              disabled={unavailable}
            />
            <InputGroupAddon align="block-end" className="flex-wrap gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger render={<InputGroupButton variant="ghost" size="xs" aria-label="Model" className="max-w-44" />}>
                  <CpuIcon /> <span className="truncate">{modelLabel}</span> <ChevronDownIcon className="size-3 shrink-0" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-96 w-72 overflow-auto">
                  <DropdownMenuGroup>
                  <DropdownMenuLabel>Model for this chat</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={modelValue} onValueChange={(v) => void configure({ model: (v as string) || null })}>
                    {st?.models.map((m) => (
                      <DropdownMenuRadioItem key={m.value} value={m.value} closeOnClick>
                        <div className="flex flex-col">
                          <span>{m.label}</span>
                          {m.description && <span className="text-[11px] text-muted-foreground">{m.description}</span>}
                        </div>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger render={<InputGroupButton variant="ghost" size="xs" aria-label="Reasoning effort" />}>
                  <BrainIcon /> {effortValue ? EFFORT_LABELS[effortValue].split(" ·")[0] : "Reasoning"} <ChevronDownIcon className="size-3" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-60">
                  <DropdownMenuGroup>
                  <DropdownMenuLabel>Reasoning effort</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={effortValue ?? ""} onValueChange={(v) => void configure({ effort: ((v as string) || null) as AiEffort | null })}>
                    <DropdownMenuRadioItem value="" closeOnClick>
                      Model default
                    </DropdownMenuRadioItem>
                    {effortLevels.map((e) => (
                      <DropdownMenuRadioItem key={e} value={e} closeOnClick>
                        {EFFORT_LABELS[e]}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <span className="ml-auto" />
              {store.running ? (
                <InputGroupButton
                  variant="destructive"
                  size="icon-xs"
                  aria-label="Stop"
                  onClick={() => store.activeId && void rpc("ai.cancel", { id: store.activeId })}
                >
                  <SquareIcon />
                </InputGroupButton>
              ) : (
                <InputGroupButton type="submit" variant="default" size="icon-xs" aria-label="Send" disabled={!input.trim() || unavailable}>
                  <ArrowUpIcon />
                </InputGroupButton>
              )}
            </InputGroupAddon>
          </InputGroup>
        </form>
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-muted-foreground">
          <label
            className={cn("flex min-w-0 items-center gap-1", !connection && "text-amber-600 dark:text-amber-500")}
            title={connection ? `The assistant works on "${connection.name}" (${connection.dialect}); SQL in the playground is sent along.` : "Pick the connection the assistant should work on"}
          >
            <DatabaseIcon className="size-3 shrink-0" />
            <NativeSelect
              value={connectionId ?? ""}
              onChange={(e) => selectConnection(e.target.value || null)}
              className="min-w-0 max-w-52 [&>select]:h-6 [&>select]:border-0 [&>select]:bg-transparent [&>select]:pl-1 [&>select]:text-[11px] [&>select]:font-medium [&>select]:dark:bg-transparent"
              aria-label="Connection"
            >
              <option value="">No connection</option>
              {(connectionsList.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </label>
          <RateLimitBadge limits={st?.rateLimits ?? []} />
          <span className="truncate">Billing: {billing}</span>
          {st?.lastModel && <span className="truncate">Model: {st.lastModel}</span>}
          <span className="ml-auto hidden xl:inline">{modKey}+Enter sends</span>
        </div>
      </footer>

    </aside>
  );
}
