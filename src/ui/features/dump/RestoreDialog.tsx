import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangleIcon, FolderOpenIcon, Loader2Icon } from "lucide-react";
import type { Dialect } from "@shared/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage, rpc } from "@/lib/rpc";
import { useConnections } from "@/lib/queries";
import { openDialog } from "@/lib/dialogs";

export function RestoreDialog({
  open,
  onOpenChange,
  connectionId,
  dialect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  dialect: Dialect;
}) {
  const connections = useConnections();
  const connection = connections.data?.find((c) => c.id === connectionId);
  const isPg = dialect === "postgres";
  const tools = useQuery({ queryKey: ["tools"], queryFn: () => rpc("tools.detect", {}), enabled: open && isPg });
  const [path, setPath] = useState("");
  const [clean, setClean] = useState(false);
  const [stopOnError, setStopOnError] = useState(false);
  const [running, setRunning] = useState(false);

  const isArchive = /\.(dump|backup|pgdump|custom)$/i.test(path);
  const toolMissing = isPg && tools.data && (isArchive ? !tools.data.pg_restore : !tools.data.psql);

  async function choose() {
    const { path: picked } = await rpc("system.pickFile", { title: "Choose a .sql script or pg_dump archive" });
    if (picked) setPath(picked);
  }

  async function start() {
    setRunning(true);
    try {
      const { jobId } = await rpc("restore.start", { connectionId, path: path.trim(), clean, stopOnError });
      openDialog({ kind: "job", jobId });
    } catch (error) {
      toast.error("Could not start restore", { description: errorMessage(error) });
      setRunning(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Restore into {connection?.name ?? "database"}</DialogTitle>
          <DialogDescription>
            {isPg
              ? "Plain .sql scripts run through psql; pg_dump custom archives run through pg_restore."
              : "Executes a SQL script statement by statement against this database."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Alert>
            <AlertTriangleIcon />
            <AlertTitle>This modifies the target database</AlertTitle>
            <AlertDescription>Objects and rows from the file are created in {connection?.name}. Make sure it is the right target.</AlertDescription>
          </Alert>
          {toolMissing && (
            <Alert variant="destructive">
              <AlertTriangleIcon />
              <AlertTitle>{isArchive ? "pg_restore" : "psql"} not found</AlertTitle>
              <AlertDescription>
                Install the PostgreSQL client tools (macOS: <code>brew install libpq</code>) or set <code>DRIZZLE_EXPLORER_PG_BIN</code>.
              </AlertDescription>
            </Alert>
          )}
          <div className="grid gap-1.5">
            <Label>Source file</Label>
            <div className="flex gap-2">
              <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/path/to/backup.sql" className="font-mono text-xs" />
              <Button variant="outline" onClick={choose}>
                <FolderOpenIcon /> Choose…
              </Button>
            </div>
          </div>
          <div className="grid gap-2">
            {isPg && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={clean} onCheckedChange={(v) => setClean(Boolean(v))} disabled={!isArchive} />
                Drop existing objects first (custom archives only: --clean --if-exists)
              </label>
            )}
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={stopOnError} onCheckedChange={(v) => setStopOnError(Boolean(v))} />
              Stop at the first error
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={start} disabled={!path.trim() || running || Boolean(toolMissing)} variant="destructive">
            {running && <Loader2Icon className="animate-spin" />}
            Start restore
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
