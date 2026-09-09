import { describe, expect, it } from "vitest";
import { presentTool, rawEventLabel, unwrapToolResult } from "./tool-view";
import type { ToolInvocation } from "./ingest/types";

function tool(partial: Partial<ToolInvocation> & { name: string }): ToolInvocation {
  return {
    id: "t1",
    input: {},
    isError: false,
    ...partial,
  };
}

describe("unwrapToolResult", () => {
  it("prefers Bash toolUseResult stdout and stderr over the JSON wrapper", () => {
    const unwrapped = unwrapToolResult({
      content: "boom",
      structured: { stdout: "ok\n", stderr: "boom", interrupted: false },
    });
    expect(unwrapped.stdout).toBe("ok\n");
    expect(unwrapped.stderr).toBe("boom");
    expect(unwrapped.text).toBe("boom");
  });

  it("returns Codex string output as text", () => {
    expect(unwrapToolResult("done")).toEqual({ text: "done" });
  });

  it("reads Read file bodies from structured.file", () => {
    expect(unwrapToolResult({ content: "", structured: { file: { content: "hello" } } }).file).toBe(
      "hello",
    );
  });
});

describe("presentTool", () => {
  it("shows Bash as a shell command, not a JSON command field", () => {
    const view = presentTool(
      tool({
        name: "Bash",
        input: { command: "find . -type f | head -50" },
        result: { content: "a.txt", structured: { stdout: "a.txt\n", stderr: "" } },
      }),
    );
    expect(view.kind).toBe("bash");
    expect(view.headline).toBe("find . -type f | head -50");
    expect(view.copyInputLabel).toBe("复制命令");
    expect(view.copyOutputLabel).toBe("复制输出");
    expect(view.outputSections[0]).toEqual({ label: "stdout", text: "a.txt\n" });
  });

  it("presents Skill name and args without dumping the input object", () => {
    const view = presentTool(
      tool({
        name: "Skill",
        input: { skill: "init", args: "用中文" },
      }),
    );
    expect(view.headline).toBe("init");
    expect(view.extra).toBe("用中文");
  });
});

describe("rawEventLabel", () => {
  it("labels Claude rows by type and Codex rows by payload type", () => {
    expect(rawEventLabel({ type: "assistant" })).toBe("assistant");
    expect(rawEventLabel({ type: "response_item", payload: { type: "function_call" } })).toBe(
      "response_item · function_call",
    );
  });
});
