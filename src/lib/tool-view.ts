import type { ToolInvocation } from "./ingest/types";
import { asRecord, asString, stringifyUnknown } from "./ingest/util";

export type ToolKind = "bash" | "read" | "skill" | "write" | "edit" | "generic";

export function toolKind(name: string): ToolKind {
  const lower = name.toLowerCase();
  if (lower === "bash" || lower === "exec" || lower === "exec_command") return "bash";
  if (lower === "read") return "read";
  if (lower === "skill") return "skill";
  if (lower === "write") return "write";
  if (lower === "edit") return "edit";
  return "generic";
}

export type UnwrappedResult = {
  text?: string;
  stdout?: string;
  stderr?: string;
  interrupted?: boolean;
  file?: string;
  patch?: string;
};

function contentToText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const parts = content
    .map((item) => {
      if (typeof item === "string") return item;
      const rec = asRecord(item);
      return asString(rec?.text) ?? asString(rec?.content) ?? "";
    })
    .filter(Boolean);
  return parts.length ? parts.join("\n") : undefined;
}

function fromStructured(structured: Record<string, unknown>, fallbackText?: string): UnwrappedResult {
  const out: UnwrappedResult = {};
  if (typeof structured.stdout === "string") out.stdout = structured.stdout;
  if (typeof structured.stderr === "string") out.stderr = structured.stderr;
  if (structured.interrupted === true) out.interrupted = true;
  if (typeof structured.file === "string") out.file = structured.file;
  else {
    const file = asRecord(structured.file);
    if (file) {
      out.file = asString(file.content) ?? asString(file.text) ?? stringifyUnknown(structured.file);
    }
  }
  const patch =
    asString(structured.patch) ??
    asString(structured.diff) ??
    (Array.isArray(structured.structuredPatch) ? stringifyUnknown(structured.structuredPatch) : undefined);
  if (patch) out.patch = patch;
  if (fallbackText) out.text = fallbackText;
  else if (typeof structured.output === "string") out.text = structured.output;
  return out;
}

export function unwrapToolResult(result: unknown): UnwrappedResult {
  if (result == null) return {};
  if (typeof result === "string") return { text: result };

  const rec = asRecord(result);
  if (!rec) return { text: stringifyUnknown(result) };

  if ("content" in rec || "structured" in rec) {
    const structured = asRecord(rec.structured);
    const text = contentToText(rec.content);
    if (structured) return fromStructured(structured, text);
    return text ? { text } : {};
  }

  if (
    "stdout" in rec ||
    "stderr" in rec ||
    "file" in rec ||
    "patch" in rec ||
    "diff" in rec
  ) {
    return fromStructured(rec, contentToText(rec.content));
  }

  const text = contentToText(rec.text) ?? stringifyUnknown(result);
  return text ? { text } : {};
}

export function outputDisplayText(unwrapped: UnwrappedResult): string {
  const parts: string[] = [];
  if (unwrapped.stdout) parts.push(unwrapped.stdout);
  if (unwrapped.stderr) parts.push(unwrapped.stderr);
  if (unwrapped.file) parts.push(unwrapped.file);
  if (unwrapped.patch) parts.push(unwrapped.patch);
  if (!parts.length && unwrapped.text) parts.push(unwrapped.text);
  return parts.join("\n").trim();
}

export type ToolPresentation = {
  kind: ToolKind;
  headline: string;
  extra?: string;
  copyInputLabel: string;
  copyInputValue: string;
  copyOutputLabel?: string;
  copyOutputValue?: string;
  outputSections: { label: string; text: string }[];
};

export function presentTool(tool: ToolInvocation): ToolPresentation {
  const kind = toolKind(tool.name);
  const input = asRecord(tool.input);
  const unwrapped = unwrapToolResult(tool.result);
  const outputSections: { label: string; text: string }[] = [];
  if (unwrapped.stdout) outputSections.push({ label: "stdout", text: unwrapped.stdout });
  if (unwrapped.stderr) outputSections.push({ label: "stderr", text: unwrapped.stderr });
  if (unwrapped.file) outputSections.push({ label: "文件", text: unwrapped.file });
  if (unwrapped.patch) outputSections.push({ label: "补丁", text: unwrapped.patch });
  if (!outputSections.length && unwrapped.text) {
    outputSections.push({ label: "输出", text: unwrapped.text });
  }
  if (unwrapped.interrupted) {
    outputSections.push({ label: "状态", text: "已中断" });
  }

  const copyOutputValue = outputDisplayText(unwrapped) || undefined;

  if (kind === "bash") {
    const headline =
      asString(input?.command) ?? asString(input?.cmd) ?? stringifyUnknown(tool.input);
    return {
      kind,
      headline,
      copyInputLabel: "复制命令",
      copyInputValue: headline,
      copyOutputLabel: copyOutputValue ? "复制输出" : undefined,
      copyOutputValue,
      outputSections,
    };
  }

  if (kind === "read" || kind === "write" || kind === "edit") {
    const headline =
      asString(input?.file_path) ?? asString(input?.path) ?? stringifyUnknown(tool.input);
    return {
      kind,
      headline,
      copyInputLabel: "复制路径",
      copyInputValue: headline,
      copyOutputLabel: copyOutputValue ? "复制输出" : undefined,
      copyOutputValue,
      outputSections,
    };
  }

  if (kind === "skill") {
    const headline = asString(input?.skill) ?? asString(input?.name) ?? tool.name;
    const extra = asString(input?.args) ?? asString(input?.command);
    return {
      kind,
      headline,
      extra,
      copyInputLabel: "复制输入",
      copyInputValue: extra ? `${headline}\n${extra}` : headline,
      copyOutputLabel: copyOutputValue ? "复制输出" : undefined,
      copyOutputValue,
      outputSections,
    };
  }

  const headline =
    asString(input?.command) ??
    asString(input?.file_path) ??
    asString(input?.path) ??
    asString(input?.query) ??
    asString(input?.url) ??
    "";
  return {
    kind,
    headline,
    copyInputLabel: "复制输入",
    copyInputValue: stringifyUnknown(tool.input),
    copyOutputLabel: copyOutputValue ? "复制输出" : undefined,
    copyOutputValue,
    outputSections,
  };
}

export function rawEventLabel(event: unknown): string {
  const rec = asRecord(event);
  if (!rec) return "event";
  const type = asString(rec.type);
  const payload = asRecord(rec.payload);
  const payloadType = asString(payload?.type);
  const payloadRole = asString(payload?.role);
  if (type && payloadType && payloadRole) return `${type} · ${payloadType} · ${payloadRole}`;
  if (type && payloadType) return `${type} · ${payloadType}`;
  return type ?? "event";
}
