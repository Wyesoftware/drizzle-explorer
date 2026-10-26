/**
 * Writes the version from a release tag ("v1.2.3", "app-v1.2.3") into package.json so the compiled app
 * reports it (server/app.ts reads package.json at build time). Used by the release workflow; no commit.
 */
const tag = process.argv[2];
const match = tag ? /\d+\.\d+\.\d+(?:[-+][\w.-]+)?/.exec(tag) : null;
if (!match) {
  console.error(`Usage: bun run scripts/set-version.ts v1.2.3 (got ${JSON.stringify(tag)})`);
  process.exit(2);
}
const file = new URL("../package.json", import.meta.url);
const pkg = (await Bun.file(file).json()) as { version: string };
const previous = pkg.version;
pkg.version = match[0];
await Bun.write(file, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`package.json version: ${previous} → ${pkg.version}`);
