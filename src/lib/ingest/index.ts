import { ingestClaude } from "./claude";
import { ingestCodex } from "./codex";
import type { IngestInput, IngestResult } from "./types";
import { SIZE_REJECT_BYTES, SIZE_WARN_BYTES } from "./types";
import { detectSource, parseJsonl } from "./util";

const UNKNOWN_FORMAT = "不是已知会话格式";

export function ingestSessionLog(input: IngestInput): IngestResult {
  if (input.byteLength > SIZE_REJECT_BYTES) {
    return { ok: false, error: "文件超过 150MB，已拒绝在浏览器中打开" };
  }

  const warnings: string[] = [];
  if (input.byteLength > SIZE_WARN_BYTES) {
    warnings.push("文件超过 50MB，解析可能占用较多内存");
  }

  const { rows, skipped } = parseJsonl(input.text);
  if (rows.length === 0) {
    return {
      ok: false,
      error: skipped ? "文件没有可解析的 JSON 行" : UNKNOWN_FORMAT,
    };
  }

  const source = detectSource(rows);
  if (source === "unknown") {
    return { ok: false, error: UNKNOWN_FORMAT };
  }

  const nowIso = new Date().toISOString();
  const session =
    source === "claude-code"
      ? ingestClaude(rows, input.filename, nowIso)
      : ingestCodex(rows, input.filename, nowIso);

  session.skippedLineCount = skipped;
  session.warnings = warnings;
  if (skipped) {
    session.warnings = [...warnings, `已跳过 ${skipped} 行无法解析的内容`];
  }

  if (session.turns.length === 0 && source === "claude-code") {
    return { ok: false, error: UNKNOWN_FORMAT };
  }

  return { ok: true, session };
}
