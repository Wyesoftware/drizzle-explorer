import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const RPC_PORT = Number(process.env.DRIZZLE_EXPLORER_RPC_PORT ?? 4817);

export default defineConfig({
  root: path.resolve(import.meta.dirname, "src/ui"),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src/ui"),
      "@shared": path.resolve(import.meta.dirname, "src/shared"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/rpc": `http://127.0.0.1:${RPC_PORT}`,
      "/ai": `http://127.0.0.1:${RPC_PORT}`,
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/ui"),
    emptyOutDir: true,
  },
});
