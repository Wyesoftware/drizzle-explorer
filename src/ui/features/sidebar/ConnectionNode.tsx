import { useState, type ComponentType, type ReactNode } from "react";
import { toast } from "sonner";
import {
  ArchiveRestoreIcon,
  CopyIcon,
  DatabaseBackupIcon,
  DatabaseIcon,
  DatabaseZapIcon,
  DownloadIcon,
  EraserIcon,
  EyeIcon,
  FolderIcon,
  FunctionSquareIcon,
  LayersIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlugIcon,
  RefreshCwIcon,
  TableIcon,
  TerminalIcon,
  Trash2Icon,
  UnplugIcon,
  UploadIcon,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { ConnectionConfig, ConnectionStatus, RoutineInfo, SchemaInfo, TableInfo } from "@shared/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { keys, useConnect, useDeleteConnection, useDisconnect, useRoutines, useSchemas, useTables } from "@/lib/queries";
import { errorMessage } from "@/lib/rpc";
import { routineTabId, tableTabId, useAppStore } from "@/lib/store";
import { openDialog } from "@/lib/dialogs";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TreeRow } from "./TreeRow";
import { dropRoutine, dropTable, truncateTable } from "./treeActions";

/** A menu entry rendered either in the "…" dropdown or in the right-click context menu. */
type MenuEntry = { separator: true } | { label: string; icon: ReactNode; onClick: () => void; destructive?: boolean };

interface MenuParts {
  Item: ComponentType<{ children?: ReactNode; onClick?: () => void; variant?: "default" | "destructive" }>;
  Separator: ComponentType;
}

function renderEntries(entries: MenuEntry[], { Item, Separator }: MenuParts) {
  return entries.map((entry, i) =>
    "separator" in entry ? (
      <Separator key={`sep-${i}`} />
    ) : (
      <Item key={entry.label} onClick={entry.onClick} variant={entry.destructive ? "destructive" : "default"}>
        {entry.icon}
        {entry.label}
      </Item>
    ),
  );
}

const contextParts: MenuParts = { Item: ContextMenuItem, Separator: ContextMenuSeparator };
const dropdownParts: MenuParts = { Item: DropdownMenuItem, Separator: DropdownMenuSeparator };

function WithContextMenu({ entries, children }: { entries: MenuEntry[]; children: ReactNode }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-60">{renderEntries(entries, contextParts)}</ContextMenuContent>
    </ContextMenu>
  );
}

