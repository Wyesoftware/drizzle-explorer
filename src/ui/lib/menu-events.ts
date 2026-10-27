import { useEffect } from "react";
import { useAppStore } from "@/lib/store";
import { useLayout } from "@/lib/layout";
import { checkForUpdates } from "@/lib/updates";

/** Actions the native (macOS) menu sends through `window.dispatchEvent(new CustomEvent("drizzle:menu", { detail }))`. */
export type MenuAction = "settings" | "check-updates";

/** Wires native menu actions and the global shortcuts: Cmd/Ctrl+, settings, Cmd/Ctrl+B sidebar, Cmd/Ctrl+J explore/assistant mode. */
export function useMenuActions(): void {
  const openSettings = useAppStore((s) => s.openSettings);
  useEffect(() => {
    const onMenu = (event: Event) => {
      const action = (event as CustomEvent<MenuAction>).detail;
      if (action === "settings") openSettings();
      if (action === "check-updates") {
        openSettings("updates");
        void checkForUpdates("always");
      }
    };
    // On macOS the menu item owns Cmd+, (AppKit consumes the key equivalent); this covers other platforms.
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key === ",") {
        event.preventDefault();
        openSettings();
      } else if (key === "b") {
        event.preventDefault();
        useLayout.getState().toggleSidebar();
      } else if (key === "j") {
        event.preventDefault();
        useLayout.getState().toggleMode();
      }
    };
    window.addEventListener("drizzle:menu", onMenu);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("drizzle:menu", onMenu);
      window.removeEventListener("keydown", onKey);
    };
  }, [openSettings]);
}
