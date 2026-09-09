"use client";

import { useMemo, useState } from "react";
import type { ToolInvocation } from "@/lib/ingest/types";
import { isLongPayload, stringifyUnknown } from "@/lib/ingest/util";
import { Check, Copy, ChevronRight } from "lucide-react";

function CopyButton({ value }: { value: unknown }) {
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
      {copied ? "已复制" : "复制"}
    </button>
  );
}

function CodeBody({ value }: { value: unknown }) {
  const text = stringifyUnknown(value);
  return (
    <pre
      className="mt-2 max-h-[480px] overflow-auto rounded-md p-3 text-[12px] leading-5"
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
  );
}

function toolSummary(tool: ToolInvocation): string {
  const input = tool.input;
  if (input && typeof input === "object") {
    const rec = input as Record<string, unknown>;
    if (typeof rec.command === "string") return rec.command;
    if (typeof rec.file_path === "string") return rec.file_path;
    if (typeof rec.path === "string") return rec.path;
  }
  if (typeof input === "string") return input.slice(0, 120);
  return stringifyUnknown(input).slice(0, 120);
}

export function ToolCard({ tool }: { tool: ToolInvocation }) {
  const longInput = isLongPayload(tool.input);
  const longResult = tool.result !== undefined && isLongPayload(tool.result);
  const [openIn, setOpenIn] = useState(!longInput);
  const [openOut, setOpenOut] = useState(!longResult);
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
              {tool.durationMs != null ? `${tool.durationMs}ms` : "ok"}
            </span>
          )}
        </div>
        <div className="flex gap-1">
          <CopyButton value={tool.input} />
          {tool.result !== undefined ? <CopyButton value={tool.result} /> : null}
        </div>
      </div>
      <p className="mt-2 text-[12px]" style={{ color: "var(--muted)" }}>
        {toolSummary(tool)}
      </p>
      <section className="mt-2">
        <button
          type="button"
          className="flex items-center gap-1 text-[11px]"
          style={{ color: "var(--faint)" }}
          onClick={() => setOpenIn((v) => !v)}
        >
          <ChevronRight size={12} className={openIn ? "rotate-90" : ""} />
          输入
        </button>
        {openIn ? <CodeBody value={tool.input} /> : null}
      </section>
      {tool.result !== undefined ? (
        <section className="mt-2">
          <button
            type="button"
            className="flex items-center gap-1 text-[11px]"
            style={{ color: "var(--faint)" }}
            onClick={() => setOpenOut((v) => !v)}
          >
            <ChevronRight size={12} className={openOut ? "rotate-90" : ""} />
            输出
          </button>
          {openOut ? <CodeBody value={tool.result} /> : null}
        </section>
      ) : null}
    </div>
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
          const inner = chunk.replace(/^```[a-zA-Z0-9_-]*\n?/, "").replace(/```$/, "");
          return (
            <pre
              key={i}
              className="overflow-auto rounded-md p-3 text-[12px]"
              style={{
                background: "var(--bg)",
                border: "1px solid var(--line)",
                fontFamily: "var(--font-mono), var(--mono)",
                whiteSpace: "pre-wrap",
              }}
            >
              {inner}
            </pre>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap">
            {chunk}
          </p>
        );
      })}
    </div>
  );
}
