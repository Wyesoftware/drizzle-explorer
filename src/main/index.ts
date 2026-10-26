/**
 * Desktop entry point. Starts the backend worker, then opens a native webview
 * window pointed at it. webview.run() blocks until the window is closed.
 */
import { SizeHint, Webview } from "webview-bun";
import { installMacosMenu, setMacosDockIcon } from "./macos-menu";

const devUrl = process.env.DRIZZLE_EXPLORER_DEV_URL;

const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
worker.onerror = (event) => {
  console.error("[main] worker error:", event.message);
};

const ready = await new Promise<{ port: number; url: string }>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Backend did not start within 15s")), 15_000);
  worker.onmessage = (event: MessageEvent) => {
    if (event.data?.type === "ready") {
      clearTimeout(timer);
      resolve(event.data);
    }
  };
});

const url = devUrl ?? ready.url;
console.log(`[main] opening ${url}`);

const webview = new Webview(Boolean(devUrl), { width: 1440, height: 920, hint: SizeHint.NONE });
webview.title = "Drizzle Explorer";
// Must run after the webview created NSApplication and before the run loop starts.
// Running from source (not the packaged .app) the Dock would show Bun's icon.
if (process.platform === "darwin" && !process.execPath.includes(".app/Contents/MacOS/")) {
  setMacosDockIcon(new URL("../../assets/AppIcon.icns", import.meta.url).pathname);
}
installMacosMenu("Drizzle Explorer", (action) => {
  // Forward native menu actions to the UI (see src/ui/lib/menu-events.ts).
  webview.eval(`window.dispatchEvent(new CustomEvent("drizzle:menu", { detail: ${JSON.stringify(action)} }))`);
});
webview.navigate(url);
webview.run(); // blocks until the window closes

await shutdown();

async function shutdown(): Promise<void> {
  const stopped = new Promise<void>((resolve) => {
    worker.onmessage = (event: MessageEvent) => {
      if (event.data?.type === "stopped") resolve();
    };
    setTimeout(resolve, 2_000);
  });
  worker.postMessage({ type: "shutdown" });
  await stopped;
  worker.terminate();
  process.exit(0);
}
