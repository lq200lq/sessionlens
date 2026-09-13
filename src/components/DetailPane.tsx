"use client";

import { useMemo, useState } from "react";
import type { Session, TaskItem, TaskStatus, Turn } from "@/lib/ingest/types";
import { parseSlashCommand, stringifyUnknown, type SlashCommand } from "@/lib/ingest/util";
import { errorToolCount, formatDurationMs, formatTurnTime, slowestToolMs } from "@/lib/display";
import { rawEventLabel } from "@/lib/tool-view";
import { CopyButton, RichText, ToolCard } from "./Blocks";
import { ChevronDown } from "lucide-react";

type DetailView = "reading" | "original";

export function DetailPane({ turn }: { turn?: Turn }) {
  if (!turn) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-[13px]" style={{ color: "var(--muted)" }}>
        在左侧选择一个回合。
      </div>
    );
  }

  return <DetailBody key={turn.id} turn={turn} />;
}

function DetailBody({ turn }: { turn: Turn }) {
  const [view, setView] = useState<DetailView>("reading");
  const textBlocks = turn.blocks.filter((block) => block.kind === "text");
  const thinkingBlocks = turn.blocks.filter((block) => block.kind === "thinking");
  const empty = textBlocks.length === 0 && turn.tools.length === 0 && thinkingBlocks.length === 0;
  const slash =
    turn.role === "user" && textBlocks[0]?.kind === "text" ? parseSlashCommand(textBlocks[0].text) : undefined;

  return (
    <div className="scrollbar-thin h-full overflow-auto p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] uppercase tracking-wider" style={{ color: "var(--faint)" }}>
          {turn.role === "user" ? "用户" : "助手"}
          {turn.timestamp ? ` · ${formatTurnTime(turn.timestamp)}` : ""}
        </div>
        <div
          className="inline-flex rounded-md border p-0.5"
          style={{ borderColor: "var(--line)" }}
          role="tablist"
          aria-label="详情视图"
        >
          <ViewTab current={view} id="reading" label="阅读" onSelect={setView} />
          <ViewTab current={view} id="original" label="原格式" onSelect={setView} />
        </div>
      </div>
      {view === "original" ? (
        <OriginalView events={turn.rawEvents} />
      ) : (
        <div className="space-y-4">
          {thinkingBlocks.map((block, i) =>
            block.kind === "thinking" ? <Thinking key={`think-${i}`} text={block.text} /> : null,
          )}
          {slash ? (
            <SlashCommandView command={slash} />
          ) : (
            textBlocks.map((block, i) => (block.kind === "text" ? <RichText key={`text-${i}`} text={block.text} /> : null))
          )}
          {turn.tools.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
          {empty ? (
            <p className="text-[13px]" style={{ color: "var(--muted)" }}>
              这一步没有正文。
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ViewTab({
  current,
  id,
  label,
  onSelect,
}: {
  current: DetailView;
  id: DetailView;
  label: string;
  onSelect: (id: DetailView) => void;
}) {
  const selected = current === id;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={() => onSelect(id)}
      className="rounded px-2 py-1 text-[12px]"
      style={{
        background: selected ? "var(--accent-dim)" : "transparent",
        color: selected ? "var(--accent)" : "var(--muted)",
      }}
    >
      {label}
    </button>
  );
}

function OriginalView({ events }: { events?: unknown[] }) {
  if (!events?.length) {
    return (
      <p className="text-[13px]" style={{ color: "var(--muted)" }}>
        这一回合没有保留原始事件。
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {events.map((event, index) => {
        const json = stringifyUnknown(event);
        return (
          <section key={index}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-[11px] tracking-wide" style={{ color: "var(--faint)", fontFamily: "var(--font-mono), var(--mono)" }}>
                {rawEventLabel(event)}
              </div>
              <CopyButton value={json} />
            </div>
            <pre
              className="max-h-[640px] overflow-auto rounded-md p-3 text-[12px] leading-5"
              style={{
                background: "var(--bg-elev)",
                border: "1px solid var(--line)",
                fontFamily: "var(--font-mono), var(--mono)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {json}
            </pre>
          </section>
        );
      })}
    </div>
  );
}

function SlashCommandView({ command }: { command: SlashCommand }) {
  return (
    <div className="rounded-md p-3" style={{ border: "1px solid var(--line)", background: "var(--bg-elev)" }}>
      <div className="text-[15px] font-medium" style={{ fontFamily: "var(--font-mono), var(--mono)" }}>
        {command.name}
      </div>
      {command.message && command.message !== command.name.replace(/^\//, "") ? (
        <p className="mt-1 text-[13px]" style={{ color: "var(--muted)" }}>
          {command.message}
        </p>
      ) : null}
      {command.args ? (
        <pre
          className="mt-2 overflow-auto text-[12px] leading-5"
          style={{
            fontFamily: "var(--font-mono), var(--mono)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            color: "var(--muted)",
          }}
        >
          {command.args}
        </pre>
      ) : null}
    </div>
  );
}

function Thinking({ text }: { text: string }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-md" style={{ border: "1px solid var(--line)" }}>
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px]"
        style={{ color: "var(--muted)" }}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronDown size={14} className={`fold-chevron ${open ? "" : "-rotate-90"}`} />
        推理
      </button>
      <div className={`fold-grid ${open ? "fold-grid-open" : ""}`}>
        <div className="min-h-0 overflow-hidden">
          <div className="px-3 pb-3 text-[13px]" style={{ color: "var(--muted)" }}>
            <RichText text={text} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Chip({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <span
      className="inline-flex max-w-full items-baseline gap-1.5 truncate"
      title={title ?? value}
    >
      <span style={{ color: "var(--faint)" }}>{label}</span>
      <span className="truncate" style={{ fontFamily: label === "目录" || label === "分支" ? "var(--font-mono), var(--mono)" : undefined }}>
        {value}
      </span>
    </span>
  );
}

export function SummaryBar({ session }: { session: Session }) {
  const chips = useMemo(() => {
    const items: { label: string; value: string; title?: string }[] = [];
    if (session.cwd) items.push({ label: "目录", value: session.cwd, title: session.cwd });
    if (session.gitBranch) items.push({ label: "分支", value: session.gitBranch });
    if (session.model) items.push({ label: "模型", value: session.model });
    const tok = session.tokenSummary;
    if (tok?.totalTokens) items.push({ label: "tokens", value: String(tok.totalTokens) });
    else if (tok?.inputTokens || tok?.outputTokens) {
      items.push({ label: "tokens", value: `${tok.inputTokens ?? 0}→${tok.outputTokens ?? 0}` });
    }
    if (tok?.costUsd != null) items.push({ label: "费用", value: `$${tok.costUsd}` });
    const wall = session.stats?.wallMs ?? session.stats?.totalMs;
    if (wall) items.push({ label: "时长", value: formatDurationMs(wall) });
    const errors = errorToolCount(session.turns);
    if (errors) items.push({ label: "失败", value: `${errors} 次工具` });
    const added = session.stats?.linesAdded;
    const removed = session.stats?.linesRemoved;
    if (added || removed) {
      items.push({
        label: "改动",
        value: `${added ? `+${added}` : ""}${added && removed ? " " : ""}${removed ? `-${removed}` : ""}`,
      });
    }
    if (session.stats?.abortedCount) {
      items.push({ label: "中止", value: `${session.stats.abortedCount} 轮` });
    }
    const slowest = slowestToolMs(session.turns);
    if (slowest) items.push({ label: "最慢工具", value: formatDurationMs(slowest) });
    if (session.subagent) items.push({ label: "类型", value: "子 agent" });
    if (session.skippedLineCount) items.push({ label: "跳过", value: `${session.skippedLineCount} 行` });
    return items;
  }, [session]);

  if (!chips.length) return null;
  return (
    <div
      className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-[11px]"
      style={{ color: "var(--muted)" }}
    >
      {chips.map((chip) => (
        <Chip key={`${chip.label}-${chip.value}`} {...chip} />
      ))}
    </div>
  );
}

const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "待办",
  in_progress: "进行中",
  completed: "完成",
  cancelled: "已取消",
};

export function TaskPanel({
  tasks,
  selectedTurnId,
  onSelectTurn,
}: {
  tasks: TaskItem[];
  selectedTurnId?: string;
  onSelectTurn: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  if (!tasks.length) return null;
  return (
    <div className="shrink-0 border-t px-3 py-1.5" style={{ borderColor: "var(--line)", background: "var(--bg-elev)" }}>
      <button
        type="button"
        className="flex w-full items-center gap-1.5 text-[11px] uppercase tracking-wider"
        style={{ color: "var(--faint)" }}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronDown size={14} className={`fold-chevron ${open ? "" : "-rotate-90"}`} />
        任务 {tasks.length}
      </button>
      <div className={`fold-grid ${open ? "fold-grid-open" : ""}`}>
        <div className="min-h-0 overflow-hidden">
          <ul className="scrollbar-thin mt-1 max-h-[min(12rem,32vh)] space-y-0.5 overflow-auto">
        {tasks.map((task) => {
          const active = Boolean(task.originTurnId && task.originTurnId === selectedTurnId);
          const clickable = Boolean(task.originTurnId);
          const tone =
            task.status === "in_progress"
              ? "var(--accent)"
              : task.status === "cancelled"
                ? "var(--danger)"
                : "var(--muted)";
          return (
            <li key={task.id}>
              <button
                type="button"
                disabled={!clickable}
                onClick={() => {
                  if (task.originTurnId) onSelectTurn(task.originTurnId);
                }}
                className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-[12px]"
                style={{
                  background: active ? "var(--accent-dim)" : "transparent",
                  color: tone,
                  cursor: clickable ? "pointer" : "default",
                }}
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{
                    background:
                      task.status === "completed"
                        ? "var(--ok)"
                        : task.status === "in_progress"
                          ? "var(--accent)"
                          : task.status === "cancelled"
                            ? "var(--danger)"
                            : "var(--faint)",
                  }}
                />
                <span className="min-w-0 flex-1 truncate" style={{ color: "var(--text)" }}>
                  {task.title}
                </span>
                <span className="shrink-0 text-[11px]" style={{ color: "var(--faint)" }}>
                  {TASK_STATUS_LABEL[task.status]}
                </span>
              </button>
            </li>
          );
        })}
          </ul>
        </div>
      </div>
    </div>
  );
}
