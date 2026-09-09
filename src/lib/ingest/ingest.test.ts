import { describe, expect, it } from "vitest";
import { ingestSessionLog } from "./index";
import { SIZE_REJECT_BYTES, SIZE_WARN_BYTES } from "./types";

function jsonl(rows: unknown[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n");
}

function ingest(rows: unknown[], filename = "session.jsonl", byteLength?: number) {
  const text = jsonl(rows);
  return ingestSessionLog({
    filename,
    text,
    byteLength: byteLength ?? new TextEncoder().encode(text).length,
  });
}

describe("ingestSessionLog", () => {
  it("rejects history.jsonl shaped files", () => {
    const result = ingest([
      {
        display: "hello",
        project: "/tmp",
        sessionId: "abc",
        timestamp: 1,
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("不是已知会话格式");
  });

  it("rejects empty files", () => {
    const result = ingestSessionLog({ filename: "a.jsonl", text: "\n\n", byteLength: 2 });
    expect(result.ok).toBe(false);
  });

  it("ingests a Claude user/assistant transcript", () => {
    const result = ingest([
      {
        type: "user",
        uuid: "u1",
        sessionId: "sid",
        timestamp: "2026-01-01T00:00:00Z",
        cwd: "/Users/q/proj",
        gitBranch: "main",
        origin: { kind: "human" },
        message: { role: "user", content: "Fix the tests" },
      },
      {
        type: "assistant",
        uuid: "a1",
        parentUuid: "u1",
        sessionId: "sid",
        timestamp: "2026-01-01T00:00:01Z",
        message: {
          role: "assistant",
          model: "deepseek-v4-flash",
          content: [{ type: "text", text: "Looking." }],
          usage: { input_tokens: 10, output_tokens: 4 },
        },
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.source).toBe("claude-code");
    expect(result.session.id).toBe("sid");
    expect(result.session.title).toContain("Fix the tests");
    expect(result.session.turns).toHaveLength(2);
    expect(result.session.turns[0]?.rawEvents).toHaveLength(1);
    expect(result.session.turns[1]?.rawEvents).toHaveLength(1);
    expect(result.session.model).toBe("deepseek-v4-flash");
    expect(result.session.tokenSummary?.inputTokens).toBe(10);
  });

  it("pairs Claude tool_use with tool_result and hides tool_result as a user turn", () => {
    const result = ingest([
      {
        type: "user",
        uuid: "u1",
        sessionId: "sid",
        origin: { kind: "human" },
        message: { role: "user", content: "run it" },
      },
      {
        type: "assistant",
        uuid: "a1",
        parentUuid: "u1",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "plan" },
            {
              type: "tool_use",
              id: "toolu_1",
              name: "Bash",
              input: { command: "ls" },
            },
          ],
        },
      },
      {
        type: "user",
        uuid: "u2",
        parentUuid: "a1",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_1",
              is_error: true,
              content: "boom",
            },
          ],
        },
        toolUseResult: { stdout: "", stderr: "boom" },
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.turns.filter((t) => t.role === "user")).toHaveLength(1);
    const assistant = result.session.turns.find((t) => t.role === "assistant");
    expect(assistant?.tools[0]?.name).toBe("Bash");
    expect(assistant?.tools[0]?.isError).toBe(true);
    expect(assistant?.blocks.some((b) => b.kind === "thinking")).toBe(true);
    expect(assistant?.rawEvents).toHaveLength(2);
    expect((assistant?.rawEvents?.[0] as { type?: string })?.type).toBe("assistant");
    expect((assistant?.rawEvents?.[1] as { type?: string })?.type).toBe("user");
    expect(result.session.turns.find((t) => t.role === "user")?.rawEvents).toHaveLength(1);
  });

  it("does not title from isMeta or tool_result; prefers last ai-title", () => {
    const result = ingest([
      {
        type: "user",
        uuid: "m1",
        sessionId: "sid",
        isMeta: true,
        message: { role: "user", content: "Skill loaded" },
      },
      {
        type: "user",
        uuid: "u1",
        origin: { kind: "human" },
        message: { role: "user", content: "Real question" },
      },
      { type: "ai-title", aiTitle: "Better title", sessionId: "sid" },
      {
        type: "attachment",
        uuid: "att",
        attachment: { type: "hook_success" },
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.title).toBe("Better title");
    expect(result.session.turns).toHaveLength(1);
    expect(result.session.internals.some((e) => e.type === "attachment")).toBe(true);
  });

  it("titles a Claude slash-command session as /init, not XML tags", () => {
    const result = ingest([
      {
        type: "user",
        uuid: "u1",
        sessionId: "sid",
        origin: { kind: "human" },
        message: {
          role: "user",
          content: [
            {
              type: "text",
              text: "<command-message>init</command-message>\n<command-name>/init</command-name>\n<command-args>PaletteLab</command-args>",
            },
          ],
        },
      },
      {
        type: "assistant",
        uuid: "a1",
        parentUuid: "u1",
        message: {
          role: "assistant",
          content: [{ type: "thinking", thinking: "looking around" }],
        },
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.title).toBe("/init PaletteLab");
    expect(result.session.title).not.toContain("command-message");
  });

  it("marks a Claude turn as branch when parentUuid skips the previous included event", () => {
    const result = ingest([
      {
        type: "user",
        uuid: "u1",
        sessionId: "sid",
        origin: { kind: "human" },
        message: { role: "user", content: "one" },
      },
      {
        type: "assistant",
        uuid: "a1",
        parentUuid: "u1",
        message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
      },
      {
        type: "user",
        uuid: "u2",
        parentUuid: "u1",
        origin: { kind: "human" },
        message: { role: "user", content: "retry from first" },
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const last = result.session.turns.at(-1);
    expect(last?.branchMarker).toBe("retry");
  });

  it("ingests Codex without duplicating event_msg into turns", () => {
    const result = ingest([
      {
        timestamp: "2026-09-09T00:00:00Z",
        type: "session_meta",
        payload: {
          id: "codex-1",
          cwd: "/tmp/demo",
          git: { branch: "main" },
          originator: "Codex Desktop",
        },
      },
      {
        timestamp: "2026-09-09T00:00:01Z",
        type: "turn_context",
        payload: { model: "gpt-5.6-terra", cwd: "/tmp/demo" },
      },
      {
        type: "response_item",
        timestamp: "2026-09-09T00:00:02Z",
        payload: {
          type: "message",
          role: "developer",
          content: [{ type: "input_text", text: "env" }],
        },
      },
      {
        type: "response_item",
        timestamp: "2026-09-09T00:00:03Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Ship the parser" }],
        },
      },
      {
        type: "event_msg",
        payload: {
          type: "item_completed",
          item: { type: "UserMessage", content: [{ type: "text", text: "Ship the parser" }] },
        },
      },
      {
        type: "response_item",
        payload: {
          type: "reasoning",
          summary: [{ type: "summary_text", text: "will call exec" }],
        },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Running." }],
        },
      },
      {
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          call_id: "c1",
          name: "exec",
          input: JSON.stringify({ command: "ls" }),
        },
      },
      {
        type: "response_item",
        payload: {
          type: "custom_tool_call_output",
          call_id: "c1",
          output: [{ type: "input_text", text: "ok" }],
        },
      },
      {
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "c2",
          name: "wait",
          arguments: "{\"timeout_ms\":1}",
        },
      },
      {
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "c2",
          output: "done",
        },
      },
      {
        type: "event_msg",
        payload: {
          type: "item_completed",
          item: { type: "CommandExecution", command: "ls", exit_code: 1, duration: 12 },
        },
      },
      {
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: { input_tokens: 9, output_tokens: 3, total_tokens: 12 },
          },
        },
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.source).toBe("codex");
    expect(result.session.id).toBe("codex-1");
    expect(result.session.title).toContain("Ship the parser");
    expect(result.session.model).toBe("gpt-5.6-terra");
    const userTurns = result.session.turns.filter((t) => t.role === "user");
    expect(userTurns).toHaveLength(1);
    expect(result.session.turns.some((t) => t.role === "assistant")).toBe(true);
    expect(result.session.internals.some((e) => e.type === "developer")).toBe(true);
    const exec = result.session.turns.flatMap((t) => t.tools).find((t) => t.name === "exec");
    expect(exec?.isError).toBe(true);
    expect(exec?.exitCode).toBe(1);
    const wait = result.session.turns.flatMap((t) => t.tools).find((t) => t.name === "wait");
    expect(wait?.result).toBe("done");
    expect(userTurns[0]?.rawEvents).toHaveLength(1);
    const assistantTurn = result.session.turns.find((t) => t.role === "assistant");
    expect((assistantTurn?.rawEvents?.length ?? 0) >= 4).toBe(true);
  });

  it("skips bad lines and keeps unknown types as internals", () => {
    const text = [
      JSON.stringify({
        type: "user",
        uuid: "u1",
        sessionId: "sid",
        origin: { kind: "human" },
        message: { role: "user", content: "hi" },
      }),
      "{not json",
      JSON.stringify({ type: "mystery-future", uuid: "x" }),
      JSON.stringify({
        type: "assistant",
        uuid: "a1",
        message: { role: "assistant", content: [{ type: "text", text: "yo" }] },
      }),
    ].join("\n");
    const result = ingestSessionLog({ filename: "s.jsonl", text, byteLength: text.length });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.skippedLineCount).toBe(1);
    expect(result.session.internals.some((e) => e.type === "mystery-future")).toBe(true);
    expect(result.session.turns).toHaveLength(2);
  });

  it("warns above 50MB and rejects above 150MB", () => {
    const rows = [
      {
        type: "user",
        uuid: "u1",
        sessionId: "sid",
        origin: { kind: "human" },
        message: { role: "user", content: "hi" },
      },
    ];
    const text = jsonl(rows);
    const warned = ingestSessionLog({
      filename: "s.jsonl",
      text,
      byteLength: SIZE_WARN_BYTES + 1,
    });
    expect(warned.ok).toBe(true);
    if (warned.ok) expect(warned.session.warnings.join("")).toContain("50MB");

    const rejected = ingestSessionLog({
      filename: "s.jsonl",
      text,
      byteLength: SIZE_REJECT_BYTES + 1,
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error).toContain("150MB");
  });

  it("treats Codex subagent meta as a separate session flag", () => {
    const result = ingest([
      {
        type: "session_meta",
        payload: {
          id: "child",
          cwd: "/tmp",
          parent_thread_id: "parent",
          source: { subagent: { other: "guardian" } },
        },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "child task" }],
        },
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.subagent).toBe(true);
  });

  it("rebuilds a Claude task snapshot from TaskCreate/Update/Stop and cost-state", () => {
    const result = ingest([
      {
        type: "user",
        uuid: "u1",
        sessionId: "sid",
        timestamp: "2026-01-01T00:00:00Z",
        origin: { kind: "human" },
        message: { role: "user", content: "work" },
      },
      {
        type: "assistant",
        uuid: "a1",
        parentUuid: "u1",
        timestamp: "2026-01-01T00:00:01Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tc1",
              name: "TaskCreate",
              input: { subject: "Parse logs", description: "ingest" },
            },
          ],
        },
      },
      {
        type: "user",
        uuid: "u2",
        parentUuid: "a1",
        timestamp: "2026-01-01T00:00:02Z",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "tc1", content: "created" }],
        },
        toolUseResult: { task: { id: "task-real", subject: "Parse logs" } },
      },
      {
        type: "assistant",
        uuid: "a2",
        parentUuid: "u2",
        timestamp: "2026-01-01T00:00:03Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tu1",
              name: "TaskUpdate",
              input: { taskId: "task-real", status: "in_progress" },
            },
          ],
        },
      },
      {
        type: "user",
        uuid: "u3",
        parentUuid: "a2",
        timestamp: "2026-01-01T00:00:04Z",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "tu1", content: "ok" }],
        },
      },
      {
        type: "assistant",
        uuid: "a3",
        parentUuid: "a2",
        timestamp: "2026-01-01T00:00:05Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "ts1",
              name: "TaskStop",
              input: { task_id: "task-real" },
            },
          ],
        },
      },
      {
        type: "user",
        uuid: "u4",
        parentUuid: "a3",
        timestamp: "2026-01-01T00:00:06Z",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "ts1", content: "stopped" }],
        },
      },
      {
        type: "system",
        subtype: "turn_duration",
        parentUuid: "u1",
        durationMs: 1500,
        timestamp: "2026-01-01T00:00:07Z",
      },
      {
        type: "cost-state",
        totalCostUSD: 0.4,
        totalDuration: 8000,
        totalAPIDuration: 3000,
        totalToolDuration: 2000,
        totalLinesAdded: 12,
        totalLinesRemoved: 3,
        timestamp: "2026-01-01T00:00:08Z",
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.tasks).toEqual([
      expect.objectContaining({
        id: "task-real",
        title: "Parse logs",
        status: "cancelled",
        originTurnId: "a1",
      }),
    ]);
    expect(result.session.turns.find((t) => t.id === "u1")?.durationMs).toBe(1500);
    expect(result.session.stats?.wallMs).toBe(8000);
    expect(result.session.stats?.apiMs).toBe(3000);
    expect(result.session.stats?.toolMs).toBe(2000);
    expect(result.session.stats?.totalMs).toBe(8000);
    expect(result.session.stats?.linesAdded).toBe(12);
    expect(result.session.stats?.linesRemoved).toBe(3);
    expect(result.session.tokenSummary?.costUsd).toBe(0.4);
  });

  it("keeps the last Codex update_plan snapshot and parses duration dicts", () => {
    const result = ingest([
      {
        timestamp: "2026-09-09T00:00:00Z",
        type: "session_meta",
        payload: { id: "codex-plan", cwd: "/tmp" },
      },
      {
        timestamp: "2026-09-09T00:00:01Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "plan it" }],
        },
      },
      {
        timestamp: "2026-09-09T00:00:02Z",
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "p1",
          name: "update_plan",
          arguments: JSON.stringify({
            plan: [
              { step: "old", status: "completed" },
              { step: "stale", status: "pending" },
            ],
          }),
        },
      },
      {
        timestamp: "2026-09-09T00:00:03Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "p1",
          output: "ok",
        },
      },
      {
        timestamp: "2026-09-09T00:01:00Z",
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "p2",
          name: "update_plan",
          arguments: JSON.stringify({
            plan: [
              { step: "Parse jsonl", status: "completed" },
              { step: "Show tasks", status: "in_progress" },
              { step: "Ship", status: "pending" },
            ],
          }),
        },
      },
      {
        timestamp: "2026-09-09T00:01:01Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          call_id: "e1",
          name: "exec",
          input: JSON.stringify({ command: "ls" }),
        },
      },
      {
        timestamp: "2026-09-09T00:01:02Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call_output",
          call_id: "e1",
          output: "ok",
        },
      },
      {
        timestamp: "2026-09-09T00:01:03Z",
        type: "event_msg",
        payload: {
          type: "item_completed",
          item: {
            type: "CommandExecution",
            command: ["ls"],
            exit_code: 0,
            duration: { secs: 2, nanos: 0 },
          },
        },
      },
      {
        timestamp: "2026-09-09T00:01:04Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          duration_ms: 64000,
        },
      },
      {
        timestamp: "2026-09-09T00:01:05Z",
        type: "event_msg",
        payload: { type: "turn_aborted", reason: "user" },
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.tasks?.map((t) => t.title)).toEqual(["Parse jsonl", "Show tasks", "Ship"]);
    expect(result.session.tasks?.map((t) => t.status)).toEqual([
      "completed",
      "in_progress",
      "pending",
    ]);
    const exec = result.session.turns.flatMap((t) => t.tools).find((t) => t.name === "exec");
    expect(exec?.durationMs).toBe(2000);
    expect(exec?.exitCode).toBe(0);
    expect(result.session.stats?.abortedCount).toBe(1);
    expect(result.session.stats?.lastTurnMs).toBe(64000);
    expect(result.session.stats?.wallMs).toBe(65000);
  });
});
