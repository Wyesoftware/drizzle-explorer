import { toast } from "sonner";
import type { UpdateCheck } from "@shared/types";
import { errorMessage, rpc } from "@/lib/rpc";
import { openDialog } from "@/lib/dialogs";
import { useUpdateStore } from "@/lib/settings";

/** Starts the in-place update job and shows its log; the app restarts itself when the job succeeds. */
export async function installUpdate(): Promise<void> {
  try {
    const { jobId } = await rpc("app.installUpdate", {});
    openDialog({ kind: "job", jobId });
  } catch (error) {
    toast.error("Could not start the update", { description: errorMessage(error) });
  }
}

/**
 * Checks GitHub for a newer release and stores the result for the status bar / settings page.
 * `notify: "always"` reports every outcome (manual check); `"newOnly"` only toasts when an update exists (start-up).
 */
export async function checkForUpdates(notify: "always" | "newOnly"): Promise<UpdateCheck | null> {
  const store = useUpdateStore.getState();
  store.setChecking(true);
  try {
    const result = await rpc("app.checkUpdate", {});
    store.setResult(result);
    if (result.error) {
      if (notify === "always") toast.warning("Update check", { description: result.error });
    } else if (result.upToDate) {
      if (notify === "always") toast.success(`You are on the latest version (${result.current})`);
    } else {
      toast.info(`Drizzle Explorer ${result.latest} is available`, {
        action: result.installable
          ? { label: "Install and restart", onClick: () => void installUpdate() }
          : result.url
            ? { label: "Release page", onClick: () => void rpc("system.openExternal", { url: result.url! }) }
            : undefined,
        duration: 15_000,
      });
    }
    return result;
  } catch (error) {
    if (notify === "always") toast.error("Update check failed", { description: errorMessage(error) });
    return null;
  } finally {
    store.setChecking(false);
  }
}
