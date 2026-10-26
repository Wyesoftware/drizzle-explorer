/**
 * Packages the build output for a GitHub release and writes a checksum next to it:
 *   dist/release/drizzle-explorer-<version>-<platform>-<arch>.<zip|tar.gz>
 *   dist/release/<asset>.sha256                       ("<hex>  <asset>", sha256sum format)
 *
 * The in-app updater (server/app.ts) looks for exactly these names, so keep them in sync.
 * Usage: bun run scripts/package.ts --platform darwin|linux|windows --arch arm64|x64
 */
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const platform = arg("platform", process.platform === "win32" ? "windows" : process.platform);
const arch = arg("arch", process.arch);
const version = ((await Bun.file(join(root, "package.json")).json()) as { version: string }).version;

const outDir = join(root, "dist/release");
await mkdir(outDir, { recursive: true });

let asset: string;
if (platform === "darwin") {
  asset = `drizzle-explorer-${version}-darwin-${arch}.zip`;
  await rm(join(outDir, asset), { force: true });
  // ditto keeps the bundle's resource forks and the notarization staple intact.
  await run(["ditto", "-c", "-k", "--keepParent", "--sequesterRsrc", join(root, "dist/Drizzle Explorer.app"), join(outDir, asset)]);
} else if (platform === "linux") {
  asset = `drizzle-explorer-${version}-linux-${arch}.tar.gz`;
  await run(["tar", "-czf", join(outDir, asset), "-C", join(root, "dist/bin"), "drizzle-explorer"]);
} else if (platform === "windows") {
  asset = `drizzle-explorer-${version}-windows-${arch}.zip`;
  await rm(join(outDir, asset), { force: true });
  // Windows ships bsdtar: `-a` picks the format from the extension.
  await run(["tar", "-a", "-cf", join(outDir, asset), "-C", join(root, "dist/bin"), "drizzle-explorer.exe"]);
} else {
  console.error(`Unknown platform ${platform}`);
  process.exit(2);
}

const hasher = new Bun.CryptoHasher("sha256");
const file = Bun.file(join(outDir, asset));
for await (const chunk of file.stream()) hasher.update(chunk);
const digest = hasher.digest("hex");
await Bun.write(join(outDir, `${asset}.sha256`), `${digest}  ${asset}\n`);
console.log(`✔ ${asset} (${(file.size / 1024 / 1024).toFixed(1)} MB) sha256=${digest}`);

async function run(cmd: string[]): Promise<void> {
  console.log(`$ ${cmd.join(" ")}`);
  const proc = Bun.spawn(cmd, { cwd: root, stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) {
    console.error(`Command failed with exit code ${code}`);
    process.exit(code);
  }
}
