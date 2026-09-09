import type { Turn } from "./ingest/types";

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

export function importSummary(turns: Turn[]): string {
  const tools = turns.reduce((count, turn) => count + turn.tools.length, 0);
  return `已导入 · ${turns.length} 回合 · ${tools} 工具`;
}
