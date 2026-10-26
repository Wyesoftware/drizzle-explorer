import { useEffect, useRef, useState } from "react";
import type { CustomCellEditorProps } from "ag-grid-react";
import { BanIcon, ClockIcon } from "lucide-react";
import {
  fromWallInput,
  parseDateValue,
  resolveTimeZone,
  toWallInput,
  type DateEditMode,
} from "@/lib/format-value";

export interface DateCellEditorParams {
  mode: DateEditMode;
  /** True for timestamptz-like columns: the value is an instant and is converted through `timeZone`. */
  withZone: boolean;
  /** Zone the picker works in ("utc", "local" or IANA). */
  timeZone: string;
}

/** Native date / datetime / time picker. Commits ISO (zoned columns) or plain wall-clock text. */
export function DateCellEditor(props: CustomCellEditorProps & DateCellEditorParams) {
  const { mode, withZone, timeZone, initialValue, onValueChange } = props;
  const zone = resolveTimeZone(timeZone);
  const input = useRef<HTMLInputElement>(null);

  const initialText = (() => {
    if (initialValue === null || initialValue === undefined || initialValue === "") return "";
    if (mode === "time" && typeof initialValue === "string") return initialValue.slice(0, 8);
    const d = parseDateValue(initialValue, "auto");
    return d ? toWallInput(d, withZone ? zone : "UTC", mode) : String(initialValue);
  })();
  const [text, setText] = useState(initialText);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const commit = (next: string) => {
    setText(next);
    if (!next) {
      onValueChange(null);
      return;
    }
    if (mode === "time") {
      onValueChange(next.length === 5 ? `${next}:00` : next);
      return;
    }
    if (mode === "date") {
      onValueChange(next);
      return;
    }
    if (withZone) {
      const d = fromWallInput(next, zone);
      onValueChange(d ? d.toISOString() : next);
    } else {
      onValueChange(next.replace("T", " ") + (next.length === 16 ? ":00" : ""));
    }
  };

  const now = () => {
    const d = new Date();
    commit(toWallInput(d, withZone ? zone : "UTC", mode));
  };

  return (
    <div className="flex h-full items-center gap-1 bg-background px-1">
      <input
        ref={input}
        type={mode === "datetime" ? "datetime-local" : mode}
        step="1"
        value={text}
        onChange={(e) => commit(e.target.value)}
        className="h-6 min-w-0 flex-1 rounded border border-input bg-transparent px-1 text-xs outline-none focus:border-ring"
      />
      {mode !== "date" && (
        <span className="shrink-0 text-[10px] text-muted-foreground" title={withZone ? `Entered in ${zone}, stored as UTC` : "Stored as entered"}>
          {withZone ? zone : "naive"}
        </span>
      )}
      <button type="button" className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground" title="Now" onClick={now}>
        <ClockIcon className="size-3.5" />
      </button>
      <button type="button" className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground" title="NULL" onClick={() => commit("")}>
        <BanIcon className="size-3.5" />
      </button>
    </div>
  );
}
