/**
 * App-level helpers: version, update check + in-place install from GitHub Releases, opening URLs in the
 * system browser.
 *
 * Update flow (`installUpdate`, runs as a job): download the asset built for this platform/arch →
 * verify it against the `.sha256` published next to it → extract → swap the installation
 * (`.app` bundle on macOS, bare executable elsewhere) → launch the new copy → end this process.
 * The main thread is blocked in `webview.run()`, so the worker ends the process with SIGTERM.
 */
import { chmod, cp, mkdir, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { UPDATE_REPO, type UpdateAsset, type UpdateCheck } from "@shared/types";
import { DriverError } from "./drivers";
import { connections } from "./connections";
import { startJob, type JobHandle } from "./jobs";
import { compareVersions, matchAsset, parseChecksum, type ReleaseAsset } from "./versions";

export const APP_VERSION: string = (pkg as { version: string }).version;
/** Injected by scripts/build.ts through `--define`; undefined when running from source. */
declare const DRIZZLE_EXPLORER_BUILD: string | undefined;
export const BUILD_TIME: string | null = typeof DRIZZLE_EXPLORER_BUILD === "string" ? DRIZZLE_EXPLORER_BUILD : null;
export const isStandalone: boolean = Boolean(Bun.isStandaloneExecutable);

/** Overridable so the updater can be exercised against a local mock of the GitHub API. */
const GITHUB_API = process.env.DRIZZLE_EXPLORER_GITHUB_API ?? "https://api.github.com";
const PLATFORM = process.platform === "win32" ? "windows" : process.platform;
const ARCH = process.arch;

interface GhRelease {
  tag_name?: string;
  html_url?: string;
  published_at?: string;
  assets?: ReleaseAsset[];
}

const headers = () => ({ accept: "application/vnd.github+json", "user-agent": `drizzle-explorer/${APP_VERSION}` });

/** Looks up the latest GitHub release of the app repository and the asset that fits this machine. */
export async function checkUpdate(repo: string = UPDATE_REPO): Promise<UpdateCheck> {
  const current = APP_VERSION;
  try {
    const res = await fetch(`${GITHUB_API}/repos/${repo}/releases/latest`, { headers: headers(), signal: AbortSignal.timeout(10_000) });
    if (res.status === 404) return { current, latest: null, url: `https://github.com/${repo}/releases`, upToDate: true, error: "No releases published yet" };
    if (!res.ok) return { current, latest: null, url: null, upToDate: true, error: `GitHub responded ${res.status}` };
    const release = (await res.json()) as GhRelease;
    const latest = release.tag_name ?? null;
    const upToDate = !latest || compareVersions(latest, current) <= 0;
    const asset = matchAsset(release.assets ?? [], PLATFORM, ARCH);
    return {
      current,
      latest,
      url: release.html_url ?? `https://github.com/${repo}/releases`,
      upToDate,
      publishedAt: release.published_at ?? null,
      asset,
      installable: isStandalone && !upToDate && asset !== null,
    };
  } catch (error) {
    return { current, latest: null, url: null, upToDate: true, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function installUpdate(repo: string = UPDATE_REPO): Promise<{ jobId: string }> {
  if (!isStandalone) throw new DriverError("In-place updates only work in the packaged app; run the build from dist/", "BAD_REQUEST");
  const check = await checkUpdate(repo);
  if (check.error) throw new DriverError(check.error, "BAD_REQUEST");
  if (check.upToDate || !check.latest) throw new DriverError(`Already on the latest version (${check.current})`, "BAD_REQUEST");
  const asset = check.asset;
  if (!asset) throw new DriverError(`Release ${check.latest} has no build for ${PLATFORM}-${ARCH}`, "BAD_REQUEST");
  const latest = check.latest;

  const jobId = startJob("update", `Update to ${latest}`, async (job) => {
    const work = join(tmpdir(), `drizzle-explorer-update-${crypto.randomUUID().slice(0, 8)}`);
    await mkdir(work, { recursive: true });
    try {
      const archive = join(work, asset.name);
      await download(asset, archive, job);
      await verifyChecksum(asset, archive, job);
      const extracted = join(work, "extracted");
      await mkdir(extracted);
      await extract(archive, extracted, job);
      const launch = await swapInstall(extracted, job);
      job.log(`Installed ${latest}. Restarting…`);
      scheduleRelaunch(launch, work);
      return { path: launch.path };
    } catch (error) {
      await rm(work, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  });
  return { jobId };
}

/** Removes leftovers of a previous in-place update (the old bundle/executable we could not delete while running). */
export async function cleanupAfterUpdate(): Promise<void> {
  if (!isStandalone) return;
  const install = currentInstall();
  const leftovers =
    install.kind === "app"
      ? [join(dirname(install.path), `.${basename(install.path)}.old`), join(dirname(install.path), `.${basename(install.path)}.update`)]
      : [`${install.path}.old`, `${install.path}.update`];
  for (const path of leftovers) {
    // On Windows the previous process may still be exiting and holding its executable open.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await rm(path, { recursive: true, force: true });
        break;
      } catch {
        await Bun.sleep(1000);
      }
    }
  }
}

export async function openExternal(url: string): Promise<void> {
  if (!/^https?:\/\//.test(url)) throw new DriverError("Only http(s) URLs can be opened", "BAD_REQUEST");
  const cmd =
    process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
  const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  await proc.exited;
}

// ----- update steps ----------------------------------------------------------------------------------

type Install = { kind: "app" | "binary"; path: string };

/** Where this process lives: the `.app` bundle on macOS, otherwise the executable itself. */
function currentInstall(): Install {
  const exe = process.execPath;
  const app = PLATFORM === "darwin" ? /^(.*\.app)\/Contents\/MacOS\/[^/]+$/.exec(exe) : null;
  return app ? { kind: "app", path: app[1]! } : { kind: "binary", path: exe };
}

async function download(asset: UpdateAsset, dest: string, job: JobHandle): Promise<void> {
  job.log(`Downloading ${asset.name} (${mb(asset.size)} MB)…`);
  const res = await fetch(asset.url, {
    headers: { accept: "application/octet-stream", "user-agent": headers()["user-agent"] },
    signal: job.signal,
    redirect: "follow",
  });
  if (!res.ok || !res.body) throw new DriverError(`Download failed: HTTP ${res.status}`, "UPDATE");
  const total = Number(res.headers.get("content-length")) || asset.size;
  const writer = Bun.file(dest).writer();
  let received = 0;
  let nextMark = 25;
  for await (const chunk of res.body) {
    writer.write(chunk);
    received += chunk.byteLength;
    const pct = total ? Math.floor((received / total) * 100) : 0;
    if (pct >= nextMark) {
      job.log(`  ${pct}%`);
      nextMark += 25;
    }
  }
  await writer.end();
  job.log(`Downloaded ${mb(received)} MB`);
}

async function verifyChecksum(asset: UpdateAsset, archive: string, job: JobHandle): Promise<void> {
  if (!asset.checksumUrl) throw new DriverError(`The release has no ${asset.name}.sha256; refusing to install an unverified build`, "UPDATE");
  const res = await fetch(asset.checksumUrl, { headers: { accept: "application/octet-stream", "user-agent": headers()["user-agent"] }, signal: job.signal });
  if (!res.ok) throw new DriverError(`Checksum download failed: HTTP ${res.status}`, "UPDATE");
  const expected = parseChecksum(await res.text());
  if (!expected) throw new DriverError("Checksum file is not in sha256sum format", "UPDATE");
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(archive).stream()) hasher.update(chunk);
  const actual = hasher.digest("hex");
  if (actual !== expected) throw new DriverError(`Checksum mismatch: expected ${expected}, got ${actual}`, "UPDATE");
  job.log("Checksum verified");
}

async function extract(archive: string, dir: string, job: JobHandle): Promise<void> {
  job.log("Extracting…");
  const cmd =
    PLATFORM === "darwin"
      ? ["ditto", "-x", "-k", archive, dir] // keeps the bundle's attributes and notarization ticket
      : archive.endsWith(".zip")
        ? ["tar", "-xf", archive, "-C", dir] // Windows ships bsdtar, which reads zip
        : ["tar", "-xzf", archive, "-C", dir];
  await exec(cmd, job.signal);
}

/** Replaces the running installation with the extracted one; the old copy is deleted on the next start. */
async function swapInstall(extracted: string, job: JobHandle): Promise<Install> {
  const install = currentInstall();
  try {
    if (install.kind === "app") {
      const newApp = await findEntry(extracted, (name) => name.endsWith(".app"));
      if (!newApp) throw new DriverError("The downloaded archive contains no .app bundle", "UPDATE");
      const parent = dirname(install.path);
      const name = basename(install.path);
      const staging = join(parent, `.${name}.update`);
      const backup = join(parent, `.${name}.old`);
      await rm(staging, { recursive: true, force: true });
      await rm(backup, { recursive: true, force: true });
      job.log(`Copying into ${parent}…`);
      await exec(["ditto", newApp, staging], job.signal); // same volume → the renames below are atomic
      job.log(`Replacing ${install.path}`);
      await rename(install.path, backup);
      try {
        await rename(staging, install.path);
      } catch (error) {
        await rename(backup, install.path);
        throw error;
      }
      return install;
    }
    const exeName = basename(install.path);
    const newBin = await findEntry(extracted, (name) => name === exeName || name === "drizzle-explorer" || name === "drizzle-explorer.exe");
    if (!newBin) throw new DriverError("The downloaded archive contains no executable", "UPDATE");
    const staging = `${install.path}.update`;
    const backup = `${install.path}.old`;
    await rm(staging, { force: true });
    await rm(backup, { force: true });
    await cp(newBin, staging);
    await chmod(staging, 0o755);
    job.log(`Replacing ${install.path}`);
    await rename(install.path, backup); // a running executable can be renamed, not overwritten (Windows)
    try {
      await rename(staging, install.path);
    } catch (error) {
      await rename(backup, install.path);
      throw error;
    }
    return install;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "EACCES" || code === "EPERM" || code === "EROFS")
      throw new DriverError(`Cannot write to ${dirname(install.path)} (${code}); install the release manually`, "UPDATE");
    throw error;
  }
}

function scheduleRelaunch(launch: Install, work: string): void {
  // Let the job report "done" to the UI first.
  setTimeout(() => {
    void (async () => {
      await connections.closeAll().catch(() => {});
      await rm(work, { recursive: true, force: true }).catch(() => {});
      const cmd = launch.kind === "app" ? ["open", "-n", launch.path] : [launch.path];
      const child = Bun.spawn(cmd, { stdin: "ignore", stdout: "ignore", stderr: "ignore", env: { ...process.env, DRIZZLE_EXPLORER_RELAUNCHED: "1" } });
      child.unref();
      // webview.run() blocks the main thread, so no message can reach it: a signal is the only way to end the process.
      setTimeout(() => process.kill(process.pid, "SIGTERM"), 500);
    })();
  }, 1200);
}

async function exec(cmd: string[], signal: AbortSignal): Promise<void> {
  const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "pipe", signal });
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  if (code !== 0) throw new DriverError(`${cmd[0]} failed (exit ${code}): ${stderr.trim().slice(0, 500)}`, "UPDATE");
}

async function findEntry(dir: string, pred: (name: string) => boolean, depth = 0): Promise<string | null> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) if (pred(entry.name)) return join(dir, entry.name);
  if (depth >= 2) return null;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.endsWith(".app")) continue;
    const found = await findEntry(join(dir, entry.name), pred, depth + 1);
    if (found) return found;
  }
  return null;
}

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
