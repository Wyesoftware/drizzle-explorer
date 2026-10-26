/**
 * Headless mode: run only the backend (RPC + static UI) without opening a window.
 * Handy for debugging in a regular browser: `bun run serve` then open the printed URL.
 */
const worker = new Worker(new URL("../src/main/worker.ts", import.meta.url).href);
worker.onmessage = (event: MessageEvent) => {
  if (event.data?.type === "ready") console.log(`[serve] backend ready at ${event.data.url}`);
};
worker.onerror = (event) => console.error("[serve] worker error:", event.message);
const stop = () => {
  worker.postMessage({ type: "shutdown" });
  setTimeout(() => process.exit(0), 500);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
