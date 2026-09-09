import type {
  ContentBlock,
  InternalEvent,
  Session,
  SessionStats,
  TaskItem,
  TokenSummary,
  ToolInvocation,
  Turn,
} from "./types";
import {
  asNumber,
  asRecord,
  asString,
  compactSessionStats,
  fallbackTitle,
  humanizeSessionText,
  mapTaskStatus,
  previewText,
  wallMsFromIso,
} from "./util";

const CLAUDE_INTERNAL_TYPES = new Set([
  "attachment",
  "last-prompt",
  "mode",
  "permission-mode",
  "system",
  "file-history-snapshot",
  "atis-latch",
  "queue-operation",
  "file-history-delta",
  "cost-state",
  "ai-title",
]);

function messageContent(message: Record<string, unknown> | undefined): unknown {
  return message?.content;
}

function contentIsOnlyToolResults(content: unknown): boolean {
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.every((block) => asRecord(block)?.type === "tool_result");
}

function humanUserText(row: Record<string, unknown>): string | undefined {
  if (row.isMeta === true) return undefined;
  const origin = asRecord(row.origin);
  if (origin && origin.kind && origin.kind !== "human") return undefined;
  const message = asRecord(row.message);
  const content = messageContent(message);
  if (typeof content === "string" && content.trim()) return content;
  if (!Array.isArray(content)) return undefined;
  if (contentIsOnlyToolResults(content)) return undefined;
  const texts: string[] = [];
  for (const block of content) {
    const rec = asRecord(block);
    if (!rec) continue;
    if (rec.type === "tool_result") continue;
    if (rec.type === "text" && typeof rec.text === "string") texts.push(rec.text);
  }
  const joined = texts.join("\n").trim();
  return joined || undefined;
}

function parseAssistantBlocks(content: unknown): {
  blocks: ContentBlock[];
  tools: ToolInvocation[];
} {
  const blocks: ContentBlock[] = [];
  const tools: ToolInvocation[] = [];
  if (!Array.isArray(content)) return { blocks, tools };
  for (const block of content) {
    const rec = asRecord(block);
    if (!rec) continue;
    if (rec.type === "thinking" && typeof rec.thinking === "string") {
      blocks.push({ kind: "thinking", text: rec.thinking });
    } else if (rec.type === "text" && typeof rec.text === "string") {
      blocks.push({ kind: "text", text: rec.text });
    } else if (rec.type === "tool_use") {
      tools.push({
        id: asString(rec.id) ?? crypto.randomUUID(),
        name: asString(rec.name) ?? "tool",
        input: rec.input,
        isError: false,
      });
    }
  }
  return { blocks, tools };
}

function attachToolResults(
  toolsById: Map<string, ToolInvocation>,
  turnByToolId: Map<string, Turn>,
  content: unknown,
  structured: unknown,
  row: Record<string, unknown>,
  tasks: Map<string, TaskItem>,
  taskAliases: Map<string, string>,
) {
  if (!Array.isArray(content)) return;
  const resultBlocks = content
    .map(asRecord)
    .filter((block): block is Record<string, unknown> => Boolean(block && block.type === "tool_result"));
  const touched = new Set<Turn>();
  const struct = asRecord(structured);
  for (const block of resultBlocks) {
    const id = asString(block.tool_use_id);
    if (!id) continue;
    const tool = toolsById.get(id);
    if (!tool) continue;
    tool.isError = block.is_error === true;
    tool.result = {
      content: block.content,
      structured,
    };
    const turn = turnByToolId.get(id);
    if (turn && !touched.has(turn)) {
      turn.rawEvents = [...(turn.rawEvents ?? []), row];
      touched.add(turn);
    }
    if (tool.name === "TaskCreate") {
      const created = asRecord(struct?.task);
      const realId = asString(created?.id);
      const existing = tasks.get(taskAliases.get(id) ?? id) ?? tasks.get(id);
      if (existing && realId && realId !== existing.id) {
        tasks.delete(existing.id);
        existing.id = realId;
        tasks.set(realId, existing);
        taskAliases.set(id, realId);
      }
    }
  }
}

