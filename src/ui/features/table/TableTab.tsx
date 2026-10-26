import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { GridApi } from "ag-grid-community";
import {
  BanIcon,
  ChevronLeftIcon,
  ExternalLinkIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  CopyIcon,
  DatabaseIcon,
  DownloadIcon,
  FilterIcon,
  KeyRoundIcon,
  PanelRightIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SaveIcon,
  TerminalIcon,
  Trash2Icon,
  UndoIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import type {
  ExportSource,
  ResultRow,
  RowFilter,
  SortSpec,
  TableRowsRequest,
} from "@shared/types";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { errorMessage, rpc } from "@/lib/rpc";
import { buildChanges, usePendingChanges } from "./usePendingChanges";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CodeView } from "@/components/CodeView";
import { ErrorBanner } from "@/components/ErrorBanner";
import {
  keys,
  useConnections,
  useTableDetails,
  useTableRows,
} from "@/lib/queries";
import { useAppStore, type TableTab as TableTabModel } from "@/lib/store";
import { formatCount, formatDuration } from "@/lib/format";
import {
  DataGrid,
  NUMERIC_TYPES,
  type CellEditorSpec,
  type GridColumnFilters,
  type GridDatasource,
  type GridEditing,
} from "@/features/grid/DataGrid";
import { useSettings } from "@/lib/settings";
import { dateEditMode, dateTypeHasZone } from "@/lib/format-value";
import { ValuePanel, type SelectedCell } from "@/features/grid/ValuePanel";
import { openDialog } from "@/lib/dialogs";
import { tableScope, useFormatStore, useScopeFormats } from "@/lib/formats";
import { ExportDialog } from "@/features/transfer/ExportDialog";
import { ImportDialog } from "@/features/transfer/ImportDialog";
import { TransferDialog } from "@/features/transfer/TransferDialog";
import { countActive, FilterBar } from "./FilterBar";
import { toFilterSpecs, type ColumnFilterModels, type ColumnFilterSpec } from "@/features/grid/filters/model";

const PAGE_SIZES = [100, 200, 500, 1000, 5000];
const PAGE_SIZE_ITEMS = PAGE_SIZES.map((n) => ({
  value: String(n),
  label: `${n} rows`,
}));

type DialogKind = "export" | "import" | "transfer" | null;

