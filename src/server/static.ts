import { join, extname } from "node:path";
import { existsSync } from "node:fs";
import { assets as embeddedAssets } from "../main/assets.generated";

/**
 * Serves the built UI. In a compiled binary the files come from the generated
 * asset manifest (see scripts/build.ts); during development they come from dist/ui
 * when it exists (useful for testing a production build without compiling).
 */

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

type AssetManifest = Record<string, string>;

async function loadManifest(): Promise<AssetManifest | null> {
  return Object.keys(embeddedAssets).length > 0 ? embeddedAssets : null;
}

const DIST_DIR = join(import.meta.dir, "../../dist/ui");

export async function serveStatic(pathname: string): Promise<Response> {
  const manifest = await loadManifest();
  const clean = pathname === "/" ? "/index.html" : pathname;

  let filePath: string | null = null;
  if (manifest) {
    filePath = manifest[clean] ?? manifest["/index.html"] ?? null; // SPA fallback
  } else if (existsSync(DIST_DIR)) {
    const candidate = join(DIST_DIR, clean);
    filePath = existsSync(candidate) ? candidate : join(DIST_DIR, "index.html");
  }

  if (!filePath) {
    return new Response(
      "UI build not found. Run `bun run build:ui`, or start the dev server with `bun run dev`.",
      { status: 503, headers: { "content-type": "text/plain" } },
    );
  }

  const file = Bun.file(filePath);
  if (!(await file.exists())) return new Response("Not found", { status: 404 });
  const type = MIME[extname(filePath)] ?? file.type ?? "application/octet-stream";
  const immutable = clean.startsWith("/assets/");
  return new Response(file, {
    headers: {
      "content-type": type,
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    },
  });
}
