import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "@/lib/theme";
import { AgGridReact } from "ag-grid-react";
import {
  colorSchemeDark,
  colorSchemeLight,
  themeQuartz,
  type CellContextMenuEvent,
  type CellDoubleClickedEvent,
  type CellFocusedEvent,
  type ColDef,
  type FilterChangedEvent,
  type GridApi,
  type ICellRendererParams,
  type IDatasource,
  type RowClassRules,
  type RowSelectionOptions,
  type SelectionChangedEvent,
  type SortChangedEvent,
} from "ag-grid-community";
import type { FilterSpec, ResultColumn, ResultRow, SortSpec } from "@shared/types";
import type { SelectedCell } from "./ValuePanel";
import { GridHeader, type GridHeaderParams } from "./GridHeader";
import { describeFormat, formatCellValue, type ColumnFormat, type FormatDefaults } from "@/lib/format-value";
import { DEFAULT_FORMAT_DEFAULTS } from "@/lib/format-value";
import { DateCellEditor, type DateCellEditorParams } from "./editors/DateCellEditor";
import { LookupCellEditor, type LookupCellEditorParams } from "./editors/LookupCellEditor";
import { ColumnFilter, type ColumnFilterParams } from "./filters/ColumnFilter";
import { ColumnFloatingFilter } from "./filters/ColumnFloatingFilter";
import { toFilterSpecs, type ColumnFilterModels, type ColumnFilterSpec } from "./filters/model";

const darkTheme = themeQuartz.withPart(colorSchemeDark).withParams({
  backgroundColor: "var(--background)",
  foregroundColor: "var(--foreground)",
  headerBackgroundColor: "var(--muted)",
  borderColor: "var(--border)",
  rowHoverColor: "color-mix(in oklch, var(--muted) 60%, transparent)",
  accentColor: "var(--primary)",
  fontFamily: "var(--font-sans)",
  fontSize: 12,
  headerFontSize: 12,
  rowHeight: 28,
  headerHeight: 30,
  spacing: 4,
  wrapperBorderRadius: 0,
  wrapperBorder: false,
});

const lightTheme = themeQuartz.withPart(colorSchemeLight).withParams({
  backgroundColor: "var(--background)",
  foregroundColor: "var(--foreground)",
  headerBackgroundColor: "var(--muted)",
  borderColor: "var(--border)",
  accentColor: "var(--primary)",
  fontFamily: "var(--font-sans)",
  fontSize: 12,
  headerFontSize: 12,
  rowHeight: 28,
  headerHeight: 30,
  spacing: 4,
  wrapperBorderRadius: 0,
  wrapperBorder: false,
});

interface CellParams extends ICellRendererParams<ResultRow> {
  format?: ColumnFormat;
  dataType?: string | null;
  defaults?: FormatDefaults;
}

function CellRenderer(params: CellParams) {
  // Infinite row model: rows of a block that is still loading have no data yet — show a skeleton, not NULL.
  if (!params.data) return <span className="cell-skeleton" aria-label="Loading" />;
  const value = params.value;
  if (value === null || value === undefined) return <span className="text-muted-foreground/60 italic">NULL</span>;
  const formatted = formatCellValue(value, params.format, params.dataType, params.defaults ?? DEFAULT_FORMAT_DEFAULTS);
  if (formatted !== null) return <span title={typeof value === "object" ? JSON.stringify(value) : String(value)}>{formatted}</span>;
  if (typeof value === "boolean") return <span className="font-mono">{String(value)}</span>;
  if (typeof value === "object") return <span className="font-mono text-xs">{JSON.stringify(value)}</span>;
  return <span>{String(value)}</span>;
}

export type RowStatus = "new" | "deleted" | undefined;

export type CellEditorSpec =
  | { type: "text" }
  | { type: "boolean" }
  | { type: "enum"; values: string[] }
  | ({ type: "date" } & DateCellEditorParams)
  | ({ type: "lookup" } & LookupCellEditorParams);

export interface GridDatasource {
  /** Change to make the grid discard its cache and refetch (filters changed, refresh). */
  version: number | string;
  /** `filters` are the column filters of the grid's own filter model (the grid resets its cache when they change). */
  getRows: (params: { startRow: number; endRow: number; sort: SortSpec[]; filters: FilterSpec[] }) => Promise<{ rows: ResultRow[]; total: number | null }>;
}

