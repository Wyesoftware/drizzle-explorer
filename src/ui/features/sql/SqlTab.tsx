import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BookmarkIcon,
  CircleAlertIcon,
  CopyIcon,
  DatabaseIcon,
  DownloadIcon,
  PanelRightIcon,
  PlayIcon,
  SaveIcon,
  WandSparklesIcon,
} from "lucide-react";
import { formatSql } from "@/lib/sql-format";
import type { ExportSource, QueryResult } from "@shared/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/EmptyState";
import { useConnections, useSaveQuery, useSavedQueries, useTables } from "@/lib/queries";
import { errorMessage, rpc } from "@/lib/rpc";
import { useAppStore, type SqlTab as SqlTabModel } from "@/lib/store";
import { formatCount, formatDuration, modKey } from "@/lib/format";
import { DataGrid, NUMERIC_TYPES, type GridColumnFilters } from "@/features/grid/DataGrid";
import { type ColumnFilterModels, type ColumnFilterSpec } from "@/features/grid/filters/model";
import { dateEditMode } from "@/lib/format-value";
import { ValuePanel, type SelectedCell } from "@/features/grid/ValuePanel";
import { openDialog } from "@/lib/dialogs";
import { sqlScope, useFormatStore, useScopeFormats } from "@/lib/formats";
import { ExportDialog } from "@/features/transfer/ExportDialog";
import { TransferDialog } from "@/features/transfer/TransferDialog";
import { CodeEditor } from "./CodeEditor";

