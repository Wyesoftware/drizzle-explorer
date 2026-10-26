import { FunctionSquareIcon, SettingsIcon, SparklesIcon, TableIcon, TerminalIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { useConnections } from "@/lib/queries";
import { useAppStore, type Tab } from "@/lib/store";
import { cn } from "@/lib/utils";
import { TableTab } from "@/features/table/TableTab";
import { SqlTab } from "@/features/sql/SqlTab";
import { RoutineTab } from "@/features/routine/RoutineTab";
import { PlaygroundTab } from "@/features/playground/PlaygroundTab";
import { SettingsPage } from "@/features/settings/SettingsPage";

export function Workspace() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const openSqlEditor = useAppStore((s) => s.openSqlEditor);
  const connections = useConnections();
  const active = tabs.find((t) => t.id === activeTabId) ?? null;

  if (tabs.length === 0) {
    return (
      <EmptyState
        icon={<TableIcon />}
        title="Nothing open"
        description="Pick a table in the sidebar, or open a SQL editor to run ad-hoc queries."
        action={
          <Button variant="outline" size="sm" onClick={() => openSqlEditor(connections.data?.[0]?.id ?? null)}>
            <TerminalIcon /> New SQL editor
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b bg-muted/30" role="tablist">
        {tabs.map((tab) => (
          <TabButton
            key={tab.id}
            tab={tab}
            active={tab.id === activeTabId}
            onSelect={() => setActiveTab(tab.id)}
            onClose={() => closeTab(tab.id)}
          />
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {tabs.map((tab) => (
          <div key={tab.id} className={cn("h-full", tab.id !== active?.id && "hidden")}>
            {tab.kind === "table" ? (
              <TableTab tab={tab} />
            ) : tab.kind === "routine" ? (
              <RoutineTab tab={tab} />
            ) : tab.kind === "playground" ? (
              <PlaygroundTab tab={tab} />
            ) : tab.kind === "settings" ? (
              <SettingsPage tab={tab} />
            ) : (
              <SqlTab tab={tab} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function TabButton({
  tab,
  active,
  onSelect,
  onClose,
}: {
  tab: Tab;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const label =
    tab.kind === "table"
      ? tab.table
      : tab.kind === "routine"
        ? `${tab.routine.name}()`
        : tab.kind === "playground"
          ? "Assistant"
          : tab.kind === "settings"
            ? "Settings"
            : tab.title;
  const subtitle = tab.kind === "table" && tab.schema ? tab.schema : tab.kind === "routine" ? tab.routine.schema : tab.kind === "playground" ? tab.title : null;
  return (
    <div
      role="tab"
      aria-selected={active}
      className={cn(
        "group/tab flex max-w-56 min-w-0 shrink-0 cursor-default items-center gap-1.5 border-r px-3 text-[13px] select-none",
        active ? "bg-background text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
        tab.kind === "playground" && (active ? "bg-primary/10 text-primary" : "text-primary/70 hover:text-primary"),
      )}
      onClick={onSelect}
      onAuxClick={(e) => e.button === 1 && onClose()}
      title={subtitle ? `${subtitle}.${label}` : label}
    >
      {tab.kind === "table" ? (
        <TableIcon className="size-3.5 shrink-0" />
      ) : tab.kind === "routine" ? (
        <FunctionSquareIcon className="size-3.5 shrink-0" />
      ) : tab.kind === "playground" ? (
        <SparklesIcon className="size-3.5 shrink-0" />
      ) : tab.kind === "settings" ? (
        <SettingsIcon className="size-3.5 shrink-0" />
      ) : (
        <TerminalIcon className="size-3.5 shrink-0" />
      )}
      <span className="truncate">{label}</span>
      <button
        type="button"
        className={cn(
          "ml-1 flex size-4 shrink-0 items-center justify-center rounded hover:bg-muted-foreground/20",
          !active && "opacity-0 group-hover/tab:opacity-100",
        )}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label={`Close ${label}`}
      >
        <XIcon className="size-3" />
      </button>
    </div>
  );
}