function applyClaudeTaskTool(
  tool: ToolInvocation,
  turn: Turn,
  tasks: Map<string, TaskItem>,
  aliases: Map<string, string>,
) {
  const input = asRecord(tool.input);
  if (tool.name === "TaskCreate") {
    const title = asString(input?.subject)?.trim() || "task";
    const item: TaskItem = {
      id: tool.id,
      title,
      status: "pending",
      originTurnId: turn.id,
    };
    tasks.set(item.id, item);
    return;
  }
  if (tool.name === "TaskUpdate") {
    const taskId = asString(input?.taskId);
    const status = mapTaskStatus(input?.status);
    if (!taskId || !status) return;
    const item = tasks.get(aliases.get(taskId) ?? taskId);
    if (item) item.status = status;
    return;
  }
  if (tool.name === "TaskStop") {
    const taskId = asString(input?.task_id) ?? asString(input?.taskId);
    if (!taskId) return;
    const item = tasks.get(aliases.get(taskId) ?? taskId);
    if (item) item.status = "cancelled";
  }
}

function addUsage(summary: TokenSummary, usage: Record<string, unknown> | undefined) {
  if (!usage) return;
  const input = asNumber(usage.input_tokens);
  const output = asNumber(usage.output_tokens);
  const cache = asNumber(usage.cache_read_input_tokens);
  if (input != null) summary.inputTokens = (summary.inputTokens ?? 0) + input;
  if (output != null) summary.outputTokens = (summary.outputTokens ?? 0) + output;
  if (cache != null) summary.cachedInputTokens = (summary.cachedInputTokens ?? 0) + cache;
  const total =
    (summary.inputTokens ?? 0) + (summary.outputTokens ?? 0);
  if (total) summary.totalTokens = total;
}

