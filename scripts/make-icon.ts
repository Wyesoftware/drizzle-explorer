/**
 * Renders assets/icon.svg into assets/AppIcon.icns (macOS) and assets/icon-1024.png.
 * Needs `rsvg-convert` (brew install librsvg) or ImageMagick `magick`, plus Apple's sips/iconutil.
 *
 *   bun run scripts/make-icon.ts
 *
 * The outputs are committed, so builds (and CI runners) do not need the SVG toolchain.
 */
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync, which } from "bun";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const svg = join(root, "assets/icon.svg");
const png = join(root, "assets/icon-1024.png");
const iconset = join(root, "assets/AppIcon.iconset");
const icns = join(root, "assets/AppIcon.icns");

function run(cmd: string[]): void {
  const result = spawnSync(cmd, { stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) {
    console.error(`Command failed (${result.exitCode}): ${cmd.join(" ")}`);
    process.exit(result.exitCode || 1);
  }
}

if (which("rsvg-convert")) run(["rsvg-convert", "-w", "1024", "-h", "1024", "-o", png, svg]);
else if (which("magick")) run(["magick", "-background", "none", "-density", "384", svg, "-resize", "1024x1024", png]);
else {
  console.error("Need rsvg-convert (brew install librsvg) or ImageMagick to render the SVG");
  process.exit(1);
}
console.log(`✔ ${png}`);

if (process.platform === "darwin") {
  await rm(iconset, { recursive: true, force: true });
  await mkdir(iconset, { recursive: true });
  // Apple iconset naming: icon_<pt>x<pt>[@2x].png
  const entries: [string, number][] = [
    ["icon_16x16", 16],
    ["icon_16x16@2x", 32],
    ["icon_32x32", 32],
    ["icon_32x32@2x", 64],
    ["icon_128x128", 128],
    ["icon_128x128@2x", 256],
    ["icon_256x256", 256],
    ["icon_256x256@2x", 512],
    ["icon_512x512", 512],
    ["icon_512x512@2x", 1024],
  ];
  for (const [name, size] of entries) {
    run(["sips", "-s", "format", "png", "-z", String(size), String(size), png, "--out", join(iconset, `${name}.png`)]);
  }
  run(["iconutil", "-c", "icns", iconset, "-o", icns]);
  await rm(iconset, { recursive: true, force: true });
  console.log(`✔ ${icns}`);
}
