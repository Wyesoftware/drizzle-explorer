/** Pure helpers for the updater: version comparison, release-asset matching, checksum parsing. Unit-tested. */
import type { UpdateAsset } from "@shared/types";

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

/** Compares dotted versions; returns >0 when a is newer than b. */
export function compareVersions(a: string, b: string): number {
  // Tags may carry prefixes ("v0.2.0", "app-v0.2.0"): compare the first dotted number sequence.
  const nums = (v: string) => (/\d+(?:\.\d+)+/.exec(v)?.[0] ?? "0").split(".").map((x) => Number.parseInt(x, 10) || 0);
  const pa = nums(a);
  const pb = nums(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Picks the asset built for `platform-arch` from a release (naming comes from scripts/package.ts:
 * `drizzle-explorer-<version>-<platform>-<arch>.<zip|tar.gz>`) together with its `.sha256` companion.
 */
export function matchAsset(assets: ReleaseAsset[], platform: string, arch: string): UpdateAsset | null {
  const pattern = new RegExp(`^drizzle-explorer-.+-${platform}-${arch}\\.(zip|tar\\.gz)$`);
  const asset = assets.find((a) => pattern.test(a.name));
  if (!asset) return null;
  const checksum = assets.find((a) => a.name === `${asset.name}.sha256`);
  return {
    name: asset.name,
    url: asset.browser_download_url,
    size: asset.size,
    checksumUrl: checksum?.browser_download_url ?? null,
  };
}

/** Reads the hex digest from a `sha256sum`-style line ("<hex>  <file>"). */
export function parseChecksum(text: string): string | null {
  const match = /^([0-9a-fA-F]{64})(?:\s|$)/.exec(text.trim());
  return match ? match[1]!.toLowerCase() : null;
}
