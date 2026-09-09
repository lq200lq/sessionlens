export const SIZE_WARN_BYTES = 50 * 1024 * 1024;
export const SIZE_REJECT_BYTES = 150 * 1024 * 1024;

export type SessionSource = "claude-code" | "codex";

export type TextBlock = { kind: "text"; text: string };
export type ThinkingBlock = { kind: "thinking"; text: string };
export type ContentBlock = TextBlock | ThinkingBlock;

export type ToolInvocation = {
  id: string;
  name: string;
  input: unknown;
  result?: unknown;
  isError: boolean;
  exitCode?: number;
  durationMs?: number;
};

export type Turn = {
  id: string;
  timestamp?: string;
  role: "user" | "assistant";
  blocks: ContentBlock[];
  tools: ToolInvocation[];
  branchMarker?: "branch" | "retry";
};

export type InternalEvent = {
  id: string;
  type: string;
  timestamp?: string;
  summary: string;
  raw: unknown;
};

export type TokenSummary = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  costUsd?: number;
};

export type Session = {
  id: string;
  source: SessionSource;
  title: string;
  cwd?: string;
  gitBranch?: string;
  model?: string;
  startedAt?: string;
  importedAt: string;
  lastOpenedAt: string;
  tokenSummary?: TokenSummary;
  turns: Turn[];
  internals: InternalEvent[];
  skippedLineCount: number;
  warnings: string[];
  subagent?: boolean;
};

export type IngestInput = {
  filename: string;
  text: string;
  byteLength: number;
};

export type IngestResult =
  | { ok: true; session: Session }
  | { ok: false; error: string };
