export function formatDuration(ms: number): string {
  if (ms < 1) return "<1 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined) return "?";
  return new Intl.NumberFormat().format(n);
}

export function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}

export const modKey = isMac() ? "⌘" : "Ctrl";
