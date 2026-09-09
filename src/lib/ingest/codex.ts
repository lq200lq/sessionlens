import type {
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
  parseDurationMs,
  wallMsFromIso,
} from "./util";

function collectText(content: unknown, wantedType: string): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const item of content) {
    const rec = asRecord(item);
    if (!rec) continue;
    if (rec.type === wantedType && typeof rec.text === "string") parts.push(rec.text);
    if (wantedType === "input_text" && rec.type === "text" && typeof rec.text === "string") {
      parts.push(rec.text);
    }
  }
  return parts.join("\n");
}

function outputText(output: unknown): unknown {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    const texts = output
      .map((item) => asRecord(item))
      .filter(Boolean)
      .map((item) => asString(item?.text) ?? "")
      .filter(Boolean);
    if (texts.length) return texts.join("\n");
  }
  return output;
}

function commandText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const joined = value.filter((part): part is string => typeof part === "string").join(" ").trim();
    return joined || undefined;
  }
  return undefined;
}

function applyUpdatePlan(input: unknown, turn: Turn): TaskItem[] | undefined {
  const rec = asRecord(input);
  const plan = rec?.plan;
  if (!Array.isArray(plan)) return undefined;
  const items: TaskItem[] = [];
  plan.forEach((entry, index) => {
    const row = asRecord(entry);
    if (!row) return;
    const title = asString(row.step)?.trim() ?? asString(row.text)?.trim();
    if (!title) return;
    items.push({
      id: asString(row.id) ?? `plan-${index}`,
      title,
      status: mapTaskStatus(row.status) ?? "pending",
      originTurnId: turn.id,
    });
  });
  return items;
}

function parseCommandHint(input: unknown): string | undefined {
  if (typeof input === "string") {
    const trimmed = input.trim();
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const rec = asRecord(parsed);
      return commandText(rec?.command) ?? commandText(rec?.cmd) ?? trimmed;
    } catch {
      return trimmed;
    }
  }
  const rec = asRecord(input);
  return commandText(rec?.command) ?? commandText(rec?.cmd);
}

