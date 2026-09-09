import type { ToolInvocation, Turn } from "./ingest/types";

export function initialTurnId(turns: Turn[]): string | undefined {
  const user = turns.find((turn) => turn.role === "user");
  if (user) return user.id;
  const withText = turns.find((turn) =>
    turn.blocks.some((block) => block.kind === "text" && block.text.trim()),
  );
  return withText?.id ?? turns[0]?.id;
}

export function parseTurnDate(iso?: string): Date | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function formatTurnTime(iso?: string): string | undefined {
  const date = parseTurnDate(iso);
  if (!date) return iso;
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date);
}

/** Compact clock for the timeline: local hour, minute, second. */
export function formatClockTime(iso?: string): string | undefined {
  const date = parseTurnDate(iso);
  if (!date) return undefined;
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function sameCalendarDay(a?: string, b?: string): boolean {
  const left = parseTurnDate(a);
  const right = parseTurnDate(b);
  if (!left || !right) return false;
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export function formatDayLabel(iso?: string): string | undefined {
  const date = parseTurnDate(iso);
  if (!date) return undefined;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

export function isToolOnlyTurn(turn: Turn): boolean {
  if (turn.role !== "assistant" || turn.tools.length === 0) return false;
  return !turn.blocks.some((block) => block.kind === "text" && block.text.trim());
}

export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) {
    const seconds = ms / 1000;
    const rounded = seconds >= 10 ? Math.round(seconds) : Math.round(seconds * 10) / 10;
    return `${rounded}s`;
  }
  const totalSec = Math.round(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function isFailedTool(tool: ToolInvocation): boolean {
  return tool.isError || (tool.exitCode != null && tool.exitCode !== 0);
}

export function errorToolCount(turns: Turn[]): number {
  return turns.reduce(
    (count, turn) => count + turn.tools.filter(isFailedTool).length,
    0,
  );
}

export function slowestToolMs(turns: Turn[]): number | undefined {
  let max: number | undefined;
  for (const turn of turns) {
    for (const tool of turn.tools) {
      if (tool.durationMs == null) continue;
      if (max == null || tool.durationMs > max) max = tool.durationMs;
    }
  }
  return max;
}

export function importSummary(turns: Turn[]): string {
  const tools = turns.reduce((count, turn) => count + turn.tools.length, 0);
  return `已导入 · ${turns.length} 回合 · ${tools} 工具`;
}
