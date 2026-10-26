import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { prefsStorage } from "@/lib/prefs";
import type { UpdateCheck } from "@shared/types";

export type TableMode = "paginated" | "infinite";

interface AppSettings {
  tableMode: TableMode;
  pageSize: number;
  checkUpdates: boolean;
  set: (patch: Partial<Omit<AppSettings, "set">>) => void;
}

/** App preferences (theme lives in lib/theme.tsx). */
export const useSettings = create<AppSettings>()(
  persist(
    (set) => ({
      tableMode: "paginated",
      pageSize: 200,
      checkUpdates: true,
      set: (patch) => set(patch),
    }),
    {
      name: "drizzle-explorer.settings",
      version: 2,
      storage: createJSONStorage(() => prefsStorage),
      partialize: ({ set: _s, ...rest }) => rest,
      // v1 stored a user-editable update repository; it is a constant now (UPDATE_REPO).
      migrate: (state) => {
        const { updateRepo: _r, ...rest } = (state ?? {}) as Partial<AppSettings> & { updateRepo?: string };
        return rest as AppSettings;
      },
    },
  ),
);

interface UpdateState {
  result: UpdateCheck | null;
  checking: boolean;
  setResult: (r: UpdateCheck | null) => void;
  setChecking: (v: boolean) => void;
}

export const useUpdateStore = create<UpdateState>((set) => ({
  result: null,
  checking: false,
  setResult: (result) => set({ result }),
  setChecking: (checking) => set({ checking }),
}));
