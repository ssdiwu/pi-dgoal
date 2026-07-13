import { matchesKey } from "@earendil-works/pi-tui";

export function computeScrollOffset(
  data: string,
  currentOffset: number,
  totalLines: number,
  maxVisible: number,
): number | "exit" | null {
  const maxOffset = Math.max(0, totalLines - maxVisible);
  const page = 10;
  if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) return "exit";
  if (matchesKey(data, "down") || data === "j") return Math.min(currentOffset + 1, maxOffset);
  if (matchesKey(data, "up") || data === "k") return Math.max(currentOffset - 1, 0);
  if (matchesKey(data, "pageDown") || matchesKey(data, "ctrl+d")) return Math.min(currentOffset + page, maxOffset);
  if (matchesKey(data, "pageUp") || matchesKey(data, "ctrl+u")) return Math.max(currentOffset - page, 0);
  if (matchesKey(data, "end") || data === "G") return maxOffset;
  if (matchesKey(data, "home") || data === "g") return 0;
  return null;
}

export function truncateLine(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function ansiStrikethrough(value: string): string {
  return `\u001b[9m${value}\u001b[29m`;
}

export function formatElapsed(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const sec = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const min = totalMin % 60;
  const hr = Math.floor(totalMin / 60);
  if (hr > 0) return `${hr}h ${min}m ${sec}s`;
  if (totalMin > 0) return `${totalMin}m ${sec}s`;
  return `${sec}s`;
}