export function SqlTab({ tab }: { tab: SqlTabModel }) {
  const connections = useConnections();
  const updateTab = useAppStore((s) => s.updateTab);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [lastSql, setLastSql] = useState("");
  const [cell, setCell] = useState<SelectedCell | null>(null);
  const [valueOpen, setValueOpen] = useState(false);
  const [dialog, setDialog] = useState<"export" | "transfer" | null>(null);
  // Column filters on the results, applied in the grid (the rows are already here). Reset per result.
  const [filterModel, setFilterModel] = useState<ColumnFilterModels>({});
  const [displayedRows, setDisplayedRows] = useState<number | null>(null);
  const filterFor = useCallback(
    (column: string): ColumnFilterSpec => {
      const col = result?.columns.find((c) => c.name === column);
      const type = col?.dataType ?? "";
      const sample = result?.rows.find((r) => r[column] !== null && r[column] !== undefined)?.[column];
      if (NUMERIC_TYPES.test(type) || (!type && typeof sample === "number")) return { type: "number" };
      const mode = dateEditMode(type);
      if (mode) return { type: "date", mode };
      return { type: "text" };
    },
    [result],
  );
  const gridFilters = useMemo<GridColumnFilters>(
    () => ({
      filterFor,
      model: filterModel,
      clientSide: true,
      onModelChange: (model, displayed) => {
        setFilterModel(model);
        setDisplayedRows(Object.keys(model).length ? (displayed ?? null) : null);
      },
    }),
    [filterFor, filterModel],
  );

  const connection = connections.data?.find((c) => c.id === tab.connectionId) ?? null;
  const connectionItems = useMemo(
    () => (connections.data ?? []).map((c) => ({ value: c.id, label: c.name })),
    [connections.data],
  );

  // Table names for autocompletion (default schema only, loaded lazily once connected).
  const defaultSchema = connection?.dialect === "sqlite" ? "main" : "public";
  const tables = useTables(tab.connectionId ?? "", defaultSchema, Boolean(tab.connectionId));
  const schemaNamespace = useMemo(
    () => Object.fromEntries((tables.data ?? []).map((t) => [t.name, [] as string[]])),
    [tables.data],
  );

  // Runs can overlap (the assistant fires several queries in a row); only the most recently started
  // one may publish its result, otherwise a slow earlier query overwrites the final one.
  const runSeq = useRef(0);
  const execute = useMutation({
    mutationFn: async (sqlText: string) => {
      const seq = ++runSeq.current;
      const data = await rpc("sql.execute", { connectionId: tab.connectionId!, sql: sqlText });
      return { data, seq };
    },
    onSuccess: ({ data, seq }, sqlText) => {
      if (seq !== runSeq.current) return;
      setResult(data);
      setLastSql(sqlText);
      setFilterModel({});
      setDisplayedRows(null);
    },
  });
  const hasRows = Boolean(result && result.columns.length > 0 && tab.connectionId);
  const scope = sqlScope(tab.connectionId);
  const formats = useScopeFormats(scope);
  const formatDefaults = useFormatStore((s) => s.defaults);
  const setFormat = useFormatStore((s) => s.setFormat);
  const resetFormat = (column: string) => setFormat(scope, column, null);
  const formatColumn = (column: string) => {
    const col = result?.columns.find((c) => c.name === column);
    const sample = result?.rows.find((r) => r[column] !== null && r[column] !== undefined)?.[column] ?? null;
    openDialog({ kind: "format", scope, column, dataType: col?.dataType ?? null, sample });
  };
  const resultSource: ExportSource = { kind: "sql", connectionId: tab.connectionId ?? "", sql: lastSql };

  // SQL library: a plain tab links to the entry it opened (Save updates it); the assistant playground
  // never links, saving from it always adds a named copy.
  const playground = useAppStore((s) => Object.values(s.playgrounds).find((p) => p.sql.id === tab.id));
  const isPlayground = Boolean(playground);
  const saved = useSavedQueries(tab.connectionId, Boolean(tab.connectionId));
  const saveQuery = useSaveQuery();
  const saveAs = () =>
    openDialog({
      kind: "saveQuery",
      connectionId: tab.connectionId,
      sql: tab.sql,
      defaultName: isPlayground ? (playground?.title ?? "") : tab.savedId ? `${tab.title} copy` : "",
      onSaved: (q) => {
        if (!isPlayground) updateTab(tab.id, { savedId: q.id, title: q.name });
      },
    });
  const save = () => {
    if (!tab.savedId || isPlayground) return saveAs();
    saveQuery
      .mutateAsync({ id: tab.savedId, connectionId: tab.connectionId, name: tab.title, sql: tab.sql })
      .then(() => toast.success(`Saved "${tab.title}"`))
      .catch((e) => toast.error("Could not save query", { description: errorMessage(e) }));
  };
  const loadSaved = (id: string) => {
    const q = saved.data?.find((x) => x.id === id);
    if (!q) return;
    updateTab(tab.id, isPlayground ? { sql: q.sql } : { sql: q.sql, savedId: q.id, title: q.name, connectionId: q.connectionId });
  };

  const run = useCallback(() => {
    if (!tab.connectionId || !tab.sql.trim() || execute.isPending) return;
    execute.mutate(tab.sql);
  }, [tab.connectionId, tab.sql, execute]);

  // The assistant playground bumps runVersion to execute the SQL it just set. Starts at 0 so a tab that
  // mounts with a pending run executes immediately.
  const lastRun = useRef(0);
  useEffect(() => {
    if ((tab.runVersion ?? 0) > lastRun.current) {
      lastRun.current = tab.runVersion ?? 0;
      if (tab.connectionId && tab.sql.trim()) execute.mutate(tab.sql);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.runVersion]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-2">
        <Select
          value={tab.connectionId ?? ""}
          items={connectionItems}
          onValueChange={(v) => updateTab(tab.id, { connectionId: v || null })}
        >
          <SelectTrigger size="sm" className="min-w-44" aria-label="Connection">
            <DatabaseIcon className="text-muted-foreground" />
            <SelectValue placeholder="Choose connection…" />
          </SelectTrigger>
          <SelectContent>
            {connectionItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={run} disabled={!tab.connectionId || !tab.sql.trim() || execute.isPending}>
          {execute.isPending ? <Spinner /> : <PlayIcon />}
          Run
          <kbd className="ml-1 rounded bg-primary-foreground/15 px-1 font-mono text-[10px]">{modKey}↵</kbd>
        </Button>
        <Tooltip>
          <TooltipTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label="Format SQL" disabled={!tab.sql.trim()} />}
            onClick={() => updateTab(tab.id, { sql: formatSql(tab.sql, connection?.dialect) })}
          >
            <WandSparklesIcon />
          </TooltipTrigger>
          <TooltipContent>Format SQL</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label="Save query" disabled={!tab.sql.trim() || saveQuery.isPending} />}
            onClick={save}
          >
            <SaveIcon />
          </TooltipTrigger>
          <TooltipContent>{tab.savedId && !isPlayground ? `Save "${tab.title}"` : "Save to saved queries…"}</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Saved queries" />}>
            <BookmarkIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Saved queries{connection ? ` · ${connection.name}` : ""}</DropdownMenuLabel>
              {!tab.connectionId ? (
                <DropdownMenuItem disabled>Choose a connection first</DropdownMenuItem>
              ) : saved.data?.length ? (
                saved.data.map((q) => (
                  <DropdownMenuItem key={q.id} onClick={() => loadSaved(q.id)} title={q.sql}>
                    <BookmarkIcon /> <span className="truncate">{q.name}</span>
                  </DropdownMenuItem>
                ))
              ) : (
                <DropdownMenuItem disabled>{saved.isLoading ? "Loading…" : "Nothing saved yet"}</DropdownMenuItem>
              )}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={saveAs} disabled={!tab.sql.trim()}>
              <SaveIcon /> {isPlayground ? "Save to saved queries…" : "Save as new…"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="ml-auto text-xs text-muted-foreground">
          {result && !execute.isPending && (
            <>
              {result.command ?? "OK"} ·{" "}
              {displayedRows !== null && displayedRows !== result.rowCount
                ? `${formatCount(displayedRows)} of ${formatCount(result.rowCount)} rows (filtered)`
                : `${formatCount(result.rowCount)} rows`}{" "}
              · {formatDuration(result.durationMs)}
            </>
          )}
        </span>
        <Tooltip>
          <TooltipTrigger
            render={<Button variant={valueOpen ? "secondary" : "ghost"} size="icon-sm" aria-label="Value viewer" />}
            onClick={() => setValueOpen((v) => !v)}
          >
            <PanelRightIcon />
          </TooltipTrigger>
          <TooltipContent>Value viewer (double-click a cell)</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="sm" disabled={!hasRows} />}>
            <DownloadIcon /> Results
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => setDialog("export")}>
              <DownloadIcon /> Export results…
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDialog("transfer")}>
              <CopyIcon /> Copy results to table…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="40%" minSize={80}>
          <CodeEditor
            value={tab.sql}
            onChange={(sql) => updateTab(tab.id, { sql })}
            onRun={run}
            dialect={connection?.dialect ?? "postgres"}
            schema={schemaNamespace}
            placeholder={`Write SQL here, then press ${modKey}+Enter to run`}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="60%" minSize={80} className="flex min-h-0 flex-col">
          {execute.error ? (
            <div className="flex h-full flex-col gap-2 overflow-auto p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                <CircleAlertIcon className="size-4" /> Query failed
              </div>
              <pre className="font-mono text-xs whitespace-pre-wrap text-destructive/90">{errorMessage(execute.error)}</pre>
            </div>
          ) : result ? (
            result.columns.length > 0 ? (
              <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
                <ResizablePanel minSize={240} className="min-w-0">
                  <DataGrid
                    columns={result.columns}
                    rows={result.rows}
                    loading={execute.isPending}
                    onCellSelect={setCell}
                    onCellOpen={(c) => {
                      setCell(c);
                      setValueOpen(true);
                    }}
                    formats={formats}
                    formatDefaults={formatDefaults}
                    onFormatColumn={formatColumn}
                    onResetFormat={resetFormat}
                    columnFilters={gridFilters}
                  />
                </ResizablePanel>
                {valueOpen && (
                  <>
                    <ResizableHandle />
                    <ResizablePanel defaultSize={380} minSize={240} maxSize={1000}>
                      <ValuePanel cell={cell} columns={result.columns} onClose={() => setValueOpen(false)} />
                    </ResizablePanel>
                  </>
                )}
              </ResizablePanelGroup>
            ) : (
              <EmptyState
                title={`${result.command ?? "Statement"} completed`}
                description={`${formatCount(result.rowCount)} row(s) affected in ${formatDuration(result.durationMs)}`}
              />
            )
          ) : (
            <EmptyState
              icon={<PlayIcon />}
              title="No results yet"
              description={
                tab.connectionId ? `Run a query with ${modKey}+Enter.` : "Pick a connection to run queries against."
              }
            />
          )}
        </ResizablePanel>
      </ResizablePanelGroup>
      <ExportDialog
        open={dialog === "export"}
        onOpenChange={(o) => setDialog(o ? "export" : null)}
        source={resultSource}
        defaultName="query-results"
      />
      <TransferDialog
        open={dialog === "transfer"}
        onOpenChange={(o) => setDialog(o ? "transfer" : null)}
        source={resultSource}
        sourceColumns={result?.columns.map((c) => c.name) ?? []}
      />
    </div>
  );
}
