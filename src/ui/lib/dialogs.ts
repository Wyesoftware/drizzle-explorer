import { create } from "zustand";
import type { Dialect, ExportSource } from "@shared/types";

export interface ConfirmOption {
  key: string;
  label: string;
  defaultChecked?: boolean;
}

export type DialogRequest =
  | { kind: "export"; source: ExportSource; defaultName: string }
  | { kind: "import"; connectionId: string; schema: string | null; table: string }
  | { kind: "transfer"; source: ExportSource }
  | {
      kind: "confirm";
      title: string;
      description?: string;
      confirmLabel?: string;
      destructive?: boolean;
      options?: ConfirmOption[];
      onConfirm: (options: Record<string, boolean>) => Promise<void> | void;
    }
  | { kind: "dump"; connectionId: string; dialect: Dialect; schema?: string | null }
  | { kind: "restore"; connectionId: string; dialect: Dialect }
  | { kind: "job"; jobId: string }
  | { kind: "format"; scope: string; column: string; dataType: string | null; sample: unknown };

interface DialogState {
  current: DialogRequest | null;
  open: (request: DialogRequest) => void;
  close: () => void;
}

/** App-wide modal dialogs, so tree context menus and tabs can open the same dialogs. */
export const useDialogs = create<DialogState>((set) => ({
  current: null,
  open: (request) => set({ current: request }),
  close: () => set({ current: null }),
}));

export const openDialog = (request: DialogRequest) => useDialogs.getState().open(request);
