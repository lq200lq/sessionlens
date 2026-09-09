import { describe, expect, it } from "vitest";
import { formatClockTime, initialTurnId, sameCalendarDay } from "./display";
import { humanizeSessionText, parseSlashCommand } from "./ingest/util";
import type { Turn } from "./ingest/types";

function turn(partial: Partial<Turn> & { id: string }): Turn {
  return {
    role: "assistant",
    blocks: [],
    tools: [],
    ...partial,
  };
}

describe("humanizeSessionText", () => {
  it("prefers command-name and short args", () => {
    const text =
      "<command-message>init</command-message>\n<command-name>/init</command-name>\n<command-args>PaletteLab</command-args>";
    expect(parseSlashCommand(text)?.name).toBe("/init");
    expect(humanizeSessionText(text)).toBe("/init PaletteLab");
  });

  it("strips leftover tags when there is no command-name", () => {
    expect(humanizeSessionText("<foo>hello</foo> world")).toBe("hello world");
  });
});

describe("formatClockTime", () => {
  it("formats hour, minute, and second in local time", () => {
    const date = new Date(2026, 8, 9, 14, 7, 3);
    expect(formatClockTime(date.toISOString())).toBe("14:07:03");
  });

  it("returns undefined for missing or invalid timestamps", () => {
    expect(formatClockTime(undefined)).toBeUndefined();
    expect(formatClockTime("not-a-date")).toBeUndefined();
  });
});

describe("sameCalendarDay", () => {
  it("compares local calendar days", () => {
    const morning = new Date(2026, 8, 9, 1, 0, 0).toISOString();
    const night = new Date(2026, 8, 9, 23, 0, 0).toISOString();
    const next = new Date(2026, 8, 10, 0, 0, 0).toISOString();
    expect(sameCalendarDay(morning, night)).toBe(true);
    expect(sameCalendarDay(morning, next)).toBe(false);
  });
});

describe("initialTurnId", () => {
  it("selects the first user turn even when an assistant branch is first", () => {
    const turns = [
      turn({
        id: "a0",
        branchMarker: "branch",
        blocks: [{ kind: "thinking", text: "plan" }],
      }),
      turn({
        id: "u1",
        role: "user",
        blocks: [{ kind: "text", text: "do the thing" }],
      }),
    ];
    expect(initialTurnId(turns)).toBe("u1");
  });

  it("falls back to the first text turn, then the first turn", () => {
    expect(
      initialTurnId([
        turn({ id: "a0", blocks: [{ kind: "thinking", text: "hmm" }] }),
        turn({ id: "a1", blocks: [{ kind: "text", text: "ok" }] }),
      ]),
    ).toBe("a1");
    expect(initialTurnId([turn({ id: "only" })])).toBe("only");
    expect(initialTurnId([])).toBeUndefined();
  });
});
