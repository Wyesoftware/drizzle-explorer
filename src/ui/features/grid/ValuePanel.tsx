import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { BanIcon, BracesIcon, CheckIcon, CopyIcon, PencilIcon, WrapTextIcon, XIcon } from "lucide-react";
import type { ResultColumn } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CodeView } from "@/components/CodeView";
import { EmptyState } from "@/components/EmptyState";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface SelectedCell {
  column: string;
  value: unknown;
  rowIndex: number;
  /** True for rows pinned on top (unsaved inserts in infinite-scroll mode); rowIndex then counts pinned rows. */
  pinned?: boolean;
}

function tryParseJson(text: string): unknown | undefined {
  const t = text.trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

/** Side panel showing the full value of the focused cell (JSON pretty-printed, long text wrapped). */
export function ValuePanel({
  cell,
  columns,
  onClose,
  onApply,
}: {
  cell: SelectedCell | null;
  columns: ResultColumn[];
  onClose: () => void;
  /** When provided the value can be edited here; receives the new text or null for NULL. */
  onApply?: (value: string | null) => void;
}) {
  const [wrap, setWrap] = useState(true);
  const [pretty, setPretty] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  // Leaving the cell cancels an unfinished edit.
  useEffect(() => {
    setEditing(false);
  }, [cell?.rowIndex, cell?.column]);

  const info = useMemo(() => {
    if (!cell) return null;
    const { value } = cell;
    if (value === null || value === undefined) return { text: "", isNull: true, json: undefined as unknown };
    if (typeof value === "object") return { text: JSON.stringify(value), isNull: false, json: value };
    const text = String(value);
    return { text, isNull: false, json: typeof value === "string" ? tryParseJson(text) : undefined };
  }, [cell]);

  const dataType = cell ? columns.find((c) => c.name === cell.column)?.dataType : null;
  const isJson = info?.json !== undefined;
  const shown = info ? (isJson && pretty ? JSON.stringify(info.json, null, 2) : info.text) : "";

  function startEdit() {
    setDraft(info?.isNull ? "" : (isJson && pretty ? JSON.stringify(info?.json, null, 2) : (info?.text ?? "")));
    setEditing(true);
  }

  function apply() {
    if (!onApply) return;
    let value: string = draft;
    if (isJson || dataType?.toLowerCase().includes("json")) {
      try {
        value = JSON.stringify(JSON.parse(draft));
      } catch (e) {
        toast.error("Invalid JSON", { description: e instanceof Error ? e.message : String(e) });
        return;
      }
    }
    onApply(value);
    setEditing(false);
  }

  async function copy() {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(shown);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Clipboard is not available");
    }
  }

  return (
    <aside className="flex h-full min-w-0 flex-col border-l bg-background">
      <header className="flex h-9 shrink-0 items-center gap-1 border-b px-2">
        {cell ? (
          <>
            <span className="truncate text-xs font-medium">{cell.column}</span>
            {dataType && (
              <Badge variant="outline" className="h-5 shrink-0 font-mono text-[10px]">
                {dataType}
              </Badge>
            )}
            <span className="ml-1 shrink-0 text-[11px] text-muted-foreground">
              {info?.isNull ? "NULL" : `${formatCount(info?.text.length ?? 0)} chars`}
            </span>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">Value viewer</span>
        )}
        <span className="ml-auto" />
        {onApply && cell && !editing && (
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-xs" aria-label="Edit value" />} onClick={startEdit}>
              <PencilIcon />
            </TooltipTrigger>
            <TooltipContent>Edit value</TooltipContent>
          </Tooltip>
        )}
        {onApply && cell && editing && (
          <>
            <Tooltip>
              <TooltipTrigger
                render={<Button variant="ghost" size="icon-xs" aria-label="Set NULL" />}
                onClick={() => {
                  onApply(null);
                  setEditing(false);
                }}
              >
                <BanIcon />
              </TooltipTrigger>
              <TooltipContent>Set NULL</TooltipContent>
            </Tooltip>
            <Button variant="ghost" size="xs" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="xs" onClick={apply} aria-label="Apply value">
              <CheckIcon /> Apply
            </Button>
          </>
        )}
        {!editing && isJson && (
          <Tooltip>
            <TooltipTrigger
              render={<Button variant={pretty ? "secondary" : "ghost"} size="icon-xs" aria-label="Pretty-print JSON" />}
              onClick={() => setPretty((v) => !v)}
            >
              <BracesIcon />
            </TooltipTrigger>
            <TooltipContent>Pretty-print JSON</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger
            render={<Button variant={wrap ? "secondary" : "ghost"} size="icon-xs" aria-label="Wrap lines" />}
            onClick={() => setWrap((v) => !v)}
          >
            <WrapTextIcon />
          </TooltipTrigger>
          <TooltipContent>Wrap lines</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={<Button variant="ghost" size="icon-xs" aria-label="Copy value" disabled={!info || info.isNull} />}
            onClick={copy}
          >
            <CopyIcon />
          </TooltipTrigger>
          <TooltipContent>Copy value</TooltipContent>
        </Tooltip>
        <Button variant="ghost" size="icon-xs" aria-label="Close value viewer" onClick={onClose}>
          <XIcon />
        </Button>
      </header>
      <div className={cn("min-h-0 flex-1", info?.isNull && !editing && "flex items-center justify-center")}>
        {editing ? (
          <CodeView value={draft} language={isJson || dataType?.toLowerCase().includes("json") ? "json" : "text"} wrap={wrap} onChange={setDraft} />
        ) : !cell ? (
          <EmptyState title="No cell selected" description="Click a cell in the grid to see its full value here." />
        ) : info?.isNull ? (
          <span className="text-sm text-muted-foreground italic">NULL</span>
        ) : (
          <CodeView value={shown} language={isJson && pretty ? "json" : "text"} wrap={wrap} />
        )}
      </div>
    </aside>
  );
}
