import { useState } from "react";
import { DatabaseIcon, PlusIcon, TerminalIcon } from "lucide-react";
import type { ConnectionConfig } from "@shared/types";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { useConnections, useConnectionStatus } from "@/lib/queries";
import { useAppStore } from "@/lib/store";
import { ConnectionDialog } from "@/features/connections/ConnectionDialog";
import { ConnectionNode } from "./ConnectionNode";

export function Sidebar() {
  const connections = useConnections();
  const status = useConnectionStatus();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ConnectionConfig | null>(null);
  const openSqlEditor = useAppStore((s) => s.openSqlEditor);

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (config: ConnectionConfig) => {
    setEditing(config);
    setDialogOpen(true);
  };

  return (
    <aside className="flex h-full flex-col border-r bg-sidebar text-sidebar-foreground">
      <header className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
        <span className="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Connections</span>
        <span className="ml-auto" />
        <Tooltip>
          <TooltipTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label="New SQL editor" />}
            onClick={() => openSqlEditor(connections.data?.[0]?.id ?? null)}
          >
            <TerminalIcon />
          </TooltipTrigger>
          <TooltipContent>New SQL editor</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="New connection" />} onClick={openNew}>
            <PlusIcon />
          </TooltipTrigger>
          <TooltipContent>New connection</TooltipContent>
        </Tooltip>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-1.5">
          {connections.isLoading && (
            <div className="space-y-2 p-2">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-6 w-1/2" />
            </div>
          )}
          {connections.data?.length === 0 && (
            <EmptyState
              className="h-auto py-10"
              icon={<DatabaseIcon />}
              title="No connections yet"
              description="Add a PostgreSQL or SQLite connection to start exploring."
              action={
                <Button size="sm" onClick={openNew}>
                  <PlusIcon /> New connection
                </Button>
              }
            />
          )}
          {connections.data?.map((config) => (
            <ConnectionNode
              key={config.id}
              config={config}
              status={status.data?.find((s) => s.id === config.id)}
              onEdit={openEdit}
            />
          ))}
        </div>
      </ScrollArea>

      <ConnectionDialog open={dialogOpen} onOpenChange={setDialogOpen} initial={editing} />
    </aside>
  );
}
