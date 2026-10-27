import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { DatabaseIcon, LoaderIcon, MoreHorizontalIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import type { AiSessionInfo } from "@shared/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/EmptyState";
import { useAiStore } from "@/lib/ai-store";
import { openDialog } from "@/lib/dialogs";
import { useLayout } from "@/lib/layout";
import { rpc } from "@/lib/rpc";
import { cn } from "@/lib/utils";
import { configureSession, createChat, deleteChat, loadSession } from "./session-actions";

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m} m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  return d < 7 ? `${d} d` : new Date(iso).toLocaleDateString();
}

/** First pane of assistant mode: every chat with its title, latest reply, connection and a ⋯ menu. */
export function ThreadList() {
  const sessions = useAiStore((s) => s.sessions);
  const activeId = useAiStore((s) => s.activeId);
  const collapse = useLayout((s) => s.setThreadsCollapsed);
  const connections = useQuery({ queryKey: ["connections"], queryFn: () => rpc("connections.list", {}) });
  const [renaming, setRenaming] = useState<string | null>(null);

  return (
    <aside className="flex h-full min-w-0 flex-col bg-sidebar text-sidebar-foreground">
      <header className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
        <span className="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Chats</span>
        <span className="ml-auto" />
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="New chat" />} onClick={() => void createChat()}>
            <PlusIcon />
          </TooltipTrigger>
          <TooltipContent>New chat</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Hide chats" />} onClick={() => collapse(true)}>
            <PanelLeftCloseIcon />
          </TooltipTrigger>
          <TooltipContent>Hide the chat list</TooltipContent>
        </Tooltip>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-0.5 p-1.5">
          {sessions.length === 0 && (
            <EmptyState
              className="h-auto py-10"
              title="No chats yet"
              description="Start one and ask about your data."
              action={
                <Button size="sm" onClick={() => void createChat()}>
                  <PlusIcon /> New chat
                </Button>
              }
            />
          )}
          {sessions.map((s) => (
            <ThreadRow
              key={s.id}
              session={s}
              active={s.id === activeId}
              connectionName={connections.data?.find((c) => c.id === s.connectionId)?.name ?? null}
              connections={connections.data ?? []}
              renaming={renaming === s.id}
              onRename={() => setRenaming(s.id)}
              onRenamed={(title) => {
                setRenaming(null);
                if (title && title !== s.title) void configureSession(s.id, { title });
              }}
            />
          ))}
        </div>
      </ScrollArea>
    </aside>
  );
}

function ThreadRow({
  session: s,
  active,
  connectionName,
  connections,
  renaming,
  onRename,
  onRenamed,
}: {
  session: AiSessionInfo;
  active: boolean;
  connectionName: string | null;
  connections: { id: string; name: string }[];
  renaming: boolean;
  onRename: () => void;
  onRenamed: (title: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") onRenamed(e.currentTarget.value.trim() || null);
    if (e.key === "Escape") onRenamed(null);
  };
  const confirmDelete = () =>
    openDialog({
      kind: "confirm",
      title: "Delete this chat?",
      description: `"${s.title}" and its playground will be removed.`,
      confirmLabel: "Delete",
      destructive: true,
      onConfirm: () => deleteChat(s.id),
    });

  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={active || undefined}
      className={cn(
        "group/thread flex min-w-0 cursor-default gap-2 rounded-md px-2 py-1.5 text-left select-none",
        active ? "bg-background shadow-xs" : "hover:bg-muted/60",
      )}
      onClick={() => !active && void loadSession(s.id)}
      onKeyDown={(e) => e.key === "Enter" && !active && void loadSession(s.id)}
      onDoubleClick={onRename}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {renaming ? (
            <input
              ref={inputRef}
              defaultValue={s.title}
              className="h-5 min-w-0 flex-1 rounded border border-input bg-background px-1 text-[13px] outline-none focus-visible:border-ring"
              onKeyDown={onKey}
              onBlur={(e) => onRenamed(e.currentTarget.value.trim() || null)}
              onClick={(e) => e.stopPropagation()}
              aria-label="Chat title"
            />
          ) : (
            <span className={cn("min-w-0 flex-1 truncate text-[13px]", active ? "font-medium text-foreground" : "text-foreground/90")}>{s.title}</span>
          )}
          {s.running && <LoaderIcon className="size-3 shrink-0 animate-spin text-primary" aria-label="Answering" />}
          <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">{relativeTime(s.updatedAt)}</span>
        </div>
        {s.preview && <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{s.preview}</div>}
        <div className={cn("mt-1 flex items-center gap-1 text-[11px]", connectionName ? "text-muted-foreground" : "text-amber-600 dark:text-amber-500")}>
          <DatabaseIcon className="size-3 shrink-0" />
          <span className="truncate">{connectionName ?? "No connection"}</span>
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Chat options"
              className={cn("-mr-1 shrink-0 self-start", !active && "opacity-0 group-hover/thread:opacity-100 data-[popup-open]:opacity-100")}
            />
          }
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={onRename}>
              <PencilIcon /> Rename
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <DatabaseIcon /> Connection
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Work on</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={s.connectionId ?? ""} onValueChange={(v) => void configureSession(s.id, { connectionId: (v as string) || null })}>
                    <DropdownMenuRadioItem value="" closeOnClick>
                      No connection
                    </DropdownMenuRadioItem>
                    {connections.map((c) => (
                      <DropdownMenuRadioItem key={c.id} value={c.id} closeOnClick>
                        {c.name}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={confirmDelete}>
              <Trash2Icon /> Delete
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Replacement for the collapsed thread list: expand + new chat. */
export function ThreadRail() {
  const expand = useLayout((s) => s.setThreadsCollapsed);
  return (
    <aside className="flex h-full w-10 shrink-0 flex-col items-center gap-1 border-r bg-sidebar py-1.5 text-sidebar-foreground">
      <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Show chats" />} onClick={() => expand(false)}>
          <PanelLeftOpenIcon />
        </TooltipTrigger>
        <TooltipContent side="right">Show the chat list</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="New chat" />} onClick={() => void createChat()}>
          <PlusIcon />
        </TooltipTrigger>
        <TooltipContent side="right">New chat</TooltipContent>
      </Tooltip>
    </aside>
  );
}
