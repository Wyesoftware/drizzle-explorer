/**
 * Development: Vite dev server (HMR) + desktop shell pointed at it.
 * Pass --watch to restart the shell/backend when server files change.
 */
import { spawn } from "bun";
import { fileURLToPath } from "node:url";

const VITE_PORT = 5173;
const RPC_PORT = Number(process.env.DRIZZLE_EXPLORER_RPC_PORT ?? 4817);
const watch = process.argv.includes("--watch");
const root = fileURLToPath(new URL("..", import.meta.url));

const env = {
  ...process.env,
  DRIZZLE_EXPLORER_DEV_URL: `http://localhost:${VITE_PORT}`,
  DRIZZLE_EXPLORER_RPC_PORT: String(RPC_PORT),
};

const vite = spawn(["bunx", "vite", "--port", String(VITE_PORT), "--strictPort"], {
  cwd: root,
  env,
  stdout: "inherit",
  stderr: "inherit",
});

await waitForPort(VITE_PORT, 30_000);

const app = spawn(["bun", ...(watch ? ["--watch"] : []), "run", "src/main/index.ts"], {
  cwd: root,
  env,
  stdout: "inherit",
  stderr: "inherit",
});

const stop = () => {
  app.kill();
  vite.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

await app.exited;
vite.kill();
process.exit(0);

async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/`);
      if (res.ok || res.status === 404) return;
    } catch {
      // not up yet
    }
    await Bun.sleep(200);
  }
  throw new Error(`Vite did not start on port ${port}`);
}
