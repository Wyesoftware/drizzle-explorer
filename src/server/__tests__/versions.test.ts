import { describe, expect, test } from "bun:test";
import { compareVersions, matchAsset, parseChecksum } from "../versions";

describe("compareVersions", () => {
  test("orders dotted versions and ignores tag prefixes", () => {
    expect(compareVersions("v0.2.0", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("app-v1.0.0", "v1.0.0")).toBe(0);
    expect(compareVersions("0.1.0", "0.1.0.1")).toBeLessThan(0);
    expect(compareVersions("bun-v1.4.4", "1.4.3")).toBeGreaterThan(0);
  });
});

describe("matchAsset", () => {
  const assets = [
    { name: "drizzle-explorer-0.2.0-darwin-arm64.zip", browser_download_url: "https://x/darwin-arm64.zip", size: 10 },
    { name: "drizzle-explorer-0.2.0-darwin-arm64.zip.sha256", browser_download_url: "https://x/darwin-arm64.sha256", size: 1 },
    { name: "drizzle-explorer-0.2.0-linux-x64.tar.gz", browser_download_url: "https://x/linux-x64.tar.gz", size: 20 },
    { name: "drizzle-explorer-0.2.0-windows-x64.zip", browser_download_url: "https://x/windows-x64.zip", size: 30 },
  ];

  test("picks the asset for the platform/arch with its checksum", () => {
    expect(matchAsset(assets, "darwin", "arm64")).toEqual({
      name: "drizzle-explorer-0.2.0-darwin-arm64.zip",
      url: "https://x/darwin-arm64.zip",
      size: 10,
      checksumUrl: "https://x/darwin-arm64.sha256",
    });
  });

  test("returns null checksum when the companion file is missing", () => {
    expect(matchAsset(assets, "linux", "x64")?.checksumUrl).toBeNull();
    expect(matchAsset(assets, "windows", "x64")?.name).toBe("drizzle-explorer-0.2.0-windows-x64.zip");
  });

  test("does not match other platforms or stray files", () => {
    expect(matchAsset(assets, "linux", "arm64")).toBeNull();
    expect(matchAsset([{ name: "notes-darwin-arm64.zip", browser_download_url: "", size: 0 }], "darwin", "arm64")).toBeNull();
  });
});

describe("parseChecksum", () => {
  const hex = "a".repeat(64);
  test("reads sha256sum lines", () => {
    expect(parseChecksum(`${hex}  drizzle-explorer-0.2.0-darwin-arm64.zip\n`)).toBe(hex);
    expect(parseChecksum(hex.toUpperCase())).toBe(hex);
  });
  test("rejects malformed content", () => {
    expect(parseChecksum("not a checksum")).toBeNull();
    expect(parseChecksum(`${hex.slice(0, 63)}  file`)).toBeNull();
  });
});
