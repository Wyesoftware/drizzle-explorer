import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowUpIcon,
  BotIcon,
  BrainIcon,
  ChevronDownIcon,
  CpuIcon,
  LayoutPanelTopIcon,
  PlusIcon,
  SettingsIcon,
  SparklesIcon,
  SquareIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import type { AiContext, AiEffort, AiEvent } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NativeSelect } from "@/components/NativeSelect";
import { EmptyState } from "@/components/EmptyState";
import { errorMessage, rpc } from "@/lib/rpc";
import { useAiStore } from "@/lib/ai-store";
import { playgroundTabId, useAppStore } from "@/lib/store";
import { modKey } from "@/lib/format";
import { formatSql } from "@/lib/sql-format";
import { ChatMessage } from "./ChatMessage";
import { RateLimitBadge } from "./RateLimits";

const EFFORT_LABELS: Record<AiEffort, string> = {
  low: "Low · quick answers",
  medium: "Medium",
  high: "High · thorough",
  xhigh: "Extra high",
  max: "Max · deepest reasoning",
};

/** Right-hand chat panel. Talks to the backend over RPC + an SSE stream per session. */
export function AiPanel() {
  const store = useAiStore();
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["ai", "status"], queryFn: () => rpc("ai.status", {}), staleTime: 30_000 });
  const sessions = useQuery({ queryKey: ["ai", "sessions"], queryFn: () => rpc("ai.sessions", {}) });
  const connectionsList = useQuery({ queryKey: ["connections"], queryFn: () => rpc("connections.list", {}) });
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const ensurePlayground = useAppStore((s) => s.ensurePlayground);
  const playgroundQuery = useAppStore((s) => s.playgroundQuery);
  const updateTab = useAppStore((s) => s.updateTab);
  const openSettings = useAppStore((s) => s.openSettings);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const context = useMemo<AiContext | undefined>(() => {
    if (!activeTab) return undefined;
    if (activeTab.kind === "table") return { connectionId: activeTab.connectionId, schema: activeTab.schema, table: activeTab.table };
    if (activeTab.kind === "sql") return { connectionId: activeTab.connectionId, sql: activeTab.sql };
    if (activeTab.kind === "playground") return { connectionId: activeTab.connectionId, sql: activeTab.sql.sql || undefined };
    if (activeTab.kind === "routine") return { connectionId: activeTab.connectionId };
    return undefined;
  }, [activeTab]);

  useEffect(() => {
    if (!sessions.data) return;
    store.setSessions(sessions.data);
    const all = useAppStore.getState().tabs;
    for (const s of sessions.data) {
      const tab = all.find((t) => t.id === playgroundTabId(s.id));
      if (tab && tab.kind === "playground" && tab.title !== s.title) updateTab(tab.id, { title: s.title });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions.data]);

  const loadSession = useCallback(
    async (id: string) => {
      try {
        const detail = await rpc("ai.session", { id });
        store.setActive(id, detail.messages);
        store.setRunning(detail.running);
        ensurePlayground(id, detail.title);
      } catch (e) {
        toast.error("Could not load chat", { description: errorMessage(e) });
      }
    },
    [store, ensurePlayground],
  );

  useEffect(() => {
    if (store.open && !store.activeId && sessions.data?.length) void loadSession(sessions.data[0]!.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.open, sessions.data]);

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
        if (event.type === "ui_action") {
          const a = event.action;
          const sid = useAiStore.getState().activeId;
          if (!sid) return;
          const title = useAiStore.getState().sessions.find((x) => x.id === sid)?.title ?? "chat";
          const dialect = (connectionsList.data ?? []).find((c) => c.id === a.connectionId)?.dialect;
          playgroundQuery(sid, title, a.connectionId, formatSql(a.sql, dialect), a.run);
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

  async function newChat() {
    try {
      const s = await rpc("ai.create", {});
      await queryClient.invalidateQueries({ queryKey: ["ai", "sessions"] });
      await loadSession(s.id);
    } catch (e) {
      toast.error("Could not create chat", { description: errorMessage(e) });
    }
  }

  async function deleteChat() {
    if (!store.activeId) return;
    await rpc("ai.delete", { id: store.activeId });
    store.setActive(null, []);
    await queryClient.invalidateQueries({ queryKey: ["ai", "sessions"] });
  }

  async function send() {
    const text = input.trim();
    if (!text || store.running) return;
    let id = store.activeId;
    if (!id) {
      const s = await rpc("ai.create", {});
      id = s.id;
      store.setActive(id, []);
      ensurePlayground(id, text.slice(0, 40));
      await queryClient.invalidateQueries({ queryKey: ["ai", "sessions"] });
    }
    setInput("");
    store.appendUser({ id: `local-${Date.now()}`, role: "user", parts: [{ type: "text", text }], createdAt: new Date().toISOString() });
    store.setRunning(true);
    try {
      await connect(id);
      const { messageId } = await rpc("ai.send", { id, text, context: store.includeContext ? context : undefined });
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

  const active = store.sessions.find((s) => s.id === store.activeId);
  const st = status.data;
  const modelValue = active?.model ?? st?.settings.defaultModel ?? "";
  const modelLabel = st?.models.find((m) => m.value === modelValue)?.label ?? modelValue ?? "Model";
  const effortValue = active?.effort ?? st?.settings.defaultEffort ?? null;
  const selectedModel = st?.models.find((m) => m.value === modelValue);
  const effortLevels = selectedModel?.effortLevels?.length ? selectedModel.effortLevels : (st?.efforts ?? []);
  const contextLabel = context?.table
    ? `${context.schema ? `${context.schema}.` : ""}${context.table}`
    : context?.sql !== undefined
      ? "SQL editor"
      : context?.connectionId
        ? "connection"
        : null;
  const unavailable = st ? !st.available : false;
  const billing = st?.settings.authMode === "apiKey" ? "API key" : (st?.account?.subscriptionType ?? "subscription");

  return (
    <aside className="flex h-full min-w-0 flex-col border-l bg-background">
      <header className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
        <SparklesIcon className="size-4 text-primary" />
        <NativeSelect
          value={store.activeId ?? ""}
          onChange={(e) => e.target.value && void loadSession(e.target.value)}
          className="min-w-0 flex-1"
        >
          {!store.activeId && <option value="">New chat</option>}
          {store.sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </NativeSelect>
        <Tooltip>
          <TooltipTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label="Open playground" disabled={!store.activeId} />}
            onClick={() => store.activeId && ensurePlayground(store.activeId, active?.title ?? "chat", { activate: true })}
          >
            <LayoutPanelTopIcon />
          </TooltipTrigger>
          <TooltipContent>Open the assistant playground tab</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="New chat" />} onClick={newChat}>
            <PlusIcon />
          </TooltipTrigger>
          <TooltipContent>New chat</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label="Delete chat" disabled={!store.activeId} />}
            onClick={deleteChat}
          >
            <Trash2Icon />
          </TooltipTrigger>
          <TooltipContent>Delete chat</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Assistant settings" />} onClick={() => openSettings("assistant")}>
            <SettingsIcon />
          </TooltipTrigger>
          <TooltipContent>Settings, account and limits</TooltipContent>
        </Tooltip>
        <Button variant="ghost" size="icon-sm" aria-label="Close assistant" onClick={() => store.setOpen(false)}>
          <XIcon />
        </Button>
      </header>

      {st && !st.available && <div className="border-b bg-destructive/10 px-3 py-2 text-xs text-destructive">{st.detail}</div>}
      {st?.settings.authMode === "subscription" && st.account && !st.account.loggedIn && (
        <div className="border-b bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
          Not logged in to Claude Code. Open settings to switch to an API key or run <code>claude</code> and <code>/login</code>.
        </div>
      )}

      <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-3 py-3">
        {store.messages.length === 0 ? (
          <EmptyState
            icon={<BotIcon />}
            title="Ask about your data"
            description="Try “How many active users signed up this month?” or “Which users have no posts?”. Queries and results open in the Assistant playground tab; the chat stays short and read-only."
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
          <label className="flex items-center gap-1.5" title="Send the active tab (table / SQL) as context">
            <Checkbox checked={store.includeContext} onCheckedChange={(v) => store.setIncludeContext(Boolean(v))} className="size-3.5" />
            <span className="truncate">{contextLabel ? `Context: ${contextLabel}` : "Context: none"}</span>
          </label>
          <RateLimitBadge limits={st?.rateLimits ?? []} onOpenSettings={() => openSettings("assistant")} />
          <span className="truncate">Billing: {billing}</span>
          {st?.lastModel && <span className="truncate">Model: {st.lastModel}</span>}
          <span className="ml-auto hidden xl:inline">{modKey}+Enter sends</span>
        </div>
      </footer>

    </aside>
  );
}
