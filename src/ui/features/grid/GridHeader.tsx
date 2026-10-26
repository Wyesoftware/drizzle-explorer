import { useEffect, useState, type MouseEvent } from "react";
import type { CustomHeaderProps } from "ag-grid-react";
import { ArrowDownIcon, ArrowUpIcon, ArrowUpDownIcon, CopyIcon, EllipsisIcon, PaintbrushIcon, XIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface GridHeaderParams {
  dataType?: string | null;
  /** Short description of the active display format, shown as a badge. */
  formatLabel?: string | null;
  onFormat?: (column: string) => void;
  onResetFormat?: (column: string) => void;
}

/** Column header with sort indicator and a "⋯" / right-click menu (sort, format, copy name). */
export function GridHeader(props: CustomHeaderProps & GridHeaderParams) {
  const { column, displayName, enableSorting, progressSort, setSort, dataType, formatLabel, onFormat, onResetFormat } = props;
  const [sort, setSortState] = useState(column.getSort());
  const [open, setOpen] = useState(false);
  const colId = column.getColId();

  useEffect(() => {
    const listener = () => setSortState(column.getSort());
    column.addEventListener("sortChanged", listener);
    return () => column.removeEventListener("sortChanged", listener);
  }, [column]);

  const onHeaderClick = (e: MouseEvent) => {
    if (enableSorting) progressSort(e.shiftKey || e.ctrlKey || e.metaKey);
  };

  return (
    <div
      className="group/header flex h-full w-full min-w-0 items-center gap-1"
      onClick={onHeaderClick}
      onContextMenu={(e) => {
        e.preventDefault();
        setOpen(true);
      }}
      title={dataType ? `${displayName} · ${dataType}` : displayName}
    >
      <span className="truncate">{displayName}</span>
      {formatLabel && (
        <span className="shrink-0 rounded bg-primary/15 px-1 text-[9px] leading-4 text-primary" title={`Format: ${formatLabel}`}>
          {formatLabel}
        </span>
      )}
      {sort === "asc" && <ArrowUpIcon className="size-3 shrink-0 text-muted-foreground" />}
      {sort === "desc" && <ArrowDownIcon className="size-3 shrink-0 text-muted-foreground" />}
      <span className="ml-auto" />
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label={`Column menu for ${displayName}`}
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground",
                open ? "opacity-100" : "opacity-0 group-hover/header:opacity-100",
              )}
            />
          }
          onClick={(e: MouseEvent) => e.stopPropagation()}
        >
          <EllipsisIcon className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {enableSorting && (
            <>
              <DropdownMenuItem onClick={() => setSort("asc", false)}>
                <ArrowUpIcon /> Sort ascending
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSort("desc", false)}>
                <ArrowDownIcon /> Sort descending
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSort(null, false)} disabled={!sort}>
                <ArrowUpDownIcon /> Clear sort
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {onFormat && (
            <DropdownMenuItem onClick={() => onFormat(colId)}>
              <PaintbrushIcon /> Format…
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => void navigator.clipboard.writeText(colId)}>
            <CopyIcon /> Copy column name
          </DropdownMenuItem>
          {formatLabel && onResetFormat && (
            <DropdownMenuItem onClick={() => onResetFormat(colId)}>
              <XIcon /> Reset format
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
