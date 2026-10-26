import { toast } from "sonner";
import type { QueryClient } from "@tanstack/react-query";
import type { Dialect, RoutineInfo, TableInfo } from "@shared/types";
import { openDialog } from "@/lib/dialogs";
import { keys } from "@/lib/queries";
import { rpc } from "@/lib/rpc";
import { routineTabId, tableTabId, useAppStore } from "@/lib/store";

/** Context-menu actions shared by the tree rows. Each opens a confirm dialog and refreshes the tree afterwards. */

export function dropTable(queryClient: QueryClient, connectionId: string, dialect: Dialect, table: TableInfo) {
  const label = table.kind === "table" ? "table" : table.kind.replace("_", " ");
  openDialog({
    kind: "confirm",
    title: `Drop ${label} ${qualify(table.schema, table.name)}?`,
    description: "This permanently deletes the object and its data. There is no undo.",
    confirmLabel: "Drop",
    destructive: true,
    options: dialect === "postgres" ? [{ key: "cascade", label: "CASCADE (also drop dependent objects)" }] : [],
    onConfirm: async (opts) => {
      await rpc("schema.dropTable", {
        connectionId,
        schema: table.schema,
        table: table.name,
        kind: table.kind,
        cascade: Boolean(opts.cascade),
      });
      useAppStore.getState().closeTab(tableTabId(connectionId, table.schema, table.name));
      await queryClient.invalidateQueries({ queryKey: keys.tables(connectionId, table.schema) });
      toast.success(`Dropped ${table.name}`);
    },
  });
}

export function truncateTable(queryClient: QueryClient, connectionId: string, dialect: Dialect, table: TableInfo) {
  openDialog({
    kind: "confirm",
    title: `Truncate ${qualify(table.schema, table.name)}?`,
    description: "All rows are deleted. There is no undo.",
    confirmLabel: "Truncate",
    destructive: true,
    options:
      dialect === "postgres"
        ? [
            { key: "restartIdentity", label: "RESTART IDENTITY (reset sequences)" },
            { key: "cascade", label: "CASCADE (also truncate referencing tables)" },
          ]
        : [{ key: "restartIdentity", label: "Reset AUTOINCREMENT counter" }],
    onConfirm: async (opts) => {
      await rpc("schema.truncateTable", {
        connectionId,
        schema: table.schema,
        table: table.name,
        cascade: Boolean(opts.cascade),
        restartIdentity: Boolean(opts.restartIdentity),
      });
      await queryClient.invalidateQueries({ queryKey: ["rows"] });
      toast.success(`Truncated ${table.name}`);
    },
  });
}

export function dropRoutine(queryClient: QueryClient, connectionId: string, routine: RoutineInfo) {
  openDialog({
    kind: "confirm",
    title: `Drop ${routine.kind} ${qualify(routine.schema, routine.name)}(${routine.identityArgs})?`,
    description: "There is no undo.",
    confirmLabel: "Drop",
    destructive: true,
    onConfirm: async () => {
      await rpc("schema.dropRoutine", {
        connectionId,
        schema: routine.schema,
        name: routine.name,
        identityArgs: routine.identityArgs,
        kind: routine.kind,
      });
      useAppStore.getState().closeTab(routineTabId(connectionId, routine));
      await queryClient.invalidateQueries({ queryKey: keys.routines(connectionId, routine.schema) });
      toast.success(`Dropped ${routine.name}`);
    },
  });
}

export function qualify(schema: string | null, name: string): string {
  return schema ? `${schema}.${name}` : name;
}