export function ingestCodex(
  rows: Record<string, unknown>[],
  filename: string,
  nowIso: string,
): Session {
  const turns: Turn[] = [];
  const internals: InternalEvent[] = [];
  const toolsByCallId = new Map<string, ToolInvocation>();
  const turnByCallId = new Map<string, Turn>();
  let currentAssistant: Turn | undefined;
  let cwd: string | undefined;
  let gitBranch: string | undefined;
  let model: string | undefined;
  let startedAt: string | undefined;
  let endedAt: string | undefined;
  let sessionId: string | undefined;
  let subagent = false;
  let firstUserText: string | undefined;
  let internalIndex = 0;
  let abortedCount = 0;
  let lastTurnMs: number | undefined;
  let tasks: TaskItem[] | undefined;
  const tokenSummary: TokenSummary = {};
  const stats: SessionStats = {};
  const execCandidates: { command: string; exitCode?: number; durationMs?: number; ts?: string }[] =
    [];
  const mcpCandidates: { name: string; durationMs?: number }[] = [];

  const pushInternal = (
    row: Record<string, unknown>,
    type: string,
    summary: string,
  ) => {
    internals.push({
      id: `internal-${internalIndex++}`,
      type,
      timestamp: asString(row.timestamp),
      summary,
      raw: row,
    });
  };

  const ensureAssistant = (timestamp?: string): Turn => {
    if (currentAssistant) return currentAssistant;
    const turn: Turn = {
      id: crypto.randomUUID(),
      timestamp,
      role: "assistant",
      blocks: [],
      tools: [],
      rawEvents: [],
    };
    turns.push(turn);
    currentAssistant = turn;
    return turn;
  };

  const pushRaw = (turn: Turn, event: unknown) => {
    turn.rawEvents = [...(turn.rawEvents ?? []), event];
  };

  for (const row of rows) {
    const type = asString(row.type) ?? "unknown";
    const payload = asRecord(row.payload) ?? {};
    const ts = asString(row.timestamp);
    if (!startedAt) startedAt = ts;
    if (ts) endedAt = ts;

    if (type === "session_meta") {
      sessionId = asString(payload.id) ?? asString(payload.session_id) ?? sessionId;
      cwd = asString(payload.cwd) ?? cwd;
      const git = asRecord(payload.git);
      gitBranch = asString(git?.branch) ?? gitBranch;
      if (payload.parent_thread_id || asRecord(payload.source)?.subagent) {
        subagent = true;
      }
      pushInternal(row, "session_meta", "session_meta");
      continue;
    }

    if (type === "turn_context") {
      model = asString(payload.model) ?? model;
      cwd = asString(payload.cwd) ?? cwd;
      pushInternal(row, "turn_context", asString(payload.model) ?? "turn_context");
      continue;
    }

    if (type === "token_usage_record") {
      const usage = asRecord(payload.thread_token_usage) ?? asRecord(payload.usage);
      if (usage) {
        tokenSummary.inputTokens = asNumber(usage.input_tokens) ?? tokenSummary.inputTokens;
        tokenSummary.outputTokens = asNumber(usage.output_tokens) ?? tokenSummary.outputTokens;
        tokenSummary.totalTokens = asNumber(usage.total_tokens) ?? tokenSummary.totalTokens;
        tokenSummary.cachedInputTokens =
          asNumber(usage.cached_input_tokens) ?? tokenSummary.cachedInputTokens;
      }
      pushInternal(row, "token_usage_record", "tokens");
      continue;
    }

    if (type === "event_msg") {
      const payloadType = asString(payload.type) ?? "event_msg";
      if (payloadType === "token_count") {
        const info = asRecord(payload.info);
        const total = asRecord(info?.total_token_usage);
        if (total) {
          tokenSummary.inputTokens = asNumber(total.input_tokens) ?? tokenSummary.inputTokens;
          tokenSummary.outputTokens = asNumber(total.output_tokens) ?? tokenSummary.outputTokens;
          tokenSummary.totalTokens = asNumber(total.total_tokens) ?? tokenSummary.totalTokens;
          tokenSummary.cachedInputTokens =
            asNumber(total.cached_input_tokens) ?? tokenSummary.cachedInputTokens;
        }
      }
      if (payloadType === "item_completed") {
        const item = asRecord(payload.item);
        if (item?.type === "CommandExecution") {
          execCandidates.push({
            command: commandText(item.command) ?? "",
            exitCode: asNumber(item.exit_code),
            durationMs: parseDurationMs(item.duration) ?? parseDurationMs(item.duration_ms),
            ts,
          });
        }
        if (item?.type === "McpToolCall") {
          const name = asString(item.tool) ?? asString(item.name);
          if (name) {
            mcpCandidates.push({
              name,
              durationMs: parseDurationMs(item.duration) ?? parseDurationMs(item.duration_ms),
            });
          }
        }
      }
      if (payloadType === "task_complete") {
        lastTurnMs = parseDurationMs(payload.duration_ms) ?? lastTurnMs;
      }
      if (payloadType === "turn_aborted") {
        abortedCount += 1;
      }
      pushInternal(row, `event_msg:${payloadType}`, payloadType);
      continue;
    }

    if (type !== "response_item") {
      pushInternal(row, type, type);
      continue;
    }

    const payloadType = asString(payload.type) ?? "unknown";

    if (payloadType === "message") {
      const role = asString(payload.role);
      if (role === "developer") {
        pushInternal(row, "developer", "developer");
        continue;
      }
      if (role === "user") {
        currentAssistant = undefined;
        const text = collectText(payload.content, "input_text");
        if (!firstUserText && text.trim()) firstUserText = text;
        turns.push({
          id: asString(payload.id) ?? crypto.randomUUID(),
          timestamp: ts,
          role: "user",
          blocks: text ? [{ kind: "text", text }] : [],
          tools: [],
          rawEvents: [row],
        });
        continue;
      }
      if (role === "assistant") {
        const text = collectText(payload.content, "output_text");
        const turn = ensureAssistant(ts);
        pushRaw(turn, row);
        if (text) turn.blocks.push({ kind: "text", text });
        continue;
      }
      pushInternal(row, `message:${role ?? "?"}`, "message");
      continue;
    }

    if (payloadType === "reasoning") {
      const turn = ensureAssistant(ts);
      pushRaw(turn, row);
      const summary = payload.summary;
      let thinking = "";
      if (Array.isArray(summary)) {
        thinking = summary
          .map((item) => asRecord(item))
          .map((item) => (item?.type === "summary_text" ? asString(item.text) : undefined))
          .filter(Boolean)
          .join("\n");
      }
      if (thinking) turn.blocks.push({ kind: "thinking", text: thinking });
      continue;
    }

    if (payloadType === "function_call" || payloadType === "custom_tool_call") {
      const turn = ensureAssistant(ts);
      pushRaw(turn, row);
      const callId = asString(payload.call_id) ?? asString(payload.id) ?? crypto.randomUUID();
      let input: unknown = payloadType === "custom_tool_call" ? payload.input : payload.arguments;
      if (typeof input === "string") {
        try {
          input = JSON.parse(input);
        } catch {
          /* keep string */
        }
      }
      const tool: ToolInvocation = {
        id: callId,
        name: asString(payload.name) ?? "tool",
        input,
        isError: false,
      };
      turn.tools.push(tool);
      toolsByCallId.set(callId, tool);
      turnByCallId.set(callId, turn);
      if (tool.name === "update_plan") {
        const next = applyUpdatePlan(input, turn);
        if (next) tasks = next;
      }
      continue;
    }

    if (
      payloadType === "function_call_output" ||
      payloadType === "custom_tool_call_output"
    ) {
      const callId = asString(payload.call_id);
      if (callId && toolsByCallId.has(callId)) {
        const tool = toolsByCallId.get(callId)!;
        tool.result = outputText(payload.output);
        const owner = turnByCallId.get(callId);
        if (owner) pushRaw(owner, row);
      } else {
        pushInternal(row, payloadType, "unpaired tool output");
      }
      continue;
    }

    pushInternal(row, `response_item:${payloadType}`, payloadType);
  }

  for (const tool of toolsByCallId.values()) {
    if (tool.name === "exec" || tool.name === "exec_command") {
      const hint = parseCommandHint(tool.input);
      if (hint) {
        const match = execCandidates.find(
          (candidate) =>
            candidate.command &&
            (candidate.command === hint || candidate.command.includes(hint) || hint.includes(candidate.command)),
        );
        if (match) {
          if (match.exitCode != null) {
            tool.exitCode = match.exitCode;
            if (match.exitCode !== 0) tool.isError = true;
          }
          if (match.durationMs != null) tool.durationMs = match.durationMs;
        }
      }
    }
    if (tool.durationMs == null) {
      const mcpIndex = mcpCandidates.findIndex(
        (candidate) =>
          candidate.durationMs != null &&
          (candidate.name === tool.name || tool.name.endsWith(candidate.name) || tool.name.includes(candidate.name)),
      );
      if (mcpIndex >= 0) {
        tool.durationMs = mcpCandidates[mcpIndex]?.durationMs;
        mcpCandidates.splice(mcpIndex, 1);
      }
    }
  }

  if (abortedCount) stats.abortedCount = abortedCount;
  if (lastTurnMs != null) stats.lastTurnMs = lastTurnMs;

  return {
    id: sessionId ?? crypto.randomUUID(),
    source: "codex",
    title: humanizeSessionText(firstUserText ?? "") || fallbackTitle(filename),
    cwd,
    gitBranch,
    model,
    startedAt,
    importedAt: nowIso,
    lastOpenedAt: nowIso,
    tokenSummary: Object.keys(tokenSummary).length ? tokenSummary : undefined,
    stats: compactSessionStats({ ...stats, wallMs: wallMsFromIso(startedAt, endedAt) }),
    tasks: tasks?.length ? tasks : undefined,
    turns,
    internals,
    skippedLineCount: 0,
    warnings: [],
    subagent,
  };
}
