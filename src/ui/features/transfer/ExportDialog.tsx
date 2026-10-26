import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FolderOpenIcon, Loader2Icon } from "lucide-react";
import type { ExportFormat, ExportSource } from "@shared/types";
import { Button } from "@/components/ui/button";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { errorMessage, rpc } from "@/lib/rpc";
import { formatCount, formatDuration } from "@/lib/format";
import { useTableDetails } from "@/lib/queries";
import { defaultExportColumns, ExportColumnsTable, toExportColumns, type ExportColumnDraft } from "./ExportColumnsTable";

const FORMATS: { value: ExportFormat; label: string; ext: string }[] = [
  { value: "csv", label: "CSV", ext: "csv" },
  { value: "json", label: "JSON", ext: "json" },
  { value: "xlsx", label: "Excel (xlsx)", ext: "xlsx" },
];

export function ExportDialog({
  open,
  onOpenChange,
  source,
  defaultName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: ExportSource;
  defaultName: string;
}) {
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [path, setPath] = useState("");
  const [limit, setLimit] = useState("");
  const [running, setRunning] = useState(false);
  const [columns, setColumns] = useState<ExportColumnDraft[]>([]);
  const isTable = source.kind === "table";
  const details = useTableDetails(
    source.connectionId,
    isTable ? source.schema : null,
    isTable ? source.table : "__none__",
  );
  const tableColumns = useMemo(() => (isTable ? (details.data?.columns.map((c) => c.name) ?? []) : []), [isTable, details.data]);

  useEffect(() => {
    if (open) {
      setPath("");
      setLimit("");
    }
  }, [open]);
  useEffect(() => {
    if (open) setColumns(defaultExportColumns(tableColumns));
  }, [open, tableColumns]);

  const ext = FORMATS.find((f) => f.value === format)!.ext;

  async function choose() {
    const { path: picked } = await rpc("system.pickFile", { title: `Save ${defaultName}.${ext}`, save: true });
    if (picked) setPath(/\.[a-z0-9]+$/i.test(picked) ? picked : `${picked}.${ext}`);
  }

  async function run() {
    setRunning(true);
    try {
      const src: ExportSource =
        source.kind === "table" && limit.trim() ? { ...source, limit: Number(limit) || undefined } : source;
      const result = await rpc("data.export", {
        source: src,
        format,
        path: path.trim(),
        columns: isTable ? toExportColumns(columns, tableColumns) : undefined,
      });
      toast.success(`Exported ${formatCount(result.rows)} rows`, {
        description: `${result.path} · ${formatCount(result.bytes)} bytes · ${formatDuration(result.durationMs)}`,
      });
      onOpenChange(false);
    } catch (error) {
      toast.error("Export failed", { description: errorMessage(error) });
    } finally {
      setRunning(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Export {source.kind === "table" ? source.table : "query results"}</DialogTitle>
          <DialogDescription>
            {source.kind === "table"
              ? "All rows matching the current filter and sort order are exported."
              : "The query is re-executed and every returned row is written to the file."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Tabs value={format} onValueChange={(v) => setFormat(v as ExportFormat)}>
            <TabsList className="w-full">
              {FORMATS.map((f) => (
                <TabsTrigger key={f.value} value={f.value} className="flex-1">
                  {f.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="grid gap-1.5">
            <Label>Destination file</Label>
            <div className="flex gap-2">
              <Input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder={`/path/to/${defaultName}.${ext}`}
                className="font-mono text-xs"
              />
              <Button variant="outline" onClick={choose}>
                <FolderOpenIcon /> Choose…
              </Button>
            </div>
          </div>
          {isTable && tableColumns.length > 0 && (
            <div className="grid gap-1.5">
              <Label>Columns</Label>
              <ExportColumnsTable tableColumns={tableColumns} value={columns} onChange={setColumns} />
            </div>
          )}
          {source.kind === "table" && (
            <div className="grid gap-1.5">
              <Label>Row limit (optional)</Label>
              <Input
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                inputMode="numeric"
                placeholder="all rows"
                className="w-40"
              />
            </div>
          )}
          {format === "xlsx" && (
            <p className="text-xs text-muted-foreground">Excel export is built in memory; prefer CSV for very large tables.</p>
          )}
        </div>
        <DialogFooter>
          <Button onClick={run} disabled={!path.trim() || running || (isTable && !columns.some((c) => c.include))}>
            {running && <Loader2Icon className="animate-spin" />}
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