export function ingestClaude(
  rows: Record<string, unknown>[],
  filename: string,
  nowIso: string,
): Session {
  const turns: Turn[] = [];
  const internals: InternalEvent[] = [];
  const toolsById = new Map<string, ToolInvocation>();
  const turnByToolId = new Map<string, Turn>();
  const tokenSummary: TokenSummary = {};
  const stats: SessionStats = {};
  const tasks = new Map<string, TaskItem>();
  const taskAliases = new Map<string, string>();
  const turnsById = new Map<string, Turn>();
  let cwd: string | undefined;
  let gitBranch: string | undefined;
  let model: string | undefined;
  let startedAt: string | undefined;
  let endedAt: string | undefined;
  let sessionId: string | undefined;
  let aiTitle: string | undefined;
  let lastIncludedUuid: string | undefined;
  let internalIndex = 0;

  const pushInternal = (row: Record<string, unknown>, type: string, summary: string) => {
    internals.push({
      id: asString(row.uuid) ?? `internal-${internalIndex++}`,
      type,
      timestamp: asString(row.timestamp),
      summary,
      raw: row,
    });
  };

  for (const row of rows) {
    const type = asString(row.type) ?? "unknown";
    sessionId = asString(row.sessionId) ?? asString(row.session_id) ?? sessionId;
    if (!cwd) cwd = asString(row.cwd);
    if (!gitBranch) gitBranch = asString(row.gitBranch);
    const ts = asString(row.timestamp);
    if (!startedAt) startedAt = ts;
    if (ts) endedAt = ts;

    if (type === "ai-title") {
      aiTitle = asString(row.aiTitle) ?? aiTitle;
      pushInternal(row, type, previewText(asString(row.aiTitle) ?? "ai-title"));
      continue;
    }

    if (type === "cost-state") {
      const cost = asNumber(row.totalCostUSD);
      if (cost != null) tokenSummary.costUsd = cost;
      stats.apiMs = asNumber(row.totalAPIDuration) ?? stats.apiMs;
      stats.toolMs = asNumber(row.totalToolDuration) ?? stats.toolMs;
      stats.totalMs = asNumber(row.totalDuration) ?? stats.totalMs;
      stats.linesAdded = asNumber(row.totalLinesAdded) ?? stats.linesAdded;
      stats.linesRemoved = asNumber(row.totalLinesRemoved) ?? stats.linesRemoved;
      pushInternal(row, type, `cost ${cost ?? "?"}`);
      continue;
    }

    if (type === "system") {
      const subtype = asString(row.subtype);
      if (subtype === "turn_duration") {
        const durationMs = asNumber(row.durationMs);
        const parent = asString(row.parentUuid);
        if (durationMs != null && parent) {
          const parentTurn = turnsById.get(parent);
          if (parentTurn && parentTurn.durationMs == null) parentTurn.durationMs = durationMs;
        }
      }
      pushInternal(row, type, subtype ?? type);
      continue;
    }

    if (row.isSidechain === true && (type === "user" || type === "assistant")) {
      pushInternal(row, `${type}:sidechain`, "sidechain");
      continue;
    }

    if (type === "assistant") {
      const message = asRecord(row.message);
      const { blocks, tools } = parseAssistantBlocks(messageContent(message));
      const uuid = asString(row.uuid) ?? crypto.randomUUID();
      const parent = asString(row.parentUuid);
      let branchMarker: Turn["branchMarker"];
      if (parent && lastIncludedUuid && parent !== lastIncludedUuid) {
        branchMarker = "branch";
      }
      const turn: Turn = {
        id: uuid,
        timestamp: asString(row.timestamp),
        role: "assistant",
        blocks,
        tools,
        branchMarker,
        rawEvents: [row],
      };
      for (const tool of tools) {
        toolsById.set(tool.id, tool);
        turnByToolId.set(tool.id, turn);
        applyClaudeTaskTool(tool, turn, tasks, taskAliases);
      }
      const usage = asRecord(message?.usage);
      addUsage(tokenSummary, usage);
      model = asString(message?.model) ?? model;
      turns.push(turn);
      turnsById.set(uuid, turn);
      lastIncludedUuid = uuid;
      continue;
    }

    if (type === "user") {
      const message = asRecord(row.message);
      const content = messageContent(message);
      attachToolResults(toolsById, turnByToolId, content, row.toolUseResult, row, tasks, taskAliases);
      const text = humanUserText(row);
      if (!text) {
        if (row.isMeta === true) {
          pushInternal(row, "user:meta", previewText(stringifyMeta(content)));
        }
        continue;
      }
      const uuid = asString(row.uuid) ?? crypto.randomUUID();
      const parent = asString(row.parentUuid);
      let branchMarker: Turn["branchMarker"];
      if (parent && lastIncludedUuid && parent !== lastIncludedUuid) {
        branchMarker = "retry";
      }
      const userTurn: Turn = {
        id: uuid,
        timestamp: asString(row.timestamp),
        role: "user",
        blocks: [{ kind: "text", text }],
        tools: [],
        branchMarker,
        rawEvents: [row],
      };
      turns.push(userTurn);
      turnsById.set(uuid, userTurn);
      lastIncludedUuid = uuid;
      continue;
    }

    if (CLAUDE_INTERNAL_TYPES.has(type) || type === "unknown") {
      pushInternal(row, type, type);
      continue;
    }

    pushInternal(row, type, type);
  }

  const firstHuman = turns.find((turn) => turn.role === "user")?.blocks.find(
    (block) => block.kind === "text",
  )?.text;

  return {
    id: sessionId ?? crypto.randomUUID(),
    source: "claude-code",
    title: aiTitle?.trim() || humanizeSessionText(firstHuman ?? "") || fallbackTitle(filename),
    cwd,
    gitBranch,
    model,
    startedAt,
    importedAt: nowIso,
    lastOpenedAt: nowIso,
    tokenSummary: Object.keys(tokenSummary).length ? tokenSummary : undefined,
    stats: compactSessionStats({ ...stats, wallMs: wallMsFromIso(startedAt, endedAt) }),
    tasks: tasks.size ? [...tasks.values()] : undefined,
    turns,
    internals,
    skippedLineCount: 0,
    warnings: [],
  };
}

function stringifyMeta(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        const rec = asRecord(block);
        return asString(rec?.text) ?? "";
      })
      .join(" ");
  }
  return "meta";
}
