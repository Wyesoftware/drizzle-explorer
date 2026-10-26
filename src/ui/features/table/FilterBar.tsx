import { useEffect, useState, type KeyboardEvent } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { FILTER_OPS, type FilterOp, type FilterSpec, type RowFilter } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/NativeSelect";

interface DraftFilter extends FilterSpec {
  key: number;
}

let nextKey = 1;

/** DBeaver-style filter row: ANDed column conditions plus an optional raw WHERE fragment. */
export function FilterBar({
  columns,
  value,
  onApply,
  onClear,
}: {
  columns: string[];
  value: RowFilter;
  onApply: (filter: RowFilter) => void;
  /** "Clear" also resets whatever else filters the rows (column filters in the grid). */
  onClear?: () => void;
}) {
  const [filters, setFilters] = useState<DraftFilter[]>(() => toDraft(value.filters));
  const [where, setWhere] = useState(value.where ?? "");

  useEffect(() => {
    setFilters(toDraft(value.filters));
    setWhere(value.where ?? "");
  }, [value]);

  const apply = () => {
    onApply({
      filters: filters
        .filter((f) => f.column && (needsValue(f.op) ? (f.value ?? "").length > 0 : true))
        .map(({ column, op, value }) => ({ column, op, value })),
      where: where.trim() || undefined,
    });
  };
  const clear = () => {
    setFilters([]);
    setWhere("");
    onApply({});
    onClear?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") apply();
  };
  const update = (key: number, patch: Partial<FilterSpec>) =>
    setFilters((list) => list.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  const add = () => setFilters((list) => [...list, { key: nextKey++, column: columns[0] ?? "", op: "eq", value: "" }]);

  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-b bg-muted/30 px-2 py-1.5">
      {filters.map((f) => (
        <div key={f.key} className="flex items-center gap-1.5">
          <NativeSelect value={f.column} onChange={(e) => update(f.key, { column: e.target.value })} className="w-48">
            {columns.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect value={f.op} onChange={(e) => update(f.key, { op: e.target.value as FilterOp })} className="w-36">
            {FILTER_OPS.map((o) => (
              <option key={o.op} value={o.op}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
          {needsValue(f.op) && (
            <Input
              value={f.value ?? ""}
              onChange={(e) => update(f.key, { value: e.target.value })}
              onKeyDown={onKey}
              placeholder={f.op === "in" ? "a, b, c" : "value"}
              className="h-7 max-w-md text-xs"
              autoFocus
            />
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Remove condition"
            onClick={() => setFilters((list) => list.filter((x) => x.key !== f.key))}
          >
            <XIcon />
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <Button variant="outline" size="xs" onClick={add}>
          <PlusIcon /> Condition
        </Button>
        <span className="ml-1 shrink-0 font-mono text-[11px] text-muted-foreground">WHERE</span>
        <Input
          value={where}
          onChange={(e) => setWhere(e.target.value)}
          onKeyDown={onKey}
          placeholder="raw SQL, e.g. created_at > now() - interval '7 days'"
          className="h-7 flex-1 font-mono text-xs"
        />
        <Button size="xs" onClick={apply}>
          Apply
        </Button>
        <Button variant="ghost" size="xs" onClick={clear}>
          Clear
        </Button>
      </div>
    </div>
  );
}

function needsValue(op: FilterOp): boolean {
  return FILTER_OPS.find((o) => o.op === op)?.needsValue ?? true;
}

function toDraft(filters: FilterSpec[] | undefined): DraftFilter[] {
  return (filters ?? []).map((f) => ({ ...f, key: nextKey++ }));
}

export function countActive(filter: RowFilter): number {
  return (filter.filters?.length ?? 0) + (filter.where ? 1 : 0);
}