export function ConnectionNode({
  config,
  status,
  onEdit,
}: {
  config: ConnectionConfig;
  status: ConnectionStatus | undefined;
  onEdit: (config: ConnectionConfig) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const connect = useConnect();
  const disconnect = useDisconnect();
  const remove = useDeleteConnection();
  const openSqlEditor = useAppStore((s) => s.openSqlEditor);
  const closeConnectionTabs = useAppStore((s) => s.closeConnectionTabs);
  const queryClient = useQueryClient();

  const connected = Boolean(status?.connected);
  const schemas = useSchemas(config.id, expanded);

  async function toggle() {
    if (!expanded && !connected) {
      try {
        await connect.mutateAsync(config.id);
      } catch (error) {
        toast.error(`Cannot connect to "${config.name}"`, { description: errorMessage(error) });
        return;
      }
    }
    setExpanded((v) => !v);
  }

  async function handleDisconnect() {
    setExpanded(false);
    closeConnectionTabs(config.id);
    await disconnect.mutateAsync(config.id);
  }

  async function handleDelete() {
    closeConnectionTabs(config.id);
    await remove.mutateAsync(config.id);
    toast.success(`Deleted "${config.name}"`);
  }

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: keys.schemas(config.id) });
    void queryClient.invalidateQueries({ queryKey: ["tables", config.id] });
    void queryClient.invalidateQueries({ queryKey: ["routines", config.id] });
  };

  const subtitle =
    config.dialect === "sqlite"
      ? config.file
      : config.url
        ? safeUrl(config.url)
        : `${config.user ?? ""}@${config.host ?? "localhost"}:${config.port ?? 5432}/${config.database ?? ""}`;

  const entries: MenuEntry[] = [
    { label: "New SQL editor", icon: <TerminalIcon />, onClick: () => openSqlEditor(config.id) },
    { label: "Refresh", icon: <RefreshCwIcon />, onClick: refresh },
    { separator: true },
    {
      label: "Dump database…",
      icon: <DatabaseBackupIcon />,
      onClick: () => openDialog({ kind: "dump", connectionId: config.id, dialect: config.dialect }),
    },
    {
      label: "Restore from file…",
      icon: <ArchiveRestoreIcon />,
      onClick: () => openDialog({ kind: "restore", connectionId: config.id, dialect: config.dialect }),
    },
    { separator: true },
    connected
      ? { label: "Disconnect", icon: <UnplugIcon />, onClick: () => void handleDisconnect() }
      : { label: "Connect", icon: <PlugIcon />, onClick: () => void toggle() },
    { label: "Edit…", icon: <PencilIcon />, onClick: () => onEdit(config) },
    { separator: true },
    { label: "Delete", icon: <Trash2Icon />, onClick: () => setConfirmDelete(true), destructive: true },
  ];

  return (
    <>
      <WithContextMenu entries={entries}>
        <TreeRow
          depth={0}
          expandable
          expanded={expanded}
          loading={connect.isPending || (expanded && schemas.isLoading)}
          icon={
            connected ? (
              <DatabaseZapIcon className="text-emerald-500" />
            ) : (
              <DatabaseIcon className={cn(status?.error && "text-destructive")} />
            )
          }
          label={<span className="font-medium">{config.name}</span>}
          hint={<span className="hidden xl:inline">{config.dialect}</span>}
          title={`${subtitle}${status?.serverVersion ? `\n${status.serverVersion}` : ""}`}
          onToggle={toggle}
          trailing={
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon-xs" aria-label="Connection actions" />}
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
              >
                <MoreHorizontalIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {renderEntries(entries, dropdownParts)}
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
      </WithContextMenu>

      {expanded && schemas.error && (
        <div className="px-6 py-1 text-xs text-destructive">{errorMessage(schemas.error)}</div>
      )}
      {expanded &&
        schemas.data?.map((schema) => <SchemaNode key={schema.name} config={config} schema={schema} />)}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete connection "{config.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Only the saved connection settings are removed. The database itself is not touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function SchemaNode({ config, schema }: { config: ConnectionConfig; schema: SchemaInfo }) {
  const connectionId = config.id;
  const [expanded, setExpanded] = useState(!schema.isSystem && (schema.name === "public" || schema.name === "main"));
  const tables = useTables(connectionId, schema.name, expanded);
  const routines = useRoutines(connectionId, schema.name, expanded);
  const groups = groupTables(tables.data ?? []);
  const openSqlEditor = useAppStore((s) => s.openSqlEditor);
  const queryClient = useQueryClient();

  const entries: MenuEntry[] = [
    { label: "New SQL editor", icon: <TerminalIcon />, onClick: () => openSqlEditor(connectionId) },
    {
      label: "Refresh",
      icon: <RefreshCwIcon />,
      onClick: () => {
        void queryClient.invalidateQueries({ queryKey: keys.tables(connectionId, schema.name) });
        void queryClient.invalidateQueries({ queryKey: keys.routines(connectionId, schema.name) });
      },
    },
    ...(config.dialect === "postgres"
      ? [
          { separator: true } as MenuEntry,
          {
            label: "Dump schema…",
            icon: <DatabaseBackupIcon />,
            onClick: () => openDialog({ kind: "dump", connectionId, dialect: config.dialect, schema: schema.name }),
          },
        ]
      : []),
  ];

  return (
    <>
      <WithContextMenu entries={entries}>
        <TreeRow
          depth={1}
          expandable
          expanded={expanded}
          loading={expanded && tables.isLoading}
          icon={<FolderIcon className={cn(schema.isSystem && "opacity-60")} />}
          label={<span className={cn(schema.isSystem && "text-muted-foreground")}>{schema.name}</span>}
          hint={tables.data ? formatCount(tables.data.length) : undefined}
          onToggle={() => setExpanded((v) => !v)}
        />
      </WithContextMenu>
      {expanded && tables.error && (
        <div className="py-1 pl-10 text-xs text-destructive">{errorMessage(tables.error)}</div>
      )}
      {expanded && tables.data?.length === 0 && (
        <div className="py-1 pl-12 text-xs text-muted-foreground italic">empty</div>
      )}
      {expanded &&
        groups.map((group) => (
          <TableGroup key={group.label} config={config} label={group.label} tables={group.tables} />
        ))}
      {expanded && routines.data && routines.data.length > 0 && (
        <RoutineGroup connectionId={connectionId} routines={routines.data} />
      )}
    </>
  );
}

function TableGroup({ config, label, tables }: { config: ConnectionConfig; label: string; tables: TableInfo[] }) {
  const [expanded, setExpanded] = useState(true);
  const connectionId = config.id;
  const openTable = useAppStore((s) => s.openTable);
  const openSqlEditor = useAppStore((s) => s.openSqlEditor);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const queryClient = useQueryClient();

  const entriesFor = (table: TableInfo): MenuEntry[] => {
    const source = { kind: "table" as const, connectionId, schema: table.schema, table: table.name };
    const qualified = table.schema ? `${table.schema}.${table.name}` : table.name;
    const isTable = table.kind === "table" || table.kind === "foreign_table";
    return [
      { label: "Open", icon: <TableIcon />, onClick: () => openTable(connectionId, table.schema, table.name) },
      {
        label: "Open in SQL editor",
        icon: <TerminalIcon />,
        onClick: () => openSqlEditor(connectionId, `select *\nfrom ${qualified}\nlimit 100;`),
      },
      { separator: true },
      {
        label: "Export rows…",
        icon: <DownloadIcon />,
        onClick: () => openDialog({ kind: "export", source, defaultName: table.name }),
      },
      ...(isTable
        ? [
            {
              label: "Import from file…",
              icon: <UploadIcon />,
              onClick: () => openDialog({ kind: "import", connectionId, schema: table.schema, table: table.name }),
            } as MenuEntry,
          ]
        : []),
      { label: "Copy rows to table…", icon: <CopyIcon />, onClick: () => openDialog({ kind: "transfer", source }) },
      { separator: true },
      ...(isTable
        ? [
            {
              label: "Truncate…",
              icon: <EraserIcon />,
              onClick: () => truncateTable(queryClient, connectionId, config.dialect, table),
              destructive: true,
            } as MenuEntry,
          ]
        : []),
      {
        label: `Drop ${table.kind === "table" ? "table" : table.kind.replace("_", " ")}…`,
        icon: <Trash2Icon />,
        onClick: () => dropTable(queryClient, connectionId, config.dialect, table),
        destructive: true,
      },
    ];
  };

  return (
    <>
      <TreeRow
        depth={2}
        expandable
        expanded={expanded}
        icon={<LayersIcon />}
        label={<span className="text-muted-foreground">{label}</span>}
        hint={formatCount(tables.length)}
        onToggle={() => setExpanded((v) => !v)}
      />
      {expanded &&
        tables.map((table) => (
          <WithContextMenu key={table.name} entries={entriesFor(table)}>
            <TreeRow
              depth={3}
              icon={table.kind === "table" ? <TableIcon /> : <EyeIcon />}
              label={table.name}
              hint={table.rowEstimate !== null ? `~${formatCount(table.rowEstimate)}` : undefined}
              title={table.comment ?? undefined}
              selected={activeTabId === tableTabId(connectionId, table.schema, table.name)}
              onClick={() => openTable(connectionId, table.schema, table.name)}
            />
          </WithContextMenu>
        ))}
    </>
  );
}

function RoutineGroup({ connectionId, routines }: { connectionId: string; routines: RoutineInfo[] }) {
  const [expanded, setExpanded] = useState(false);
  const openRoutine = useAppStore((s) => s.openRoutine);
  const openSqlEditor = useAppStore((s) => s.openSqlEditor);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const queryClient = useQueryClient();

  const entriesFor = (r: RoutineInfo): MenuEntry[] => [
    { label: "Open", icon: <FunctionSquareIcon />, onClick: () => openRoutine(connectionId, r) },
    {
      label: "Open definition in SQL editor",
      icon: <TerminalIcon />,
      onClick: () => openSqlEditor(connectionId, r.definition ?? `select ${r.schema ? `${r.schema}.` : ""}${r.name}();`),
    },
    { separator: true },
    {
      label: `Drop ${r.kind}…`,
      icon: <Trash2Icon />,
      onClick: () => dropRoutine(queryClient, connectionId, r),
      destructive: true,
    },
  ];

  return (
    <>
      <TreeRow
        depth={2}
        expandable
        expanded={expanded}
        icon={<LayersIcon />}
        label={<span className="text-muted-foreground">Functions</span>}
        hint={formatCount(routines.length)}
        onToggle={() => setExpanded((v) => !v)}
      />
      {expanded &&
        routines.map((r) => {
          const tabId = routineTabId(connectionId, r);
          return (
            <WithContextMenu key={tabId} entries={entriesFor(r)}>
              <TreeRow
                depth={3}
                icon={
                  <FunctionSquareIcon
                    className={cn(r.kind === "procedure" && "text-violet-500", r.kind === "trigger" && "text-amber-500")}
                  />
                }
                label={r.name}
                hint={r.identityArgs ? `(${r.identityArgs})` : "()"}
                title={[r.kind, r.returnType ? `→ ${r.returnType}` : null, r.comment].filter(Boolean).join("  ")}
                selected={activeTabId === tabId}
                onClick={() => openRoutine(connectionId, r)}
              />
            </WithContextMenu>
          );
        })}
    </>
  );
}

function groupTables(tables: TableInfo[]): { label: string; tables: TableInfo[] }[] {
  const plain = tables.filter((t) => t.kind === "table" || t.kind === "foreign_table");
  const views = tables.filter((t) => t.kind === "view" || t.kind === "materialized_view");
  const out: { label: string; tables: TableInfo[] }[] = [];
  if (plain.length) out.push({ label: "Tables", tables: plain });
  if (views.length) out.push({ label: "Views", tables: views });
  return out;
}

function safeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.username ? `${u.username}@` : ""}${u.host}${u.pathname}`;
  } catch {
    return url;
  }
}
