import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGridFilter, type CustomFilterProps } from "ag-grid-react";
import { Loader2Icon, SearchIcon } from "lucide-react";
import type { FilterOp, ResultRow } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/NativeSelect";
import { errorMessage, rpc } from "@/lib/rpc";
import {
  dateInputType,
  normalizeDateValue,
  opLabel,
  opNeedsValue,
  OPS_BY_TYPE,
  toInputDateValue,
  type ColumnFilterModel,
  type ColumnFilterSpec,
  type SetValuesSource,
} from "./model";

export interface ColumnFilterParams {
  spec: ColumnFilterSpec;
}

const SET_LIMIT = 200;

/**
 * Filter popup for table columns. Never filters client-side: the model is turned into server
 * conditions by `TableTab` (`doesFilterPass` always passes), so it works for pages and infinite scroll alike.
 */
export function ColumnFilter(props: CustomFilterProps<ResultRow, unknown, ColumnFilterModel> & ColumnFilterParams) {
  useGridFilter({ doesFilterPass: () => true });
  const { spec, model, onModelChange } = props;
  if (spec.type === "set") return <SetFilterBody source={spec.source} model={model} onModelChange={onModelChange} />;
  return <ConditionFilterBody spec={spec} model={model} onModelChange={onModelChange} />;
}

