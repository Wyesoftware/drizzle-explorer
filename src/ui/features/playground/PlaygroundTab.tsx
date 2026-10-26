import { SparklesIcon } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import type { PlaygroundTab as PlaygroundTabModel } from "@/lib/store";
import { useConnections } from "@/lib/queries";
import { SqlTab } from "@/features/sql/SqlTab";

/** The assistant's tab: every query it runs or drafts lands in this SQL editor, never in the chat. */
export function PlaygroundTab({ tab }: { tab: PlaygroundTabModel }) {
  const connections = useConnections();
  const connection = connections.data?.find((c) => c.id === tab.connectionId);
  const hasQuery = Boolean(tab.sql.sql.trim()) || Boolean(tab.sql.connectionId);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b bg-primary/5 px-3 text-xs">
        <SparklesIcon className="size-3.5 text-primary" />
        <span className="font-medium">Assistant playground</span>
        <span className="truncate text-muted-foreground">
          {tab.title}
          {connection ? ` · ${connection.name}` : ""}
        </span>
        <span className="ml-auto text-[11px] text-muted-foreground">Queries from the chat run here. Edit and re-run freely.</span>
      </div>
      <div className="min-h-0 flex-1">
        {hasQuery ? (
          <SqlTab tab={tab.sql} />
        ) : (
          <EmptyState
            icon={<SparklesIcon />}
            title="Nothing here yet"
            description="Ask the assistant for data. Every query it writes appears in this editor with its results."
          />
        )}
      </div>
    </div>
  );
}
