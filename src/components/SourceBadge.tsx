import type { SessionSource } from "@/lib/ingest/types";

export function SourceBadge({ source, subagent }: { source: SessionSource; subagent?: boolean }) {
  const label = source === "claude-code" ? "Claude Code" : "Codex";
  const color = source === "claude-code" ? "var(--claude)" : "var(--codex)";
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium tracking-wide">
      <span
        className="rounded px-1.5 py-0.5"
        style={{ color, background: `${color}22`, border: `1px solid ${color}44` }}
      >
        {label}
      </span>
      {subagent ? (
        <span className="rounded px-1.5 py-0.5 text-[11px]" style={{ color: "var(--muted)", border: "1px solid var(--line)" }}>
          子 agent
        </span>
      ) : null}
    </span>
  );
}
