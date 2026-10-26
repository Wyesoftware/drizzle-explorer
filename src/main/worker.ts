/// <reference lib="webworker" />
/**
 * Backend worker: HTTP server with the RPC endpoint and static UI assets.
 * Runs in a Worker because the webview's event loop blocks the main thread.
 */
import { handleRpc } from "../server/rpc";
import { serveStatic } from "../server/static";
import { connections } from "../server/connections";
import { ai } from "../server/ai/sessions";
import { cleanupAfterUpdate } from "../server/app";

declare const self: Worker;

const isDev = Boolean(process.env.DRIZZLE_EXPLORER_DEV_URL);
/** Dev: fixed port so Vite can proxy to it. Packaged: any free port (UI state lives in the config dir, not localStorage). */
const PORT = isDev ? Number(process.env.DRIZZLE_EXPLORER_RPC_PORT ?? 4817) : 0;

const serverOptions = {
  hostname: "127.0.0.1",
  idleTimeout: 255,
  async fetch(request: Request) {
    const url = new URL(request.url);
    if (url.pathname === "/rpc") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: { message: "Invalid JSON body", code: "BAD_REQUEST" } }, 400);
      }
      return json(await handleRpc(body));
    }
    if (url.pathname === "/health") return json({ ok: true, bun: Bun.version });
    if (url.pathname === "/ai/events") return aiEventStream(url.searchParams.get("id") ?? "");
    return serveStatic(url.pathname);
  },
  error(error: Error) {
    console.error("[server]", error);
    return json({ ok: false, error: { message: error.message } }, 500);
  },
};

const server = Bun.serve({ ...serverOptions, port: PORT });

/** Server-sent events for one chat session; a heartbeat keeps the connection under the idle timeout. */
function aiEventStream(sessionId: string): Response {
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // stream closed
        }
      };
      try {
        unsubscribe = await ai.subscribe(sessionId, send);
      } catch (error) {
        send({ type: "turn_error", messageId: "", message: error instanceof Error ? error.message : String(error) });
        controller.close();
        return;
      }
      send({ type: "status", text: "connected" });
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15_000);
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
  });
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

self.onmessage = async (event: MessageEvent<{ type: string }>) => {
  if (event.data?.type === "shutdown") {
    await connections.closeAll();
    server.stop(true);
    self.postMessage({ type: "stopped" });
  }
};

self.postMessage({ type: "ready", port: server.port, url: `http://127.0.0.1:${server.port}/` });
void cleanupAfterUpdate();
console.log(`[server] listening on http://127.0.0.1:${server.port}${isDev ? " (dev: RPC only)" : ""}`);
