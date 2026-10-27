import { useState } from "react";
import { DatabaseIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, PlusIcon, TerminalIcon } from "lucide-react";
import type { ConnectionConfig } from "@shared/types";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { useConnections, useConnectionStatus } from "@/lib/queries";
import { useAppStore } from "@/lib/store";
import { useLayout } from "@/lib/layout";
import { modKey } from "@/lib/format";
import { ConnectionDialog } from "@/features/connections/ConnectionDialog";
import { ConnectionNode } from "./ConnectionNode";

export function Sidebar() {
  const connections = useConnections();
  const status = useConnectionStatus();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ConnectionConfig | null>(null);
  const openSqlEditor = useAppStore((s) => s.openSqlEditor);
  const collapse = useLayout((s) => s.setSidebarCollapsed);

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
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Hide sidebar" />} onClick={() => collapse(true)}>
            <PanelLeftCloseIcon />
          </TooltipTrigger>
          <TooltipContent>Hide sidebar ({modKey}+B)</TooltipContent>
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

/** Replacement for the collapsed sidebar: a narrow strip with the expand button and the quick actions. */
export function SidebarRail() {
  const expand = useLayout((s) => s.setSidebarCollapsed);
  const openSqlEditor = useAppStore((s) => s.openSqlEditor);
  const connections = useConnections();
  return (
    <aside className="flex h-full w-10 shrink-0 flex-col items-center gap-1 border-r bg-sidebar py-1.5 text-sidebar-foreground">
      <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Show sidebar" />} onClick={() => expand(false)}>
          <PanelLeftOpenIcon />
        </TooltipTrigger>
        <TooltipContent side="right">Show connections ({modKey}+B)</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label="New SQL editor" />}
          onClick={() => openSqlEditor(connections.data?.[0]?.id ?? null)}
        >
          <TerminalIcon />
        </TooltipTrigger>
        <TooltipContent side="right">New SQL editor</TooltipContent>
      </Tooltip>
    </aside>
  );
}
