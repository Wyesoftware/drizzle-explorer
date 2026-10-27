import { useEffect, type ReactNode } from "react";
import { SparklesIcon } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import type { Playground } from "@/lib/store";
import { useConnections } from "@/lib/queries";
import { SqlTab } from "@/features/sql/SqlTab";
import { syncThreadQuery } from "@/features/ai/session-actions";

/**
 * Right pane of assistant mode: every query the chat runs or drafts lands in this SQL editor, never in the
 * chat. `actions` (mode switch, settings) render at the right end of the header.
 */
export function PlaygroundPane({ playground, actions }: { playground: Playground | null; actions?: ReactNode }) {
  const connections = useConnections();
  const connection = connections.data?.find((c) => c.id === playground?.connectionId);
  const hasQuery = Boolean(playground && (playground.sql.sql.trim() || playground.sql.connectionId));

  // Whatever ends up in the editor (assistant query, user edit, cleared) is kept for the chat.
  const sessionId = playground?.sessionId;
  const sql = playground?.sql.sql ?? "";
  const connectionId = playground?.sql.connectionId ?? null;
  useEffect(() => {
    if (sessionId) syncThreadQuery(sessionId, connectionId, sql);
  }, [sessionId, connectionId, sql]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b bg-primary/5 px-3 text-xs">
        <SparklesIcon className="size-3.5 shrink-0 text-primary" />
        <span className="shrink-0 font-medium">Playground</span>
        <span className="min-w-0 truncate text-muted-foreground">
          {playground?.title ?? ""}
          {connection ? ` · ${connection.name}` : ""}
        </span>
        <span className="ml-auto" />
        {actions}
      </div>
      <div className="min-h-0 flex-1">
        {playground && hasQuery ? (
          <SqlTab key={playground.sessionId} tab={playground.sql} />
        ) : (
          <EmptyState
            icon={<SparklesIcon />}
            title="Nothing here yet"
            description="Ask the assistant for data. Every query it writes appears in this editor with its results; edit and re-run freely."
          />
        )}
      </div>
    </div>
  );
}
