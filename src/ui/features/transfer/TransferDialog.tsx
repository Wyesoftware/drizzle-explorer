import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2Icon } from "lucide-react";
import type { ExportSource } from "@shared/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/NativeSelect";
import { errorMessage, rpc } from "@/lib/rpc";
import { useConnections, useSchemas, useTableDetails, useTables } from "@/lib/queries";
import { formatCount, formatDuration } from "@/lib/format";
import type { ConflictMode } from "@shared/types";
import { autoMap, ConflictModeField, MappingTable, toMappingList, type Mapping } from "./MappingTable";

/** Copy rows from a table/query into another table, possibly on another connection. */
export function TransferDialog({
  open,
  onOpenChange,
  source,
  sourceColumns: sourceColumnsProp,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: ExportSource;
  /** Optional; fetched from the source table when omitted. */
  sourceColumns?: string[];
  onDone?: () => void;
}) {
  const connections = useConnections();
  const sourceDetails = useTableDetails(
    source.connectionId,
    source.kind === "table" ? source.schema : null,
    source.kind === "table" && !sourceColumnsProp ? source.table : "__none__",
  );
  const sourceColumns = useMemo(
    () => sourceColumnsProp ?? sourceDetails.data?.columns.map((c) => c.name) ?? [],
    [sourceColumnsProp, sourceDetails.data],
  );
  const [connectionId, setConnectionId] = useState(source.connectionId);
  const [schema, setSchema] = useState<string>("");
  const [table, setTable] = useState<string>("");
  const [mapping, setMapping] = useState<Mapping>({});
  const [running, setRunning] = useState(false);
  const [onConflict, setOnConflict] = useState<ConflictMode>("error");

  const schemas = useSchemas(connectionId, open && Boolean(connectionId));
  const tables = useTables(connectionId, schema || null, open && Boolean(schema));
  const details = useTableDetails(connectionId, schema || null, table || "__none__");
  const targetColumns = useMemo(
    () => (table ? (details.data?.columns.map((c) => c.name) ?? []) : []),
    [details.data, table],
  );

  useEffect(() => {
    if (open) {
      setConnectionId(source.connectionId);
      setSchema("");
      setTable("");
      setMapping({});
    }
  }, [open, source.connectionId]);

  useEffect(() => {
    if (!schema && schemas.data?.length) {
      const preferred = schemas.data.find((s) => !s.isSystem) ?? schemas.data[0]!;
      setSchema(preferred.name);
    }
  }, [schemas.data, schema]);

  useEffect(() => {
    if (table && targetColumns.length) setMapping(autoMap(sourceColumns, targetColumns));
  }, [table, targetColumns, sourceColumns]);

  async function run() {
    setRunning(true);
    try {
      const result = await rpc("data.transfer", {
        source,
        target: { connectionId, schema: schema || null, table },
        mapping: toMappingList(mapping),
        onConflict,
      });
      toast.success(`Copied ${formatCount(result.copied)} rows into ${table}`, {
        description: formatDuration(result.durationMs),
      });
      onDone?.();
      onOpenChange(false);
    } catch (error) {
      toast.error("Transfer failed", { description: errorMessage(error) });
    } finally {
      setRunning(false);
    }
  }

  const sameTable =
    source.kind === "table" &&
    source.connectionId === connectionId &&
    (source.schema ?? "") === schema &&
    source.table === table;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Copy rows to another table</DialogTitle>
          <DialogDescription>
            {source.kind === "table"
              ? `Source: ${source.schema ? `${source.schema}.` : ""}${source.table} (current filter and sort).`
              : "Source: the current query results."}{" "}
            Rows are appended to the target with INSERT.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label>Connection</Label>
              <NativeSelect
                value={connectionId}
                onChange={(e) => {
                  setConnectionId(e.target.value);
                  setSchema("");
                  setTable("");
                }}
              >
                {connections.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <Label>Schema</Label>
              <NativeSelect
                value={schema}
                onChange={(e) => {
                  setSchema(e.target.value);
                  setTable("");
                }}
                disabled={!schemas.data}
              >
                {schemas.data?.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <Label>Table</Label>
              <NativeSelect value={table} onChange={(e) => setTable(e.target.value)} disabled={!tables.data}>
                <option value="">— choose —</option>
                {tables.data
                  ?.filter((t) => t.kind === "table")
                  .map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name}
                    </option>
                  ))}
              </NativeSelect>
            </div>
          </div>
          {schemas.error && <p className="text-xs text-destructive">{errorMessage(schemas.error)}</p>}
          {table && targetColumns.length > 0 && (
            <>
              <MappingTable
                sourceColumns={sourceColumns}
                targetColumns={targetColumns}
                mapping={mapping}
                onChange={setMapping}
                sourceLabel="Source column"
              />
              <ConflictModeField value={onConflict} onChange={setOnConflict} />
            </>
          )}
          {sameTable && <p className="text-xs text-amber-600">Target is the source table: rows will be duplicated.</p>}
        </div>
        <DialogFooter>
          <Button onClick={run} disabled={!table || toMappingList(mapping).length === 0 || running}>
            {running && <Loader2Icon className="animate-spin" />}
            Copy rows
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
