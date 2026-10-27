import { useState } from "react";
import { toast } from "sonner";
import { Loader2Icon } from "lucide-react";
import type { SavedQuery } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/NativeSelect";
import { useConnections, useSaveQuery } from "@/lib/queries";
import { errorMessage } from "@/lib/rpc";

/** Saves SQL into the library under a name (new entry, or rename/update of an existing one). */
export function SaveQueryDialog({
  open,
  onOpenChange,
  id = null,
  connectionId,
  sql,
  defaultName = "",
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  id?: string | null;
  connectionId: string | null;
  sql: string;
  defaultName?: string;
  onSaved?: (query: SavedQuery) => void;
}) {
  const connections = useConnections();
  const [name, setName] = useState(defaultName);
  const [target, setTarget] = useState(connectionId ?? "");
  const save = useSaveQuery();

  async function submit() {
    try {
      const saved = await save.mutateAsync({ id, connectionId: target || null, name, sql });
      toast.success(id ? `Saved "${saved.name}"` : `Added "${saved.name}" to saved queries`);
      onSaved?.(saved);
      onOpenChange(false);
    } catch (error) {
      toast.error("Could not save query", { description: errorMessage(error) });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{id ? "Rename saved query" : "Save query"}</DialogTitle>
          <DialogDescription>Saved queries live under their connection in the sidebar and survive restarts.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="saved-query-name">Name</Label>
            <Input id="saved-query-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Monthly revenue" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="saved-query-connection">Connection</Label>
            <NativeSelect id="saved-query-connection" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">No connection</option>
              {(connections.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          {!id && (
            <pre className="max-h-40 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[11px] leading-snug whitespace-pre-wrap text-muted-foreground">
              {sql.trim() || "(empty)"}
            </pre>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending || !name.trim()}>
              {save.isPending && <Loader2Icon className="animate-spin" />}
              {id ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
