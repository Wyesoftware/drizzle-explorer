import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangleIcon, FolderOpenIcon, Loader2Icon } from "lucide-react";
import type { Dialect, DumpFormat, DumpMode } from "@shared/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NativeSelect } from "@/components/NativeSelect";
import { errorMessage, rpc } from "@/lib/rpc";
import { useConnections, useSchemas } from "@/lib/queries";
import { openDialog } from "@/lib/dialogs";

export function DumpDialog({
  open,
  onOpenChange,
  connectionId,
  dialect,
  schema,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  dialect: Dialect;
  schema?: string | null;
}) {
  const connections = useConnections();
  const connection = connections.data?.find((c) => c.id === connectionId);
  const isPg = dialect === "postgres";
  const schemas = useSchemas(connectionId, open && isPg);
  const tools = useQuery({ queryKey: ["tools"], queryFn: () => rpc("tools.detect", {}), enabled: open && isPg });

  const [scopeKind, setScopeKind] = useState<"database" | "schema">(schema ? "schema" : "database");
  const [schemaName, setSchemaName] = useState(schema ?? "");
  const [mode, setMode] = useState<DumpMode>("full");
  const [format, setFormat] = useState<DumpFormat>("sql");
  const [path, setPath] = useState("");
  const [noOwner, setNoOwner] = useState(true);
  const [noPrivileges, setNoPrivileges] = useState(true);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!schemaName && schemas.data?.length) setSchemaName(schemas.data.find((s) => !s.isSystem)?.name ?? schemas.data[0]!.name);
  }, [schemas.data, schemaName]);

  const ext = format === "custom" ? "dump" : "sql";
  const defaultName = `${connection?.name ?? "database"}${scopeKind === "schema" ? `-${schemaName}` : ""}-${new Date().toISOString().slice(0, 10)}.${ext}`;
  const toolMissing = isPg && tools.data && !tools.data.pg_dump;

  async function choose() {
    const { path: picked } = await rpc("system.pickFile", { title: `Save ${defaultName}`, save: true });
    if (picked) setPath(/\.[a-z0-9]+$/i.test(picked) ? picked : `${picked}.${ext}`);
  }

  async function start() {
    setRunning(true);
    try {
      const { jobId } = await rpc("dump.start", {
        connectionId,
        scope: scopeKind === "schema" ? { kind: "schema", schema: schemaName } : { kind: "database" },
        mode,
        format,
        path: path.trim(),
        noOwner,
        noPrivileges,
      });
      openDialog({ kind: "job", jobId });
    } catch (error) {
      toast.error("Could not start dump", { description: errorMessage(error) });
      setRunning(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Dump {connection?.name ?? "database"}</DialogTitle>
          <DialogDescription>
            {isPg ? "Runs pg_dump with the connection's credentials." : "Writes a SQL script (schema and INSERT statements)."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {toolMissing && (
            <Alert variant="destructive">
              <AlertTriangleIcon />
              <AlertTitle>pg_dump not found</AlertTitle>
              <AlertDescription>
                Install the PostgreSQL client tools (macOS: <code>brew install libpq</code>) or set{" "}
                <code>DRIZZLE_EXPLORER_PG_BIN</code> to their directory.
              </AlertDescription>
            </Alert>
          )}
          {isPg && (
            <div className="grid grid-cols-[auto_1fr] items-center gap-3">
              <Tabs value={scopeKind} onValueChange={(v) => setScopeKind(v as "database" | "schema")}>
                <TabsList>
                  <TabsTrigger value="database">Whole database</TabsTrigger>
                  <TabsTrigger value="schema">One schema</TabsTrigger>
                </TabsList>
              </Tabs>
              {scopeKind === "schema" ? (
                <NativeSelect value={schemaName} onChange={(e) => setSchemaName(e.target.value)} disabled={!schemas.data}>
                  {schemas.data?.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
              ) : (
                <span />
              )}
            </div>
          )}
          <div className="grid gap-1.5">
            <Label>Content</Label>
            <Tabs value={mode} onValueChange={(v) => setMode(v as DumpMode)}>
              <TabsList className="w-full">
                <TabsTrigger value="full" className="flex-1">
                  Schema + data
                </TabsTrigger>
                <TabsTrigger value="schema-only" className="flex-1">
                  Schema only
                </TabsTrigger>
                <TabsTrigger value="data-only" className="flex-1">
                  Data only
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          {isPg && (
            <div className="grid gap-1.5">
              <Label>Format</Label>
              <Tabs value={format} onValueChange={(v) => setFormat(v as DumpFormat)}>
                <TabsList className="w-full">
                  <TabsTrigger value="sql" className="flex-1">
                    Plain SQL (.sql)
                  </TabsTrigger>
                  <TabsTrigger value="custom" className="flex-1">
                    Custom archive (.dump, pg_restore)
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label>Destination file</Label>
            <div className="flex gap-2">
              <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder={`/path/to/${defaultName}`} className="font-mono text-xs" />
              <Button variant="outline" onClick={choose}>
                <FolderOpenIcon /> Choose…
              </Button>
            </div>
          </div>
          {isPg && (
            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={noOwner} onCheckedChange={(v) => setNoOwner(Boolean(v))} /> No owner
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={noPrivileges} onCheckedChange={(v) => setNoPrivileges(Boolean(v))} /> No privileges
              </label>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={start} disabled={!path.trim() || running || Boolean(toolMissing) || (scopeKind === "schema" && !schemaName)}>
            {running && <Loader2Icon className="animate-spin" />}
            Start dump
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
