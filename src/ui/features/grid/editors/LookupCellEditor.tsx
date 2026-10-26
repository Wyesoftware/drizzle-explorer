import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { CustomCellEditorProps } from "ag-grid-react";
import { Loader2Icon, SearchIcon } from "lucide-react";
import type { LookupRow } from "@shared/types";
import { errorMessage, rpc } from "@/lib/rpc";
import { cn } from "@/lib/utils";

export interface LookupCellEditorParams {
  connectionId: string;
  ref: { schema: string | null; table: string; column: string };
}

/** Popup picker for foreign-key cells: searches the referenced table and commits the chosen key. */
export function LookupCellEditor(props: CustomCellEditorProps & LookupCellEditorParams) {
  const { connectionId, ref, initialValue, onValueChange, stopEditing } = props;
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<LookupRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const result = await rpc("data.lookup", {
          connectionId,
          schema: ref.schema,
          table: ref.table,
          keyColumn: ref.column,
          query,
          limit: 50,
        });
        if (!cancelled) {
          setRows(result);
          setActive(0);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [connectionId, ref.schema, ref.table, ref.column, query]);

  const choose = (row: LookupRow) => {
    onValueChange(row.key);
    stopEditing();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[active];
      if (row) choose(row);
      else if (query.trim()) {
        onValueChange(query.trim());
        stopEditing();
      }
    } else if (e.key === "Escape") {
      stopEditing(true);
    }
  };

  return (
    <div className="flex w-96 flex-col rounded-md border bg-popover text-popover-foreground shadow-md">
      <div className="flex items-center gap-2 border-b px-2">
        <SearchIcon className="size-3.5 text-muted-foreground" />
        <input
          ref={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          placeholder={`Search ${ref.table}… (current: ${initialValue ?? "NULL"})`}
          className="h-8 min-w-0 flex-1 bg-transparent text-xs outline-none"
        />
        {loading && <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />}
      </div>
      <div className="max-h-64 overflow-auto p-1">
        {error && <div className="px-2 py-1 text-xs text-destructive">{error}</div>}
        {!error && rows.length === 0 && !loading && <div className="px-2 py-2 text-xs text-muted-foreground">No matches</div>}
        {rows.map((row, i) => (
          <button
            key={`${String(row.key)}-${i}`}
            type="button"
            className={cn(
              "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent",
              i === active && "bg-accent",
              String(row.key) === String(initialValue) && "font-semibold",
            )}
            onMouseEnter={() => setActive(i)}
            onClick={() => choose(row)}
          >
            <span dir="ltr" className="shrink-0 font-mono">
              {String(row.key)}
            </span>
            <bdi dir="auto" className="min-w-0 truncate text-left text-muted-foreground">
              {row.label}
            </bdi>
          </button>
        ))}
      </div>
      <div className="border-t px-2 py-1 text-[10px] text-muted-foreground">
        {ref.schema ? `${ref.schema}.` : ""}
        {ref.table}.{ref.column} · ↑↓ Enter to pick, Esc to cancel
      </div>
    </div>
  );
}
