"use client";

import { useMemo, useState } from "react";
import type { ToolInvocation } from "@/lib/ingest/types";
import { stringifyUnknown } from "@/lib/ingest/util";
import { formatDurationMs } from "@/lib/display";
import { presentTool } from "@/lib/tool-view";
import { Check, Copy, ChevronRight } from "lucide-react";

export function CopyButton({ value, label = "复制" }: { value: unknown; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]"
      style={{ color: copied ? "var(--ok)" : "var(--muted)", border: "1px solid var(--line)" }}
      onClick={async () => {
        await navigator.clipboard.writeText(stringifyUnknown(value));
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? "已复制" : label}
    </button>
  );
}

function CodeBody({ value, language }: { value: unknown; language?: string }) {
  const text = stringifyUnknown(value);
  return (
    <div className="mt-2">
      {language ? (
        <div className="mb-1 text-[10px] tracking-wide" style={{ color: "var(--faint)" }}>
          {language}
        </div>
      ) : null}
      <pre
        className="max-h-[480px] overflow-auto rounded-md p-3 text-[12px] leading-5"
        style={{
          background: "var(--bg)",
          border: "1px solid var(--line)",
          fontFamily: "var(--font-mono), var(--mono)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {text}
      </pre>
    </div>
  );
}

function FoldSection({
  label,
  value,
  language,
}: {
  label: string;
  value: unknown;
  language?: string;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className="mt-2">
      <button
        type="button"
        className="flex items-center gap-1 text-[11px]"
        style={{ color: "var(--faint)" }}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRight size={12} className={`fold-chevron ${open ? "rotate-90" : ""}`} />
        {label}
      </button>
      <div className={`fold-grid ${open ? "fold-grid-open" : ""}`}>
        <div className="min-h-0 overflow-hidden">
          <CodeBody value={value} language={language} />
        </div>
      </div>
    </section>
  );
}

export function ToolCard({ tool }: { tool: ToolInvocation }) {
  const view = presentTool(tool);
  const failed = tool.isError || (tool.exitCode != null && tool.exitCode !== 0);
  const tone = failed ? "var(--danger)" : "var(--muted)";

  return (
    <div
      className="rounded-md p-3"
      style={{
        border: `1px solid ${failed ? "var(--danger)" : "var(--line)"}`,
        background: failed ? "var(--danger-dim)" : "var(--bg-elev)",
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="rounded px-1.5 py-0.5 text-[11px] font-medium"
            style={{
              fontFamily: "var(--font-mono), var(--mono)",
              color: tone,
              border: `1px solid ${tone}55`,
            }}
          >
            {tool.name}
          </span>
          {failed ? (
            <span className="text-[11px] font-medium" style={{ color: "var(--danger)" }}>
              失败{tool.exitCode != null ? ` · exit ${tool.exitCode}` : ""}
            </span>
          ) : (
            <span className="text-[11px]" style={{ color: "var(--faint)" }}>
              {tool.durationMs != null ? formatDurationMs(tool.durationMs) : "ok"}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          <CopyButton value={view.copyInputValue} label={view.copyInputLabel} />
          {view.copyOutputValue ? (
            <CopyButton value={view.copyOutputValue} label={view.copyOutputLabel ?? "复制输出"} />
          ) : null}
        </div>
      </div>

      {view.kind === "bash" ? (
        <CodeBody value={view.headline} language="shell" />
      ) : view.kind === "skill" ? (
        <div className="mt-2">
          <div className="text-[14px] font-medium" style={{ fontFamily: "var(--font-mono), var(--mono)" }}>
            {view.headline}
          </div>
          {view.extra ? (
            <p className="mt-1 text-[13px]" style={{ color: "var(--muted)" }}>
              {view.extra}
            </p>
          ) : null}
        </div>
      ) : view.kind === "read" || view.kind === "write" || view.kind === "edit" ? (
        <p
          className="mt-2 text-[12px] leading-5"
          style={{ fontFamily: "var(--font-mono), var(--mono)", color: "var(--muted)", wordBreak: "break-word" }}
        >
          {view.headline}
        </p>
      ) : view.headline ? (
        <p className="mt-2 text-[12px]" style={{ color: "var(--muted)", wordBreak: "break-word" }}>
          {view.headline}
        </p>
      ) : null}

      {view.kind === "generic" ? <FoldSection label="输入" value={tool.input} /> : null}

      {view.outputSections.map((section) => (
        <FoldSection
          key={section.label}
          label={section.label}
          value={section.text}
          language={view.kind === "bash" && section.label === "stdout" ? "output" : undefined}
        />
      ))}
    </div>
  );
}

function InlineText({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <p className="whitespace-pre-wrap">
      {parts.map((part, i) =>
        part.startsWith("`") && part.endsWith("`") && part.length >= 2 ? (
          <code
            key={i}
            className="rounded px-1 py-0.5 text-[12px]"
            style={{
              fontFamily: "var(--font-mono), var(--mono)",
              background: "var(--bg)",
              border: "1px solid var(--line)",
            }}
          >
            {part.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </p>
  );
}

export function RichText({ text }: { text: string }) {
  const chunks = useMemo(() => {
    const parts = text.split(/(```[\s\S]*?```)/g);
    return parts.filter((p) => p.length > 0);
  }, [text]);

  return (
    <div className="space-y-2 text-[13.5px] leading-6">
      {chunks.map((chunk, i) => {
        if (chunk.startsWith("```")) {
          const lang = chunk.match(/^```([a-zA-Z0-9_-]*)/)?.[1];
          const inner = chunk.replace(/^```[a-zA-Z0-9_-]*\n?/, "").replace(/```$/, "");
          return <CodeBody key={i} value={inner} language={lang || undefined} />;
        }
        return <InlineText key={i} text={chunk} />;
      })}
    </div>
  );
}