/**
 * Server-side column filters: a floating filter row under the header whose models are reported back
 * (never applied client-side). The model is kept by the owner so it survives a grid remount.
 */
export interface GridColumnFilters {
  /** Filter UI per column (set / number / date / text), usually derived from the column type. */
  filterFor: (column: string) => ColumnFilterSpec;
  model: ColumnFilterModels;
  /** `displayedRows` is the count after filtering, only in client-side mode. */
  onModelChange: (model: ColumnFilterModels, displayedRows?: number) => void;
  /** Apply the filters in the grid itself (rows in memory) instead of reporting them to the server. */
  clientSide?: boolean;
}

/** Column id of the running row number (pinned left; not a data column). */
export const ROW_NUMBER_COL = "__row_number";

export interface GridEditing {
  isEditable: (column: string) => boolean;
  onCellEdit: (rowId: string, column: string, value: unknown) => void;
  rowStatus: (rowId: string) => RowStatus;
  isDirty: (rowId: string, column: string) => boolean;
  /** Picks the editor by column type (enum select, date picker, FK lookup…). Defaults to text. */
  editorFor?: (column: string) => CellEditorSpec;
  /**
   * Unsaved value for a cell, or undefined when the cell is untouched. Needed in infinite-scroll mode,
   * where rows live in the grid's block cache and cannot be replaced through `rows`.
   */
  pendingValue?: (rowId: string, column: string) => unknown;
  /** Changes whenever a row's status (new/deleted) changes; triggers a row redraw so row classes update. */
  statusKey?: string;
}

export const NUMERIC_TYPES = /int|serial|numeric|decimal|real|double|float|money/i;

// Grid options must be referentially stable: a new object per render makes AG Grid re-apply the option,
// which in the infinite row model resets the block cache after every load (an endless refetch loop).
const ROW_SELECTION: RowSelectionOptions<ResultRow> = { mode: "multiRow", checkboxes: true, headerCheckbox: true, enableClickSelection: false };
const ROW_SELECTION_INFINITE: RowSelectionOptions<ResultRow> = { ...ROW_SELECTION, headerCheckbox: false };

function editorColDef(spec: CellEditorSpec | undefined): Pick<ColDef, "cellEditor" | "cellEditorParams" | "cellEditorPopup" | "cellEditorPopupPosition"> {
  switch (spec?.type) {
    case "boolean":
      return { cellEditor: "agSelectCellEditor", cellEditorParams: { values: ["true", "false"] } };
    case "enum":
      return { cellEditor: "agSelectCellEditor", cellEditorParams: { values: spec.values } };
    case "date":
      return { cellEditor: DateCellEditor, cellEditorParams: { mode: spec.mode, withZone: spec.withZone, timeZone: spec.timeZone } };
    case "lookup":
      return {
        cellEditor: LookupCellEditor,
        cellEditorParams: { connectionId: spec.connectionId, ref: spec.ref },
        cellEditorPopup: true,
        cellEditorPopupPosition: "under",
      };
    default:
      return { cellEditor: "agTextCellEditor" };
  }
}

