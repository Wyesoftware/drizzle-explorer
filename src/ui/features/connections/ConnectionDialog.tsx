import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FolderOpenIcon, Loader2Icon } from "lucide-react";
import type { ConnectionConfig, Dialect, PostgresConnectionConfig, SqliteConnectionConfig } from "@shared/types";
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { errorMessage, rpc } from "@/lib/rpc";
import { useSaveConnection } from "@/lib/queries";

type Draft = {
  id: string;
  name: string;
  dialect: Dialect;
  createdAt: string;
  // postgres
  useUrl: boolean;
  url: string;
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  // sqlite
  file: string;
  readonly: boolean;
};

const EMPTY: Draft = {
  id: "",
  name: "",
  dialect: "postgres",
  createdAt: "",
  useUrl: false,
  url: "",
  host: "localhost",
  port: "5432",
  database: "",
  user: "postgres",
  password: "",
  ssl: false,
  file: "",
  readonly: false,
};

function toDraft(config: ConnectionConfig | null): Draft {
  if (!config) return EMPTY;
  if (config.dialect === "sqlite") {
    return { ...EMPTY, id: config.id, name: config.name, createdAt: config.createdAt, dialect: "sqlite", file: config.file, readonly: Boolean(config.readonly) };
  }
  return {
    ...EMPTY,
    id: config.id,
    name: config.name,
    createdAt: config.createdAt,
    dialect: "postgres",
    useUrl: Boolean(config.url),
    url: config.url ?? "",
    host: config.host ?? "localhost",
    port: String(config.port ?? 5432),
    database: config.database ?? "",
    user: config.user ?? "",
    password: config.password ?? "",
    ssl: Boolean(config.ssl),
  };
}

function toConfig(d: Draft): ConnectionConfig {
  if (d.dialect === "sqlite") {
    const cfg: SqliteConnectionConfig = {
      id: d.id,
      name: d.name,
      dialect: "sqlite",
      file: d.file.trim(),
      readonly: d.readonly,
      createdAt: d.createdAt,
    };
    return cfg;
  }
  const cfg: PostgresConnectionConfig = d.useUrl
    ? { id: d.id, name: d.name, dialect: "postgres", url: d.url.trim(), createdAt: d.createdAt }
    : {
        id: d.id,
        name: d.name,
        dialect: "postgres",
        host: d.host.trim() || "localhost",
        port: Number(d.port) || 5432,
        database: d.database.trim() || undefined,
        user: d.user.trim() || undefined,
        password: d.password,
        ssl: d.ssl,
        createdAt: d.createdAt,
      };
  return cfg;
}

export function ConnectionDialog({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: ConnectionConfig | null;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial));
  const [testing, setTesting] = useState(false);
  const save = useSaveConnection();

  useEffect(() => {
    if (open) setDraft(toDraft(initial));
  }, [open, initial]);

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  const valid =
    draft.dialect === "sqlite"
      ? draft.file.trim().length > 0
      : draft.useUrl
        ? draft.url.trim().length > 0
        : draft.host.trim().length > 0;

  async function handleTest() {
    setTesting(true);
    try {
      const result = await rpc("connections.test", { config: toConfig(draft) });
      toast.success("Connection successful", { description: result.serverVersion });
    } catch (error) {
      toast.error("Connection failed", { description: errorMessage(error) });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    try {
      const saved = await save.mutateAsync(toConfig(draft));
      toast.success(`Saved "${saved.name}"`);
      onOpenChange(false);
    } catch (error) {
      toast.error("Could not save connection", { description: errorMessage(error) });
    }
  }

  async function browse() {
    const { path } = await rpc("system.pickFile", { title: "Choose SQLite database" });
    if (path) patch({ file: path, name: draft.name || path.split("/").pop() || "" });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit connection" : "New connection"}</DialogTitle>
          <DialogDescription>Credentials are stored locally in your config directory.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <Tabs value={draft.dialect} onValueChange={(v) => patch({ dialect: v as Dialect })}>
            <TabsList className="w-full">
              <TabsTrigger value="postgres" className="flex-1">
                PostgreSQL
              </TabsTrigger>
              <TabsTrigger value="sqlite" className="flex-1">
                SQLite
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <Field label="Name">
            <Input
              value={draft.name}
              placeholder={draft.dialect === "sqlite" ? "my-database.sqlite" : "production"}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </Field>

          {draft.dialect === "postgres" ? (
            <>
              <div className="flex items-center justify-between">
                <Label htmlFor="use-url">Use connection URL</Label>
                <Switch id="use-url" checked={draft.useUrl} onCheckedChange={(v) => patch({ useUrl: v })} />
              </div>
              {draft.useUrl ? (
                <Field label="URL">
                  <Input
                    value={draft.url}
                    placeholder="postgres://user:password@host:5432/database"
                    onChange={(e) => patch({ url: e.target.value })}
                    autoComplete="off"
                  />
                </Field>
              ) : (
                <>
                  <div className="grid grid-cols-[1fr_110px] gap-3">
                    <Field label="Host">
                      <Input value={draft.host} onChange={(e) => patch({ host: e.target.value })} />
                    </Field>
                    <Field label="Port">
                      <Input value={draft.port} inputMode="numeric" onChange={(e) => patch({ port: e.target.value })} />
                    </Field>
                  </div>
                  <Field label="Database">
                    <Input value={draft.database} placeholder="postgres" onChange={(e) => patch({ database: e.target.value })} />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="User">
                      <Input value={draft.user} autoComplete="off" onChange={(e) => patch({ user: e.target.value })} />
                    </Field>
                    <Field label="Password">
                      <Input
                        type="password"
                        value={draft.password}
                        autoComplete="new-password"
                        onChange={(e) => patch({ password: e.target.value })}
                      />
                    </Field>
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="ssl">Use SSL / TLS</Label>
                    <Switch id="ssl" checked={draft.ssl} onCheckedChange={(v) => patch({ ssl: v })} />
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <Field label="Database file">
                <div className="flex gap-2">
                  <Input
                    value={draft.file}
                    placeholder="/path/to/database.sqlite or :memory:"
                    onChange={(e) => patch({ file: e.target.value })}
                    className="font-mono text-xs"
                  />
                  <Button variant="outline" onClick={browse} aria-label="Browse">
                    <FolderOpenIcon />
                    Browse
                  </Button>
                </div>
              </Field>
              <div className="flex items-center justify-between">
                <Label htmlFor="readonly">Open read-only</Label>
                <Switch id="readonly" checked={draft.readonly} onCheckedChange={(v) => patch({ readonly: v })} />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleTest} disabled={!valid || testing}>
            {testing && <Loader2Icon className="animate-spin" />}
            Test connection
          </Button>
          <Button onClick={handleSave} disabled={!valid || save.isPending}>
            {save.isPending && <Loader2Icon className="animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
