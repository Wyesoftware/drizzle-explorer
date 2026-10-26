import { useState } from "react";
import { toast } from "sonner";
import { Loader2Icon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { errorMessage } from "@/lib/rpc";
import type { ConfirmOption } from "@/lib/dialogs";
import { cn } from "@/lib/utils";

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  destructive = false,
  options = [],
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  options?: ConfirmOption[];
  onConfirm: (options: Record<string, boolean>) => Promise<void> | void;
}) {
  const [values, setValues] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(options.map((o) => [o.key, Boolean(o.defaultChecked)])),
  );
  const [running, setRunning] = useState(false);

  async function confirm() {
    setRunning(true);
    try {
      await onConfirm(values);
      onOpenChange(false);
    } catch (error) {
      toast.error(title, { description: errorMessage(error) });
    } finally {
      setRunning(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription className="whitespace-pre-line">{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        {options.length > 0 && (
          <div className="grid gap-2">
            {options.map((o) => (
              <label key={o.key} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={values[o.key] ?? false}
                  onCheckedChange={(v) => setValues((s) => ({ ...s, [o.key]: Boolean(v) }))}
                />
                {o.label}
              </label>
            ))}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={running}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void confirm();
            }}
            disabled={running}
            className={cn(destructive && "bg-destructive text-white hover:bg-destructive/90")}
          >
            {running && <Loader2Icon className="animate-spin" />}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
