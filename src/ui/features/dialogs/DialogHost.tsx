import { useQueryClient } from "@tanstack/react-query";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useDialogs } from "@/lib/dialogs";
import { ExportDialog } from "@/features/transfer/ExportDialog";
import { ImportDialog } from "@/features/transfer/ImportDialog";
import { TransferDialog } from "@/features/transfer/TransferDialog";
import { DumpDialog } from "@/features/dump/DumpDialog";
import { RestoreDialog } from "@/features/dump/RestoreDialog";
import { JobDialog } from "@/features/jobs/JobDialog";
import { FormatDialog } from "@/features/grid/FormatDialog";
import { SaveQueryDialog } from "@/features/sql/SaveQueryDialog";

/** Renders whichever app-level dialog is currently requested (see lib/dialogs.ts). */
export function DialogHost() {
  const current = useDialogs((s) => s.current);
  const close = useDialogs((s) => s.close);
  const queryClient = useQueryClient();
  if (!current) return null;
  const onOpenChange = (open: boolean) => {
    if (!open) close();
  };
  const key = JSON.stringify(current, (k, v) => (typeof v === "function" ? undefined : v));

  switch (current.kind) {
    case "export":
      return <ExportDialog key={key} open onOpenChange={onOpenChange} source={current.source} defaultName={current.defaultName} />;
    case "import":
      return (
        <ImportDialog
          key={key}
          open
          onOpenChange={onOpenChange}
          connectionId={current.connectionId}
          schema={current.schema}
          table={current.table}
          onImported={() => void queryClient.invalidateQueries({ queryKey: ["rows"] })}
        />
      );
    case "transfer":
      return (
        <TransferDialog
          key={key}
          open
          onOpenChange={onOpenChange}
          source={current.source}
          onDone={() => void queryClient.invalidateQueries({ queryKey: ["rows"] })}
        />
      );
    case "confirm":
      return (
        <ConfirmDialog
          key={key}
          open
          onOpenChange={onOpenChange}
          title={current.title}
          description={current.description}
          confirmLabel={current.confirmLabel}
          destructive={current.destructive}
          options={current.options}
          onConfirm={current.onConfirm}
        />
      );
    case "dump":
      return (
        <DumpDialog key={key} open onOpenChange={onOpenChange} connectionId={current.connectionId} dialect={current.dialect} schema={current.schema} />
      );
    case "restore":
      return <RestoreDialog key={key} open onOpenChange={onOpenChange} connectionId={current.connectionId} dialect={current.dialect} />;
    case "job":
      return <JobDialog key={key} open onOpenChange={onOpenChange} jobId={current.jobId} />;
    case "saveQuery":
      return (
        <SaveQueryDialog
          key={key}
          open
          onOpenChange={onOpenChange}
          id={current.id}
          connectionId={current.connectionId}
          sql={current.sql}
          defaultName={current.defaultName}
          onSaved={current.onSaved}
        />
      );
    case "format":
      return (
        <FormatDialog
          key={key}
          open
          onOpenChange={onOpenChange}
          scope={current.scope}
          column={current.column}
          dataType={current.dataType}
          sample={current.sample}
        />
      );
  }
}
