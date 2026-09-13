"use client";

import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Turn } from "@/lib/ingest/types";
import { humanizeSessionText } from "@/lib/ingest/util";
import {
  formatClockTime,
  formatDayLabel,
  formatDurationMs,
  formatTurnTime,
  isToolOnlyTurn,
  sameCalendarDay,
} from "@/lib/display";
import { Wrench, User, Bot } from "lucide-react";

export type Filter = "all" | "user" | "tools" | "errors";

export function matchesFilter(turn: Turn, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "user") return turn.role === "user";
  if (filter === "tools") return turn.tools.length > 0;
  return turn.tools.some((t) => t.isError || (t.exitCode != null && t.exitCode !== 0));
}

function estimateRowSize(turn: Turn, showDay: boolean): number {
  let height = turn.role === "user" ? 76 : isToolOnlyTurn(turn) ? 44 : 62;
  if (showDay) height += 22;
  return height;
}

function turnPreview(turn: Turn): string {
  const text = turn.blocks.find((block) => block.kind === "text")?.text?.trim();
  if (text) return humanizeSessionText(text, 96);
  if (turn.tools.length) return turn.tools.map((tool) => tool.name).join(" · ");
  const thinking = turn.blocks.find((block) => block.kind === "thinking")?.text;
  return thinking ? humanizeSessionText(thinking, 72) : "";
}

function ToolChips({ tools }: { tools: Turn["tools"] }) {
  const shown = tools.slice(0, 2);
  const extra = tools.length - shown.length;
  return (
    <>
      {shown.map((tool) => {
        const toolFailed = tool.isError || (tool.exitCode != null && tool.exitCode !== 0);
        return (
          <span
            key={tool.id}
            className="tool-chip"
            style={{
              color: toolFailed ? "var(--danger)" : "var(--muted)",
              borderColor: toolFailed ? "var(--danger)" : "var(--line)",
            }}
          >
            {tool.name}
            {tool.durationMs != null ? ` ${formatDurationMs(tool.durationMs)}` : ""}
          </span>
        );
      })}
      {extra > 0 ? (
        <span className="tool-chip" style={{ color: "var(--faint)", borderColor: "var(--line)" }}>
          +{extra}
        </span>
      ) : null}
    </>
  );
}

export function Timeline({
  turns,
  filter,
  selectedId,
  onSelect,
}: {
  turns: Turn[];
  filter: Filter;
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const items = turns.filter((turn) => matchesFilter(turn, filter));
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const turn = items[index]!;
      const prev = items[index - 1];
      const showDay = Boolean(turn.timestamp && (!prev || !sameCalendarDay(prev.timestamp, turn.timestamp)));
      return estimateRowSize(turn, showDay);
    },
    getItemKey: (index) => items[index]!.id,
    measureElement: (el) => el.getBoundingClientRect().height,
    overscan: 12,
  });

  useEffect(() => {
    const idx = items.findIndex((t) => t.id === selectedId);
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only jump when selection changes
  }, [selectedId]);

  if (!items.length) {
    return (
      <div className="p-6 text-[13px]" style={{ color: "var(--muted)" }}>
        当前筛选没有回合。试试「全部」。
      </div>
    );
  }

  return (
    <div ref={parentRef} className="scrollbar-thin relative h-full overflow-auto">
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtual) => {
          const turn = items[virtual.index];
          const prev = items[virtual.index - 1];
          const selected = turn.id === selectedId;
          const failed = turn.tools.some((t) => t.isError || (t.exitCode != null && t.exitCode !== 0));
          const toolOnly = isToolOnlyTurn(turn);
          const tight = toolOnly && prev && isToolOnlyTurn(prev);
          const preview = turnPreview(turn);
          const clock = formatClockTime(turn.timestamp);
          const showDay = Boolean(turn.timestamp && (!prev || !sameCalendarDay(prev.timestamp, turn.timestamp)));
          const dayLabel = showDay ? formatDayLabel(turn.timestamp) : undefined;
          const fullTime = formatTurnTime(turn.timestamp);
          return (
            <button
              key={turn.id}
              type="button"
              ref={virtualizer.measureElement}
              data-index={virtual.index}
              onClick={() => onSelect(turn.id)}
              data-selected={selected}
              data-kind={turn.role === "user" ? "user" : toolOnly ? "tools" : "text"}
              data-tight={tight ? "true" : undefined}
              aria-current={selected ? "true" : undefined}
              aria-label={`${turn.role === "user" ? "用户" : "助手"}${clock ? ` ${clock}` : ""}`}
              className="timeline-row absolute left-0 right-0 flex w-full items-start gap-2 pr-3 pl-2 text-left"
              style={{
                transform: `translateY(${virtual.start}px)`,
                background: selected ? "var(--accent-dim)" : "transparent",
              }}
            >
              <span className="timeline-gutter mt-0.5" aria-hidden>
                <span className="timeline-sprocket" />
                <span className="timeline-pip" />
              </span>
              <span className="mt-0.5 shrink-0" style={{ color: failed ? "var(--danger)" : "var(--faint)" }}>
                {turn.role === "user" ? <User size={14} /> : toolOnly ? <Wrench size={14} /> : <Bot size={14} />}
              </span>
              <span className="min-w-0 flex-1">
                {dayLabel ? <span className="timeline-day">{dayLabel}</span> : null}
                <span className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--faint)" }}>
                  <span className="shrink-0">{turn.role === "user" ? "用户" : "助手"}</span>
                  {turn.branchMarker === "retry" ? (
                    <span className="shrink-0" style={{ color: "var(--accent)" }}>
                      重试
                    </span>
                  ) : null}
                  <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                    {toolOnly ? (
                      <ToolChips tools={turn.tools} />
                    ) : turn.tools.length ? (
                      <span className="truncate">· {turn.tools.length} 工具</span>
                    ) : null}
                  </span>
                  {clock ? (
                    <time className="timeline-clock" dateTime={turn.timestamp} title={fullTime}>
                      {clock}
                    </time>
                  ) : null}
                </span>
                {toolOnly ? null : (
                  <span
                    className="mt-0.5 block truncate text-[13px] leading-5"
                    style={{ fontWeight: turn.role === "user" ? 600 : 400 }}
                  >
                    {preview.replace(/\s+/g, " ")}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