function ConditionFilterBody({
  spec,
  model,
  onModelChange,
}: {
  spec: Exclude<ColumnFilterSpec, { type: "set" }>;
  model: ColumnFilterModel | null;
  onModelChange: (model: ColumnFilterModel | null) => void;
}) {
  const ops = OPS_BY_TYPE[spec.type];
  const [op, setOp] = useState<FilterOp>(model?.op ?? ops[0]!);
  const [value, setValue] = useState(model?.value ?? "");
  useEffect(() => {
    setOp(model?.op ?? ops[0]!);
    setValue(model?.value ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  const apply = () => {
    if (!opNeedsValue(op)) onModelChange({ op });
    else if (value.trim()) onModelChange({ op, value: spec.type === "date" ? normalizeDateValue(value.trim()) : value.trim() });
    else onModelChange(null);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") apply();
  };
  const inputType = spec.type === "date" && op !== "in" ? dateInputType(spec.mode) : "text";

  return (
    <div className="grid w-60 gap-2 p-2">
      <NativeSelect value={op} onChange={(e) => setOp(e.target.value as FilterOp)} aria-label="Operator">
        {ops.map((o) => (
          <option key={o} value={o}>
            {opLabel(o)}
          </option>
        ))}
      </NativeSelect>
      {opNeedsValue(op) && (
        <Input
          type={inputType}
          inputMode={spec.type === "number" && op !== "in" ? "decimal" : undefined}
          value={inputType === "text" ? value : toInputDateValue(value)}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKey}
          placeholder={op === "in" ? "a, b, c" : "value"}
          className="h-7 text-xs"
          autoFocus
        />
      )}
      <div className="flex justify-end gap-1">
        <Button variant="ghost" size="xs" onClick={() => onModelChange(null)} disabled={!model}>
          Clear
        </Button>
        <Button size="xs" onClick={apply}>
          Apply
        </Button>
      </div>
    </div>
  );
}

function SetFilterBody({
  source,
  model,
  onModelChange,
}: {
  source: SetValuesSource;
  model: ColumnFilterModel | null;
  onModelChange: (model: ColumnFilterModel | null) => void;
}) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 200);
    return () => clearTimeout(t);
  }, [search]);
  const query = useQuery({
    queryKey: ["distinct", source, debounced],
    queryFn: () => rpc("data.distinct", { ...source, search: debounced, limit: SET_LIMIT }),
    placeholderData: (prev) => prev,
    retry: false,
  });
  const selected = useMemo(() => new Set(model?.values ?? []), [model]);
  const nullOn = Boolean(model?.orNull);
  const loaded = useMemo(() => (query.data?.values ?? []).map((v) => ({ key: String(v.value), label: v.label })), [query.data]);
  const loadedLabels = useMemo(() => new Map(loaded.filter((v) => v.label).map((v) => [v.key, v.label!])), [loaded]);

  const commit = (values: Set<string>, orNull: boolean) => {
    if (values.size === 0 && !orNull) return onModelChange(null);
    // Labels ride along in the model (UI only) so the floating summary can show them without another fetch.
    const labels: Record<string, string> = {};
    for (const v of values) {
      const label = loadedLabels.get(v) ?? model?.labels?.[v];
      if (label) labels[v] = label;
    }
    onModelChange({ op: "in", values: [...values], ...(orNull ? { orNull: true } : {}), ...(Object.keys(labels).length ? { labels } : {}) });
  };
  const toggle = (v: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(v);
    else next.delete(v);
    commit(next, nullOn);
  };
  const allLoadedOn = loaded.length > 0 && loaded.every((v) => selected.has(v.key));

  return (
    <div className="grid w-64 gap-1.5 p-2">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={source.ref ? "Search values or labels…" : "Search values…"}
          className="h-7 pl-7 text-xs"
          autoFocus
        />
      </div>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <button
          type="button"
          className="hover:text-foreground"
          onClick={() => {
            const next = new Set(selected);
            for (const v of loaded) if (allLoadedOn) next.delete(v.key);
            else next.add(v.key);
            commit(next, nullOn);
          }}
          disabled={loaded.length === 0}
        >
          {allLoadedOn ? "Deselect shown" : "Select shown"}
        </button>
        <button type="button" className="hover:text-foreground" onClick={() => onModelChange(null)} disabled={!model}>
          Clear
        </button>
      </div>
      <div className="max-h-64 overflow-auto rounded border">
        {query.error ? (
          <div className="px-2 py-1.5 text-xs text-destructive">{errorMessage(query.error)}</div>
        ) : query.isPending ? (
          <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground">
            <Loader2Icon className="size-3.5 animate-spin" /> Loading…
          </div>
        ) : (
          <ul className="py-0.5">
            {query.data?.hasNull && !debounced && (
              <li>
                <label className="flex cursor-pointer items-center gap-2 px-2 py-0.5 text-xs italic hover:bg-muted">
                  <Checkbox checked={nullOn} onCheckedChange={(v) => commit(selected, Boolean(v))} />
                  (NULL)
                </label>
              </li>
            )}
            {loaded.map((v) => (
              <li key={v.key}>
                <label className="flex cursor-pointer items-center gap-2 px-2 py-0.5 text-xs hover:bg-muted">
                  <Checkbox checked={selected.has(v.key)} onCheckedChange={(on) => toggle(v.key, Boolean(on))} />
                  {v.label ? (
                    // Label and key are separate bidi isolates: a Hebrew/Arabic label must not get
                    // reordered around the id by the bidi algorithm.
                    <span className="flex min-w-0 flex-1 items-center gap-2" title={`${v.key} · ${v.label}`}>
                      <bdi dir="auto" className="min-w-0 flex-1 truncate text-left">
                        {v.label}
                      </bdi>
                      <span dir="ltr" className="max-w-[45%] shrink-0 truncate font-mono text-muted-foreground">
                        {v.key}
                      </span>
                    </span>
                  ) : (
                    <span dir="ltr" className="min-w-0 truncate" title={v.key}>
                      {v.key}
                    </span>
                  )}
                </label>
              </li>
            ))}
            {loaded.length === 0 && !query.data?.hasNull && <li className="px-2 py-1.5 text-xs text-muted-foreground">No values</li>}
          </ul>
        )}
      </div>
      {query.data?.hasMore && (
        <div className="text-[11px] text-muted-foreground">Showing the first {SET_LIMIT} values; search to narrow the list.</div>
      )}
      {selected.size > 0 && (
        <div className="text-[11px] text-muted-foreground">
          {selected.size} selected{nullOn ? " + NULL" : ""}
        </div>
      )}
    </div>
  );
}
