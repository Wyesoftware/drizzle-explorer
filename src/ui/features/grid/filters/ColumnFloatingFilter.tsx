import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { CustomFloatingFilterProps } from "ag-grid-react";
import { ChevronDownIcon } from "lucide-react";
import type { FilterOp, ResultRow } from "@shared/types";
import { cn } from "@/lib/utils";
import {
  dateInputType,
  describeModel,
  FLOATING_OPS,
  normalizeDateValue,
  opLabel,
  opNeedsValue,
  opSymbol,
  toInputDateValue,
  type ColumnFilterModel,
  type ColumnFilterSpec,
} from "./model";
import type { ColumnFilterParams } from "./ColumnFilter";

const DEBOUNCE_MS = 350;

const inputClass =
  "h-6 min-w-0 flex-1 rounded border bg-background px-1.5 text-xs outline-none placeholder:text-muted-foreground/70 focus:border-ring";

/** Row of quick filters under the header: text box, operator + value, date picker, or a set-filter summary. */
export function ColumnFloatingFilter(props: CustomFloatingFilterProps<unknown, ResultRow, unknown, ColumnFilterModel> & ColumnFilterParams) {
  const { spec, model, onModelChange, api, column } = props;
  if (spec.type === "set") {
    const text = describeModel(model);
    return (
      <button
        type="button"
        className={cn(
          "flex h-6 w-full min-w-0 items-center gap-1 rounded border bg-background px-1.5 text-left text-xs",
          text ? "text-foreground" : "text-muted-foreground/70",
        )}
        onClick={() => api.showColumnFilter(column)}
        title={text || "Choose values"}
      >
        <bdi dir="auto" className="min-w-0 flex-1 truncate text-left">
          {text || "All"}
        </bdi>
        <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
      </button>
    );
  }
  return <ConditionFloatingFilter spec={spec} model={model} onModelChange={onModelChange} />;
}

function ConditionFloatingFilter({
  spec,
  model,
  onModelChange,
}: {
  spec: Exclude<ColumnFilterSpec, { type: "set" }>;
  model: ColumnFilterModel | null;
  onModelChange: (model: ColumnFilterModel | null) => void;
}) {
  const defaultOp: FilterOp = spec.type === "text" ? "contains" : "eq";
  const [op, setOp] = useState<FilterOp>(model?.op ?? defaultOp);
  const [value, setValue] = useState(model?.value ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep in sync with changes made in the popup (or a programmatic reset).
  useEffect(() => {
    setOp(model?.op ?? defaultOp);
    setValue(model?.value ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  const emit = (nextOp: FilterOp, nextValue: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!opNeedsValue(nextOp)) onModelChange({ op: nextOp });
    else if (nextValue.trim()) onModelChange({ op: nextOp, value: spec.type === "date" ? normalizeDateValue(nextValue.trim()) : nextValue.trim() });
    else onModelChange(null);
  };
  const schedule = (nextOp: FilterOp, nextValue: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => emit(nextOp, nextValue), DEBOUNCE_MS);
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") emit(op, value);
    if (e.key === "Escape") {
      setValue("");
      emit(op, "");
    }
  };
  const isDate = spec.type === "date" && op !== "in";
  const showOps = spec.type !== "text";

  return (
    <div className="flex h-full w-full min-w-0 items-center gap-0.5">
      {showOps && (
        <select
          value={FLOATING_OPS.includes(op) ? op : "custom"}
          onChange={(e) => {
            const next = e.target.value as FilterOp;
            setOp(next);
            // Null checks apply right away; value operators wait for input unless there is one already.
            if (!opNeedsValue(next) || value.trim()) emit(next, value);
          }}
          className="h-6 w-9 shrink-0 appearance-none rounded border bg-background px-1 text-center text-xs text-muted-foreground"
          aria-label="Operator"
          title={opLabel(op)}
        >
          {FLOATING_OPS.map((o) => (
            <option key={o} value={o}>
              {opSymbol(o)}
            </option>
          ))}
          {!FLOATING_OPS.includes(op) && <option value="custom">{opLabel(op)}</option>}
        </select>
      )}
      {opNeedsValue(op) ? (
        <input
          type={isDate ? dateInputType(spec.mode) : "text"}
          inputMode={spec.type === "number" && op !== "in" ? "decimal" : undefined}
          value={isDate ? toInputDateValue(value) : value}
          onChange={(e) => {
            setValue(e.target.value);
            // Native pickers commit on change; typed text waits for a pause or Enter.
            if (isDate) emit(op, e.target.value);
            else schedule(op, e.target.value);
          }}
          onKeyDown={onKey}
          placeholder={spec.type === "text" && op !== "contains" ? `${opLabel(op)}…` : "Filter…"}
          className={inputClass}
          aria-label="Filter value"
        />
      ) : (
        <span className="flex h-6 min-w-0 flex-1 items-center truncate rounded border bg-muted/40 px-1.5 text-xs text-muted-foreground">
          {opLabel(op)}
        </span>
      )}
    </div>
  );
}