export function TableTab({ tab }: { tab: TableTabModel }) {
  const tableMode = useSettings((s) => s.tableMode);
  const defaultPageSize = useSettings((s) => s.pageSize);
  const infinite = tableMode === "infinite";
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<SortSpec[]>(tab.initialSort ?? []);
  const [filter, setFilter] = useState<RowFilter>(tab.initialFilter ?? {});
  /** Per-column filters from the grid's floating filter row (AG Grid filter model, kept here across remounts). */
  const [filterModel, setFilterModel] = useState<ColumnFilterModels>({});
  const columnFilters = useMemo(() => toFilterSpecs(filterModel), [filterModel]);
  /** Everything that narrows the rows: the filter bar conditions and WHERE plus the column filters. */
  const effectiveFilter = useMemo<RowFilter>(
    () => ({ filters: [...(filter.filters ?? []), ...columnFilters], where: filter.where }),
    [filter, columnFilters],
  );
  const [filterOpen, setFilterOpen] = useState(Boolean(tab.initialFilter));
  const [view, setView] = useState("data");
  const [cell, setCell] = useState<SelectedCell | null>(null);
  const [valueOpen, setValueOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [menuCell, setMenuCell] = useState<SelectedCell | null>(null);
  const [saving, setSaving] = useState(false);
  const [gridApi, setGridApi] = useState<GridApi<ResultRow> | null>(null);
  const changes = usePendingChanges();
  const queryClient = useQueryClient();
  const openSqlEditor = useAppStore((s) => s.openSqlEditor);
  const openTable = useAppStore((s) => s.openTable);

  // "Open referenced row" re-targets an already open tab with a new filter.
  useEffect(() => {
    if (tab.filterVersion && tab.filterVersion > 1) {
      if (tab.initialFilter) {
        setFilter(tab.initialFilter);
        setFilterOpen(countActive(tab.initialFilter) > 0);
        setFilterModel({});
        void gridApi?.setFilterModel(null);
      }
      if (tab.initialSort) setSort(tab.initialSort);
      setPage(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.filterVersion]);
  const connections = useConnections();
  const dialect =
    connections.data?.find((c) => c.id === tab.connectionId)?.dialect ??
    "postgres";

  const request = useMemo<TableRowsRequest>(
    () => ({
      connectionId: tab.connectionId,
      schema: tab.schema,
      table: tab.table,
      limit: pageSize,
      offset: page * pageSize,
      sort,
      filters: effectiveFilter.filters,
      where: effectiveFilter.where,
    }),
    [tab.connectionId, tab.schema, tab.table, pageSize, page, sort, effectiveFilter],
  );

  const rows = useTableRows(request, !infinite);
  const details = useTableDetails(tab.connectionId, tab.schema, tab.table);
  // Infinite scroll: the grid pulls blocks itself; we only track the total and a version to refetch.
  const [infiniteVersion, setInfiniteVersion] = useState(0);
  const [infiniteTotal, setInfiniteTotal] = useState<number | null>(null);
  const [infiniteError, setInfiniteError] = useState<unknown>(null);
  /** Key columns reported by the first block (null until something was fetched). */
  const [infiniteKeys, setInfiniteKeys] = useState<string[] | null>(null);
  /** Server rows by id for every block fetched so far: the "originals" behind unsaved edits. */
  const infiniteOriginals = useRef(new Map<string, ResultRow>());
  const filterKey = JSON.stringify(filter);
  const datasource = useMemo<GridDatasource | undefined>(
    () =>
      infinite
        ? {
            // Filter-bar conditions are part of the version so a change drops the block cache; column
            // filters arrive with each block request (the grid resets its own cache when they change).
            version: `${infiniteVersion}|${filterKey}`,
            getRows: async ({ startRow, endRow, sort: blockSort, filters: blockFilters }) => {
              try {
                const page = await rpc("data.rows", {
                  connectionId: tab.connectionId,
                  schema: tab.schema,
                  table: tab.table,
                  limit: endRow - startRow,
                  offset: startRow,
                  sort: blockSort,
                  filters: [...(filter.filters ?? []), ...blockFilters],
                  where: filter.where,
                });
                setInfiniteTotal(page.total);
                setInfiniteError(null);
                // Keep the array identity when the keys did not change: it feeds rowIdOf → gridRows → pinnedTopRowData.
                setInfiniteKeys((prev) =>
                  prev && prev.length === page.keyColumns.length && prev.every((k, i) => k === page.keyColumns[i])
                    ? prev
                    : page.keyColumns,
                );
                // Stamp the id on each row: the grid asks for ids as soon as the block lands, before
                // React has re-rendered with this response's keyColumns.
                // Without a key (views, PK-less tables) ids are positional: AG Grid renders rows by id and
                // collapses duplicates, which froze the viewport when every row was "[]".
                const stamped = page.rows.map((row, i) => ({
                  ...row,
                  __rowId: page.keyColumns.length
                    ? JSON.stringify(page.keyColumns.map((k) => row[k]))
                    : `@${startRow + i}`,
                }));
                for (const row of stamped)
                  infiniteOriginals.current.set(row.__rowId as string, row);
                return { rows: stamped, total: page.total };
              } catch (error) {
                setInfiniteError(error);
                throw error;
              }
            },
          }
        : undefined,
    [
      infinite,
      infiniteVersion,
      tab.connectionId,
      tab.schema,
      tab.table,
      filterKey,
    ],
  );
  const total = infinite ? infiniteTotal : (rows.data?.total ?? null);
  const pageCount =
    total === null ? null : Math.max(1, Math.ceil(total / pageSize));
  const qualified = tab.schema
    ? `${quote(tab.schema)}.${quote(tab.table)}`
    : quote(tab.table);
  const columnNames = useMemo(
    () =>
      details.data?.columns.map((c) => c.name) ??
      rows.data?.columns.map((c) => c.name) ??
      [],
    [details.data, rows.data],
  );
  const activeFilters = countActive(filter) + columnFilters.length;
  const scope = tableScope(tab.connectionId, tab.schema, tab.table);
  const formats = useScopeFormats(scope);
  const formatDefaults = useFormatStore((s) => s.defaults);
  const setFormat = useFormatStore((s) => s.setFormat);
  // Stable callbacks: they feed DataGrid's columnDefs, and re-applying column defs with active column
  // filters makes AG Grid rebuild the filters and reset the infinite cache (a refetch loop).
  const resetFormat = useCallback((column: string) => setFormat(scope, column, null), [setFormat, scope]);
  const formatColumn = useCallback(
    (column: string) => {
      const col = rows.data?.columns.find((c) => c.name === column);
      const sample =
        rows.data?.rows.find(
          (r) => r[column] !== null && r[column] !== undefined,
        )?.[column] ?? null;
      openDialog({
        kind: "format",
        scope,
        column,
        dataType: col?.dataType ?? null,
        sample,
      });
    },
    [rows.data, scope],
  );

  // ----- editing -----------------------------------------------------------------------------------
  const keyColumns = useMemo(
    () => (infinite ? (infiniteKeys ?? []) : (rows.data?.keyColumns ?? [])),
    [infinite, infiniteKeys, rows.data],
  );
  /** Whether we know enough about the table to decide if it is editable. */
  const rowsLoaded = infinite ? infiniteKeys !== null : Boolean(rows.data);
  const editable =
    keyColumns.length > 0 &&
    (details.data?.table.kind ?? "table") === "table";
  const gridColumns = useMemo(
    () =>
      infinite
        ? (details.data?.columns ?? []).map((c) => ({
            name: c.name,
            dataType: c.dataType,
          }))
        : (rows.data?.columns ?? []),
    [infinite, details.data, rows.data],
  );
  const rowIdOf = useCallback(
    (row: ResultRow): string =>
      typeof row.__rowId === "string"
        ? row.__rowId
        : JSON.stringify(keyColumns.map((k) => row[k])),
    [keyColumns],
  );
  /** Rows of the current page; without a key they get positional ids so AG Grid row identity stays unique. */
  const pageRows = useMemo<ResultRow[]>(() => {
    // In infinite mode the block cache owns the rows; the (cached) page query must not leak into the grid,
    // where `rows` becomes pinnedTopRowData — it covered the viewport when switching modes with a table open.
    if (infinite) return [];
    const list = rows.data?.rows ?? [];
    if (keyColumns.length) return list;
    return list.map((r, i) => ({ ...r, __rowId: `@${request.offset + i}` }));
  }, [infinite, rows.data, keyColumns, request.offset]);
  /** Original (server) rows by id, used for keys and for detecting "back to original" edits. */
  const pageOriginals = useMemo(
    () => new Map(pageRows.map((r) => [rowIdOf(r), r])),
    [pageRows, rowIdOf],
  );
  // In infinite mode the map is filled block by block by the datasource (read lazily, so the ref is fine).
  const originals = infinite ? infiniteOriginals.current : pageOriginals;
  const gridRows = useMemo<ResultRow[]>(() => {
    const inserted = [...changes.pending.inserts.entries()].map(
      ([id, values]) => ({ ...values, __rowId: id }),
    );
    const existing = pageRows.map((r) => {
      const id = rowIdOf(r);
      const edit = changes.pending.updates.get(id);
      return edit ? { ...r, ...edit } : r;
    });
    return [...inserted, ...existing];
  }, [pageRows, changes.pending, rowIdOf]);
  /** Single-column foreign keys: column → referenced table/column. */
  const references = useMemo(() => {
    const map = new Map<
      string,
      { schema: string | null; table: string; column: string }
    >();
    for (const fk of details.data?.foreignKeys ?? []) {
      if (
        fk.columns.length === 1 &&
        fk.refColumns.length === 1 &&
        fk.refColumns[0] !== "<rowid>"
      ) {
        map.set(fk.columns[0]!, {
          schema: fk.refSchema,
          table: fk.refTable,
          column: fk.refColumns[0]!,
        });
      }
    }
    return map;
  }, [details.data]);
  const editorFor = useCallback(
    (column: string): CellEditorSpec => {
      const info = details.data?.columns.find((c) => c.name === column);
      const ref = references.get(column);
      if (ref) return { type: "lookup", connectionId: tab.connectionId, ref };
      if (info?.enumValues?.length)
        return { type: "enum", values: info.enumValues };
      if (/^bool/i.test(info?.dataType ?? "")) return { type: "boolean" };
      const mode = dateEditMode(info?.dataType);
      if (mode) {
        const format = formats[column];
        const timeZone =
          format?.kind === "date" ? format.timeZone : formatDefaults.timeZone;
        return {
          type: "date",
          mode,
          withZone: dateTypeHasZone(info?.dataType),
          timeZone,
        };
      }
      return { type: "text" };
    },
    [details.data, references, tab.connectionId, formats, formatDefaults],
  );
  /** Filter UI per column: set for keys, enums and booleans; number / date by type; text otherwise. */
  const filterFor = useCallback(
    (column: string): ColumnFilterSpec => {
      const info = details.data?.columns.find((c) => c.name === column);
      const type = info?.dataType ?? "";
      if (info?.isPrimaryKey || references.has(column) || info?.enumValues?.length || /^bool/i.test(type))
        return {
          type: "set",
          source: { connectionId: tab.connectionId, schema: tab.schema, table: tab.table, column, ref: references.get(column) },
        };
      if (NUMERIC_TYPES.test(type)) return { type: "number" };
      const mode = dateEditMode(type);
      if (mode) return { type: "date", mode };
      return { type: "text" };
    },
    [details.data, references, tab.connectionId, tab.schema, tab.table],
  );
  const gridFilters = useMemo<GridColumnFilters>(
    () => ({ filterFor, model: filterModel, onModelChange: setFilterModel }),
    [filterFor, filterModel],
  );
  const editing = useMemo<GridEditing | undefined>(
    () =>
      editable
        ? {
            isEditable: (column) => !column.startsWith("__"),
            onCellEdit: (rowId, column, value) =>
              changes.setCell(
                rowId,
                column,
                value,
                originals.get(rowId)?.[column],
              ),
            rowStatus: (rowId) =>
              rowId.startsWith("new:")
                ? "new"
                : changes.pending.deletes.has(rowId)
                  ? "deleted"
                  : undefined,
            isDirty: (rowId, column) =>
              !rowId.startsWith("new:") &&
              changes.pending.updates.get(rowId)?.[column] !== undefined,
            pendingValue: (rowId, column) =>
              changes.pending.updates.get(rowId)?.[column],
            statusKey: [...changes.pending.deletes].join("\u0000"),
            editorFor,
          }
        : undefined,
    [editable, changes, originals, editorFor],
  );
  /** The row behind a grid cell: page rows in paginated mode, the block cache (or pinned inserts) in infinite mode. */
  const rowAt = (c: SelectedCell): ResultRow | undefined =>
    infinite && !c.pinned
      ? gridApi?.getDisplayedRowAtIndex(c.rowIndex)?.data
      : gridRows[c.rowIndex];
  const menuReference = menuCell ? references.get(menuCell.column) : undefined;
  const menuRow = menuCell ? rowAt(menuCell) : undefined;
  const menuRowId = menuRow ? rowIdOf(menuRow) : null;
  const applyFromViewer = (value: string | null) => {
    if (!cell || !editable) return;
    const row = rowAt(cell);
    if (!row) return;
    const rowId = rowIdOf(row);
    changes.setCell(
      rowId,
      cell.column,
      value,
      originals.get(rowId)?.[cell.column],
    );
    setCell({ ...cell, value });
  };
  const menuStatus = menuRowId ? editing?.rowStatus(menuRowId) : undefined;

  async function save() {
    const payload = buildChanges(changes.pending, originals, keyColumns);
    if (!payload.length) return;
    setSaving(true);
    try {
      const result = await rpc("data.mutate", {
        connectionId: tab.connectionId,
        schema: tab.schema,
        table: tab.table,
        changes: payload,
      });
      toast.success(`Saved ${tab.table}`, {
        description: `${result.inserted} inserted · ${result.updated} updated · ${result.deleted} deleted · ${formatDuration(result.durationMs)}`,
      });
      changes.clear();
      setSelectedIds([]);
      gridApi?.deselectAll();
      void queryClient.invalidateQueries({ queryKey: ["rows"] });
      if (infinite) setInfiniteVersion((v) => v + 1);
    } catch (error) {
      toast.error("Save failed", { description: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  }

  function addRow() {
    const id = changes.addRow();
    setTimeout(() => {
      const firstCol = gridColumns.find((c) => !c.name.startsWith("__"))?.name;
      if (gridApi && firstCol) {
        if (infinite) {
          // Inserts are pinned on top in infinite mode (the block cache owns the scrolling rows).
          gridApi.startEditingCell({
            rowIndex: 0,
            colKey: firstCol,
            rowPinned: "top",
          });
        } else {
          gridApi.ensureIndexVisible(0);
          gridApi.startEditingCell({ rowIndex: 0, colKey: firstCol });
        }
      }
    }, 50);
    return id;
  }

  const exportSource: ExportSource = {
    kind: "table",
    connectionId: tab.connectionId,
    schema: tab.schema,
    table: tab.table,
    sort,
    filters: effectiveFilter.filters,
    where: effectiveFilter.where,
  };

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["rows"] });
    void queryClient.invalidateQueries({
      queryKey: keys.table(tab.connectionId, tab.schema, tab.table),
    });
    setInfiniteVersion((v) => v + 1);
  }

  return (
    <Tabs
      value={view}
      onValueChange={setView}
      className="flex h-full min-h-0 flex-col gap-0"
    >
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
        <TabsList variant="line" className="h-8">
          <TabsTrigger value="data">Data</TabsTrigger>
          <TabsTrigger value="columns">
            Columns{" "}
            {details.data && (
              <Badge variant="secondary">{details.data.columns.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="indexes">
            Indexes{" "}
            {details.data && (
              <Badge variant="secondary">{details.data.indexes.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="fks">
            Foreign keys{" "}
            {details.data && (
              <Badge variant="secondary">
                {details.data.foreignKeys.length}
              </Badge>
            )}
          </TabsTrigger>
          {details.data?.ddl && <TabsTrigger value="ddl">DDL</TabsTrigger>}
        </TabsList>
        <span className="ml-auto" />
        {view === "data" && editable && (
          <>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button variant="ghost" size="icon-sm" aria-label="Add row" />
                }
                onClick={addRow}
              >
                <PlusIcon />
              </TooltipTrigger>
              <TooltipContent>Add row</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Delete selected rows"
                    disabled={!selectedIds.length}
                  />
                }
                onClick={() => changes.toggleDelete(selectedIds, true)}
              >
                <Trash2Icon />
              </TooltipTrigger>
              <TooltipContent>Mark selected rows for deletion</TooltipContent>
            </Tooltip>
            {changes.count > 0 && (
              <>
                <Button
                  size="sm"
                  onClick={save}
                  disabled={saving}
                  aria-label="Save changes"
                >
                  <SaveIcon /> Save
                  <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                    {changes.count}
                  </Badge>
                </Button>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Discard changes"
                      />
                    }
                    onClick={() => {
                      changes.clear();
                      gridApi?.deselectAll();
                    }}
                  >
                    <RotateCcwIcon />
                  </TooltipTrigger>
                  <TooltipContent>Discard all changes</TooltipContent>
                </Tooltip>
              </>
            )}
            <span className="mx-1 h-5 w-px bg-border" />
          </>
        )}
        {view === "data" && (
          <>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant={
                      filterOpen || activeFilters ? "secondary" : "ghost"
                    }
                    size="sm"
                    aria-label="Filters"
                  />
                }
                onClick={() => setFilterOpen((v) => !v)}
              >
                <FilterIcon />
                Filter
                {activeFilters > 0 && (
                  <Badge className="h-4 px-1 text-[10px]">
                    {activeFilters}
                  </Badge>
                )}
              </TooltipTrigger>
              <TooltipContent>Filter rows</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant={valueOpen ? "secondary" : "ghost"}
                    size="icon-sm"
                    aria-label="Value viewer"
                  />
                }
                onClick={() => setValueOpen((v) => !v)}
              >
                <PanelRightIcon />
              </TooltipTrigger>
              <TooltipContent>
                Value viewer (double-click a cell)
              </TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="sm" />}
              >
                <DatabaseIcon /> Data
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={() => setDialog("export")}>
                  <DownloadIcon /> Export rows…
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDialog("import")}>
                  <UploadIcon /> Import from file…
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDialog("transfer")}>
                  <CopyIcon /> Copy rows to table…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Open in SQL editor"
              />
            }
            onClick={() =>
              openSqlEditor(
                tab.connectionId,
                `select *\nfrom ${qualified}\nlimit 100;`,
              )
            }
          >
            <TerminalIcon />
          </TooltipTrigger>
          <TooltipContent>Open in SQL editor</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label="Refresh" />
            }
            onClick={refresh}
          >
            <RefreshCwIcon
              className={rows.isFetching ? "animate-spin" : undefined}
            />
          </TooltipTrigger>
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>
      </div>

      <TabsContent value="data" className="flex min-h-0 flex-1 flex-col">
        {filterOpen && (
          <FilterBar
            columns={columnNames}
            value={filter}
            onApply={(f) => {
              setFilter(f);
              setPage(0);
            }}
            onClear={() => {
              setFilterModel({});
              void gridApi?.setFilterModel(null);
            }}
          />
        )}
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-h-0 flex-1"
        >
          <ResizablePanel minSize={240} className="min-w-0">
            {rows.error || infiniteError ? (
              <ErrorBanner
                error={rows.error ?? infiniteError}
                title="Could not load rows"
              />
            ) : (
              <ContextMenu>
                <ContextMenuTrigger className="block h-full w-full">
                  <DataGrid
                    columns={gridColumns}
                    rows={gridRows}
                    datasource={datasource}
                    sort={sort}
                    onSortChange={(s) => {
                      setSort(s);
                      setPage(0);
                    }}
                    onCellSelect={setCell}
                    onCellOpen={
                      editable
                        ? undefined
                        : (c) => {
                            setCell(c);
                            setValueOpen(true);
                          }
                    }
                    onCellContextMenu={(c) => {
                      setCell(c);
                      setMenuCell(c);
                    }}
                    formats={formats}
                    formatDefaults={formatDefaults}
                    onFormatColumn={formatColumn}
                    onResetFormat={resetFormat}
                    getRowId={rowIdOf}
                    editing={editing}
                    selectable={editable}
                    onSelectionChange={setSelectedIds}
                    onApi={setGridApi}
                    loading={rows.isLoading}
                    columnFilters={gridFilters}
                  />
                </ContextMenuTrigger>
                <ContextMenuContent className="w-56">
                  {menuCell && (
                    <>
                      <ContextMenuItem
                        onClick={() => {
                          setValueOpen(true);
                        }}
                      >
                        <PanelRightIcon /> Show value
                      </ContextMenuItem>
                      {menuReference &&
                        menuCell.value !== null &&
                        menuCell.value !== undefined && (
                          <ContextMenuItem
                            onClick={() =>
                              openTable(
                                tab.connectionId,
                                menuReference.schema,
                                menuReference.table,
                                {
                                  filter: {
                                    filters: [
                                      {
                                        column: menuReference.column,
                                        op: "eq",
                                        value: String(menuCell.value),
                                      },
                                    ],
                                  },
                                },
                              )
                            }
                          >
                            <ExternalLinkIcon /> Open referenced row (
                            {menuReference.table})
                          </ContextMenuItem>
                        )}
                      <ContextMenuItem
                        onClick={() =>
                          void navigator.clipboard.writeText(
                            menuCell.value === null ||
                              menuCell.value === undefined
                              ? ""
                              : typeof menuCell.value === "object"
                                ? JSON.stringify(menuCell.value)
                                : String(menuCell.value),
                          )
                        }
                      >
                        <CopyIcon /> Copy value
                      </ContextMenuItem>
                      {editable && menuRowId && (
                        <>
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            disabled={menuStatus === "deleted"}
                            onClick={() =>
                              gridApi?.startEditingCell({
                                rowIndex: menuCell.rowIndex,
                                colKey: menuCell.column,
                                rowPinned: menuCell.pinned ? "top" : undefined,
                              })
                            }
                          >
                            <PencilIcon /> Edit cell
                          </ContextMenuItem>
                          <ContextMenuItem
                            disabled={menuStatus === "deleted"}
                            onClick={() =>
                              changes.setCell(
                                menuRowId,
                                menuCell.column,
                                null,
                                originals.get(menuRowId)?.[menuCell.column],
                              )
                            }
                          >
                            <BanIcon /> Set NULL
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem onClick={addRow}>
                            <PlusIcon /> Add row
                          </ContextMenuItem>
                          {menuStatus === "deleted" ? (
                            <ContextMenuItem
                              onClick={() =>
                                changes.toggleDelete([menuRowId], false)
                              }
                            >
                              <UndoIcon /> Undo delete
                            </ContextMenuItem>
                          ) : (
                            <ContextMenuItem
                              variant="destructive"
                              onClick={() =>
                                changes.toggleDelete([menuRowId], true)
                              }
                            >
                              <Trash2Icon />{" "}
                              {menuStatus === "new"
                                ? "Remove new row"
                                : "Delete row"}
                            </ContextMenuItem>
                          )}
                          {(changes.pending.updates.has(menuRowId) ||
                            menuStatus === "deleted") && (
                            <ContextMenuItem
                              onClick={() => changes.discardRow(menuRowId)}
                            >
                              <XIcon /> Discard row changes
                            </ContextMenuItem>
                          )}
                        </>
                      )}
                    </>
                  )}
                </ContextMenuContent>
              </ContextMenu>
            )}
          </ResizablePanel>
          {valueOpen && (
            <>
              <ResizableHandle />
              <ResizablePanel defaultSize={380} minSize={240} maxSize={1000}>
                <ValuePanel
                  cell={cell}
                  columns={gridColumns}
                  onClose={() => setValueOpen(false)}
                  onApply={editable ? applyFromViewer : undefined}
                />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
        <div className="flex h-8 shrink-0 items-center gap-1 border-t px-2 text-xs text-muted-foreground">
          <span className="tabular-nums" title="Columns in this table">
            {formatCount(gridColumns.length)} cols
          </span>
          {editable && selectedIds.length > 0 && (
            <span className="text-primary">
              · {formatCount(selectedIds.length)} selected
            </span>
          )}
          {cell && (
            <span className="truncate" title="Focused cell">
              · {cell.column} @ {formatCount(cell.rowIndex + 1)}
            </span>
          )}
          <span className="mx-1 h-4 w-px bg-border" />
          {infinite ? (
            <span>
              {total === null
                ? "scrolling…"
                : `${formatCount(total)} rows · infinite scroll`}
            </span>
          ) : (
            <>
              <Select
                value={String(pageSize)}
                items={PAGE_SIZE_ITEMS}
                onValueChange={(v) => {
                  setPageSize(Number(v));
                  setPage(0);
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="h-6 text-xs"
                  aria-label="Page size"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_ITEMS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="ml-2">
                {rows.data
                  ? `${formatCount(rows.data.rows.length ? request.offset + 1 : 0)}–${formatCount(request.offset + rows.data.rows.length)} of ${formatCount(total)}`
                  : "…"}
              </span>
            </>
          )}
          {activeFilters > 0 && <span>(filtered)</span>}
          {rowsLoaded && !editable && (
            <span
              className="ml-2 hidden sm:inline"
              title="Views and tables without a primary key or row id cannot be edited here"
            >
              · read-only
            </span>
          )}
          {changes.count > 0 && (
            <span className="ml-2 text-primary">· {changes.count} unsaved</span>
          )}
          {rows.data && (
            <span className="ml-2 hidden sm:inline">
              · {formatDuration(rows.data.durationMs)}
            </span>
          )}
          <span className="ml-auto" />
          {!infinite && (
            <>
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={page === 0}
                onClick={() => setPage(0)}
                aria-label="First page"
              >
                <ChevronsLeftIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
                aria-label="Previous page"
              >
                <ChevronLeftIcon />
              </Button>
              <span className="min-w-16 text-center tabular-nums">
                {page + 1} / {pageCount ?? "?"}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={pageCount !== null && page + 1 >= pageCount}
                onClick={() => setPage((p) => p + 1)}
                aria-label="Next page"
              >
                <ChevronRightIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={pageCount === null || page + 1 >= pageCount}
                onClick={() => pageCount && setPage(pageCount - 1)}
                aria-label="Last page"
              >
                <ChevronsRightIcon />
              </Button>
            </>
          )}
        </div>
      </TabsContent>

      <TabsContent value="columns" className="min-h-0 flex-1">
        {details.error ? (
          <ErrorBanner error={details.error} />
        ) : (
          <ScrollArea className="h-full">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Nullable</TableHead>
                  <TableHead>Default</TableHead>
                  <TableHead>Comment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {details.data?.columns.map((c) => (
                  <TableRow key={c.name}>
                    <TableCell className="text-muted-foreground">
                      {c.ordinal}
                    </TableCell>
                    <TableCell className="font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        {c.isPrimaryKey && (
                          <KeyRoundIcon className="size-3.5 text-amber-500" />
                        )}
                        {c.name}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {c.dataType}
                    </TableCell>
                    <TableCell>
                      {c.nullable ? (
                        "yes"
                      ) : (
                        <span className="text-muted-foreground">no</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {c.defaultValue ?? ""}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {c.comment ?? ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </TabsContent>

      <TabsContent value="indexes" className="min-h-0 flex-1">
        <ScrollArea className="h-full">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Columns</TableHead>
                <TableHead>Unique</TableHead>
                <TableHead>Definition</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {details.data?.indexes.map((ix) => (
                <TableRow key={ix.name}>
                  <TableCell className="font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      {ix.primary && (
                        <KeyRoundIcon className="size-3.5 text-amber-500" />
                      )}
                      {ix.name}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {ix.columns.join(", ")}
                  </TableCell>
                  <TableCell>
                    {ix.unique ? (
                      "yes"
                    ) : (
                      <span className="text-muted-foreground">no</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {ix.definition ?? ""}
                  </TableCell>
                </TableRow>
              ))}
              {details.data?.indexes.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="text-center text-muted-foreground italic"
                  >
                    No indexes
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="fks" className="min-h-0 flex-1">
        <ScrollArea className="h-full">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Columns</TableHead>
                <TableHead>References</TableHead>
                <TableHead>On delete</TableHead>
                <TableHead>On update</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {details.data?.foreignKeys.map((fk) => (
                <TableRow key={fk.name}>
                  <TableCell className="font-medium">{fk.name}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {fk.columns.join(", ")}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {fk.refSchema ? `${fk.refSchema}.` : ""}
                    {fk.refTable} ({fk.refColumns.join(", ")})
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {fk.onDelete ?? ""}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {fk.onUpdate ?? ""}
                  </TableCell>
                </TableRow>
              ))}
              {details.data?.foreignKeys.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-muted-foreground italic"
                  >
                    No foreign keys
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </TabsContent>

      {details.data?.ddl && (
        <TabsContent value="ddl" className="min-h-0 flex-1">
          <CodeView
            value={details.data.ddl}
            language={dialect === "sqlite" ? "sqlite" : "sql"}
          />
        </TabsContent>
      )}

      <ExportDialog
        open={dialog === "export"}
        onOpenChange={(o) => setDialog(o ? "export" : null)}
        source={exportSource}
        defaultName={tab.table}
      />
      <ImportDialog
        open={dialog === "import"}
        onOpenChange={(o) => setDialog(o ? "import" : null)}
        connectionId={tab.connectionId}
        schema={tab.schema}
        table={tab.table}
        targetColumns={columnNames}
        onImported={refresh}
      />
      <TransferDialog
        open={dialog === "transfer"}
        onOpenChange={(o) => setDialog(o ? "transfer" : null)}
        source={exportSource}
        sourceColumns={columnNames}
        onDone={refresh}
      />
    </Tabs>
  );
}

function quote(identifier: string): string {
  return /^[a-z_][a-z0-9_]*$/.test(identifier)
    ? identifier
    : `"${identifier.replace(/"/g, '""')}"`;
}