export function DataGrid({
  columns,
  rows,
  sort,
  onSortChange,
  onCellSelect,
  onCellOpen,
  onCellContextMenu,
  formats,
  formatDefaults,
  onFormatColumn,
  onResetFormat,
  getRowId,
  editing,
  selectable = false,
  onSelectionChange,
  onApi,
  datasource,
  loading = false,
  columnFilters,
  rowNumberOffset = 0,
}: {
  columns: ResultColumn[];
  rows: ResultRow[];
  /** When provided, sorting is handled by the server (grid sorts are reported, not applied). */
  sort?: SortSpec[];
  onSortChange?: (sort: SortSpec[]) => void;
  /** Fired when a cell gets focus (click or keyboard). */
  onCellSelect?: (cell: SelectedCell) => void;
  /** Fired on double-click; used to open the value viewer. */
  onCellOpen?: (cell: SelectedCell) => void;
  /** Per-column display formats (see lib/format-value.ts). */
  formats?: Record<string, ColumnFormat>;
  formatDefaults?: FormatDefaults;
  /** Enables the "Format…" entry in the column header menu. */
  onFormatColumn?: (column: string) => void;
  onResetFormat?: (column: string) => void;
  /** Right-click on a cell (the browser menu is not suppressed; wrap the grid in a ContextMenuTrigger). */
  onCellContextMenu?: (cell: SelectedCell) => void;
  /** Stable row identity; required for editing and selection. */
  getRowId?: (row: ResultRow) => string;
  editing?: GridEditing;
  selectable?: boolean;
  onSelectionChange?: (rowIds: string[]) => void;
  onApi?: (api: GridApi<ResultRow>) => void;
  /** Infinite scrolling: rows are fetched block by block instead of passed through `rows`. */
  datasource?: GridDatasource;
  loading?: boolean;
  columnFilters?: GridColumnFilters;
  /** Added to the running row number (paged table views: the page's first row index). */
  rowNumberOffset?: number;
}) {
  const [api, setApi] = useState<GridApi<ResultRow> | null>(null);
  const datasourceRef = useRef(datasource);
  datasourceRef.current = datasource;
  // Column defs only depend on `filterFor`; model/onModelChange are read through the ref.
  const columnFiltersRef = useRef(columnFilters);
  columnFiltersRef.current = columnFilters;
  // Editing callbacks are read through a ref so that pending-change updates do not rebuild the column defs:
  // re-applying column defs rebuilds active column filters, which resets the infinite cache.
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const editorFor = editing?.editorFor;
  const hasEditing = Boolean(editing);
  const filterFor = columnFilters?.filterFor;
  const clientSideFilters = Boolean(columnFilters?.clientSide);
  /** filterParams objects per column, reused while the spec is unchanged (see filterColDef). */
  const filterParamsCache = useRef(new Map<string, ColumnFilterParams>());
  const agDatasource = useMemo<IDatasource | undefined>(
    () =>
      datasource
        ? {
            getRows: (params) => {
              const sort: SortSpec[] = params.sortModel.map((s) => ({ column: s.colId, direction: s.sort === "desc" ? "desc" : "asc" }));
              datasourceRef.current
                ?.getRows({ startRow: params.startRow, endRow: params.endRow, sort, filters: toFilterSpecs(params.filterModel as ColumnFilterModels) })
                .then(({ rows, total }) => params.successCallback(rows, total ?? undefined))
                .catch(() => params.failCallback());
            },
          }
        : undefined,
    // The datasource object only needs to change when the version does; getRows reads the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Boolean(datasource), datasource?.version],
  );
  useEffect(() => {
    if (api && agDatasource) api.setGridOption("datasource", agDatasource);
  }, [api, agDatasource]);
  // Pending edits are overlaid through valueGetter/cellClassRules; force a repaint when they change.
  useEffect(() => {
    api?.refreshCells({ force: true });
  }, [api, editing]);
  useEffect(() => {
    api?.redrawRows();
  }, [api, editing?.statusKey]);
  const { resolvedTheme } = useTheme();
  const serverSort = Boolean(onSortChange);

  // Running row number: AG Grid's own `rowNumbers` option needs the Enterprise module, so this is a plain
  // pinned column reading the display index (sequential after client-side sorts/filters too).
  const digits = String(rowNumberOffset + rows.length).length;
  const rowNumberWidth = Math.max(44, 20 + (datasource ? Math.max(digits, 6) : digits) * 8);
  const rowNumberDef = useMemo<ColDef<ResultRow>>(
    () => ({
      colId: ROW_NUMBER_COL,
      headerName: "",
      pinned: "left",
      lockPosition: "left",
      lockPinned: true,
      suppressMovable: true,
      suppressNavigable: true,
      sortable: false,
      resizable: false,
      filter: false,
      floatingFilter: false,
      editable: false,
      suppressHeaderMenuButton: true,
      width: rowNumberWidth,
      minWidth: rowNumberWidth,
      maxWidth: rowNumberWidth,
      cellClass: "row-number-cell",
      headerClass: "row-number-header",
      valueGetter: (p) => (p.node?.rowPinned ? "" : (p.node?.rowIndex ?? 0) + 1 + rowNumberOffset),
    }),
    [rowNumberOffset, rowNumberWidth],
  );

  const columnDefs = useMemo<ColDef<ResultRow>[]>(
    () => [
      rowNumberDef,
      ...columns
        .filter((c) => !c.name.startsWith("__"))
        .map<ColDef<ResultRow>>((c) => ({
        field: c.name,
        colId: c.name,
        headerName: c.name,
        editable: hasEditing
          ? (p) => {
              const e = editingRef.current;
              return Boolean(e) && e!.isEditable(c.name) && (!p.data || e!.rowStatus(rowIdOf(p.data)) !== "deleted");
            }
          : false,
        ...(hasEditing ? editorColDef(editorFor?.(c.name)) : {}),
        valueSetter: hasEditing
          ? (p) => {
              if (!p.data) return false;
              editingRef.current?.onCellEdit(rowIdOf(p.data), c.name, p.newValue);
              return true;
            }
          : undefined,
        cellClassRules: hasEditing
          ? { "cell-dirty": (p) => Boolean(p.data) && Boolean(editingRef.current?.isDirty(rowIdOf(p.data!), c.name)) }
          : undefined,
        headerComponent: GridHeader,
        headerComponentParams: {
          dataType: c.dataType,
          formatLabel: describeFormat(formats?.[c.name]),
          onFormat: onFormatColumn,
          onResetFormat,
        } satisfies GridHeaderParams,
        cellRenderer: CellRenderer,
        cellRendererParams: { format: formats?.[c.name], dataType: c.dataType, defaults: formatDefaults },
        sortable: true,
        resizable: true,
        comparator: serverSort ? () => 0 : undefined,
        sort: sort?.find((s) => s.column === c.name)?.direction ?? null,
        sortIndex: sort ? indexOrNull(sort.findIndex((s) => s.column === c.name)) : null,
        valueGetter: (p) => {
          if (!p.data) return undefined;
          const pending = editingRef.current?.pendingValue?.(rowIdOf(p.data), c.name);
          return pending !== undefined ? pending : p.data[c.name];
        },
        cellClass:
          typeof rows[0]?.[c.name] === "number" || (rows.length === 0 && NUMERIC_TYPES.test(c.dataType ?? ""))
            ? "ag-right-aligned-cell font-mono"
            : undefined,
        minWidth: 80,
        ...(filterFor ? filterColDef(c.name, filterFor(c.name), filterParamsCache.current, clientSideFilters) : {}),
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rowNumberDef, columns, serverSort, sort, formats, formatDefaults, onFormatColumn, onResetFormat, hasEditing, editorFor, filterFor, clientSideFilters],
  );

  const rowIdOf = (row: ResultRow): string => (getRowId ? getRowId(row) : JSON.stringify(row));

  const rowClassRules = useMemo<RowClassRules<ResultRow>>(
    () => ({
      "row-loading": (p) => !p.data,
      ...(editing
        ? {
            "row-new": (p) => Boolean(p.data) && editing.rowStatus(rowIdOf(p.data!)) === "new",
            "row-deleted": (p) => Boolean(p.data) && editing.rowStatus(rowIdOf(p.data!)) === "deleted",
          }
        : {}),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editing],
  );

  const defaultColDef = useMemo<ColDef>(
    () => ({ flex: 0, width: 160, filter: !serverSort, suppressHeaderMenuButton: true }),
    [serverSort],
  );

  const handleFilterChanged = (event: FilterChangedEvent<ResultRow>) => {
    const model = (event.api.getFilterModel() as ColumnFilterModels) ?? {};
    columnFiltersRef.current?.onModelChange(model, columnFiltersRef.current.clientSide ? event.api.getDisplayedRowCount() : undefined);
  };

  const handleSortChanged = (event: SortChangedEvent<ResultRow>) => {
    if (!onSortChange) return;
    const state = event.api
      .getColumnState()
      .filter((c) => c.sort)
      .sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0))
      .map<SortSpec>((c) => ({ column: c.colId, direction: c.sort === "desc" ? "desc" : "asc" }));
    onSortChange(state);
  };

  const handleCellFocused = (event: CellFocusedEvent<ResultRow>) => {
    if (!onCellSelect || event.rowIndex === null || event.rowIndex === undefined) return;
    const colId = typeof event.column === "string" ? event.column : event.column?.getColId();
    if (!colId || colId === ROW_NUMBER_COL) return;
    const pinned = event.rowPinned === "top";
    const node = pinned ? event.api.getPinnedTopRow(event.rowIndex) : event.api.getDisplayedRowAtIndex(event.rowIndex);
    const value = node ? event.api.getCellValue({ rowNode: node, colKey: colId }) : undefined;
    onCellSelect({ column: colId, value, rowIndex: event.rowIndex, pinned: pinned || undefined });
  };

  const handleCellDoubleClicked = (event: CellDoubleClickedEvent<ResultRow>) => {
    if (!onCellOpen || event.rowIndex === null || event.column.getColId() === ROW_NUMBER_COL) return;
    onCellOpen({
      column: event.column.getColId(),
      value: event.value,
      rowIndex: event.rowIndex,
      pinned: event.rowPinned === "top" || undefined,
    });
  };

  const handleCellContextMenu = (event: CellContextMenuEvent<ResultRow>) => {
    if (!onCellContextMenu || event.rowIndex === null || event.column.getColId() === ROW_NUMBER_COL) return;
    onCellContextMenu({
      column: event.column.getColId(),
      value: event.value,
      rowIndex: event.rowIndex,
      pinned: event.rowPinned === "top" || undefined,
    });
  };

  const handleSelectionChanged = (event: SelectionChangedEvent<ResultRow>) => {
    onSelectionChange?.(event.api.getSelectedNodes().map((n) => n.id ?? "").filter(Boolean));
  };

  return (
    <div className="h-full w-full" data-loading={loading || undefined}>
      <AgGridReact<ResultRow>
        // AG Grid cannot switch row models after init: remount when toggling infinite scroll.
        key={datasource ? "infinite" : "client"}
        theme={resolvedTheme === "dark" ? darkTheme : lightTheme}
        columnDefs={columnDefs}
        rowData={datasource ? undefined : rows}
        // Infinite mode: the block cache owns the data, so `rows` (unsaved inserts) are pinned on top instead.
        pinnedTopRowData={datasource ? rows : undefined}
        rowModelType={datasource ? "infinite" : "clientSide"}
        cacheBlockSize={200}
        maxBlocksInCache={20}
        defaultColDef={defaultColDef}
        animateRows={false}
        enableCellTextSelection
        ensureDomOrder
        suppressMultiSort={false}
        multiSortKey="ctrl"
        onSortChanged={serverSort ? handleSortChanged : undefined}
        onFilterChanged={columnFilters ? handleFilterChanged : undefined}
        floatingFiltersHeight={30}
        onCellFocused={onCellSelect ? handleCellFocused : undefined}
        onCellDoubleClicked={onCellOpen ? handleCellDoubleClicked : undefined}
        onCellContextMenu={onCellContextMenu ? handleCellContextMenu : undefined}
        getRowId={getRowId ? (p) => getRowId(p.data) : undefined}
        rowClassRules={rowClassRules}
        rowSelection={selectable ? (datasource ? ROW_SELECTION_INFINITE : ROW_SELECTION) : undefined}
        onSelectionChanged={selectable ? handleSelectionChanged : undefined}
        onGridReady={(e) => {
          // Dev convenience: lets browser automation/tests drive the grid.
          if (import.meta.env.DEV) (window as unknown as { __grid?: unknown }).__grid = e.api;
          setApi(e.api);
          onApi?.(e.api);
          // Restore column filters after a remount (the grid is re-created when toggling infinite scroll).
          const model = columnFiltersRef.current?.model;
          if (model && Object.keys(model).length) void e.api.setFilterModel(model);
        }}
        stopEditingWhenCellsLoseFocus
        singleClickEdit={false}
        suppressClickEdit={!editing}
        loading={loading}
        tooltipShowDelay={400}
        overlayNoRowsTemplate='<span class="text-muted-foreground text-xs">No rows</span>'
      />
    </div>
  );
}

function filterColDef(
  column: string,
  spec: ColumnFilterSpec,
  cache: Map<string, ColumnFilterParams>,
  clientSide: boolean,
): Pick<ColDef, "filter" | "filterParams" | "floatingFilter" | "floatingFilterComponent" | "floatingFilterComponentParams" | "suppressFloatingFilterButton"> {
  // Keep the params object stable while the spec is unchanged, so re-applied column defs do not look
  // different to AG Grid (which would refresh / rebuild the filter components).
  const cached = cache.get(column);
  const params: ColumnFilterParams =
    cached && cached.clientSide === clientSide && JSON.stringify(cached.spec) === JSON.stringify(spec) ? cached : { spec, clientSide };
  cache.set(column, params);
  return {
    filter: ColumnFilter,
    filterParams: params,
    floatingFilter: true,
    floatingFilterComponent: ColumnFloatingFilter,
    floatingFilterComponentParams: params,
    // Set filters open the popup from their own summary button.
    suppressFloatingFilterButton: spec.type === "set",
  };
}

function indexOrNull(index: number): number | null {
  return index >= 0 ? index : null;
}
