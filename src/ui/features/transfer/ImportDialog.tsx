import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FolderOpenIcon, Loader2Icon } from "lucide-react";
import type { ImportInspectResult } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage, rpc } from "@/lib/rpc";
import { useTableDetails } from "@/lib/queries";
import { formatCount, formatDuration } from "@/lib/format";
import type { ConflictMode } from "@shared/types";
import { autoMap, ConflictModeField, MappingTable, toMappingList, type Mapping } from "./MappingTable";

export function ImportDialog({
  open,
  onOpenChange,
  connectionId,
  schema,
  table,
  targetColumns: targetColumnsProp,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  schema: string | null;
  table: string;
  /** Optional; fetched from the table when omitted. */
  targetColumns?: string[];
  onImported: () => void;
}) {
  const details = useTableDetails(connectionId, schema, table);
  const targetColumns = targetColumnsProp ?? details.data?.columns.map((c) => c.name) ?? [];
  const [path, setPath] = useState("");
  const [inspecting, setInspecting] = useState(false);
  const [inspected, setInspected] = useState<ImportInspectResult | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [emptyAsNull, setEmptyAsNull] = useState(true);
  const [onConflict, setOnConflict] = useState<ConflictMode>("error");
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (open) {
      setPath("");
      setInspected(null);
      setMapping({});
    }
  }, [open]);

  async function choose() {
    const { path: picked } = await rpc("system.pickFile", { title: "Choose CSV, JSON or XLSX file" });
    if (picked) {
      setPath(picked);
      await inspect(picked);
    }
  }

  async function inspect(p = path) {
    if (!p.trim()) return;
    setInspecting(true);
    try {
      const result = await rpc("import.inspect", { path: p.trim() });
      setInspected(result);
      setMapping(autoMap(result.columns, targetColumns));
    } catch (error) {
      setInspected(null);
      toast.error("Could not read file", { description: errorMessage(error) });
    } finally {
      setInspecting(false);
    }
  }

  async function run() {
    if (!inspected) return;
    setRunning(true);
    try {
      const result = await rpc("import.run", {
        connectionId,
        schema,
        table,
        path: path.trim(),
        format: inspected.format,
        mapping: toMappingList(mapping),
        emptyAsNull,
        onConflict,
      });
      toast.success(`Imported ${formatCount(result.inserted)} rows into ${table}`, {
        description: formatDuration(result.durationMs),
      });
      onImported();
      onOpenChange(false);
    } catch (error) {
      toast.error("Import failed", { description: errorMessage(error) });
    } finally {
      setRunning(false);
    }
  }

  const mapped = toMappingList(mapping).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import into {table}</DialogTitle>
          <DialogDescription>Columns are matched by name; each target column can also take a SQL expression.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>Source file</Label>
            <div className="flex gap-2">
              <Input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                onBlur={() => !inspected && inspect()}
                onKeyDown={(e) => e.key === "Enter" && inspect()}
                placeholder="/path/to/data.csv"
                className="font-mono text-xs"
              />
              <Button variant="outline" onClick={choose} disabled={inspecting}>
                {inspecting ? <Loader2Icon className="animate-spin" /> : <FolderOpenIcon />} Choose…
              </Button>
            </div>
          </div>
          {inspected && (
            <>
              <div className="text-xs text-muted-foreground">
                {inspected.format.toUpperCase()} · {formatCount(inspected.rowCount)} rows · {inspected.columns.length} columns
              </div>
              <MappingTable
                sourceColumns={inspected.columns}
                targetColumns={targetColumns}
                mapping={mapping}
                onChange={setMapping}
                sourceLabel="File column"
              />
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={emptyAsNull} onCheckedChange={(v) => setEmptyAsNull(Boolean(v))} />
                Treat empty strings as NULL
              </label>
              <ConflictModeField value={onConflict} onChange={setOnConflict} />
            </>
          )}
        </div>
        <DialogFooter>
          <Button onClick={run} disabled={!inspected || mapped === 0 || running}>
            {running && <Loader2Icon className="animate-spin" />}
            Import {inspected ? formatCount(inspected.rowCount) : ""} rows
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
