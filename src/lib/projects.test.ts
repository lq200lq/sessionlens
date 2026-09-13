import { describe, expect, it } from "vitest";
import { isSessionHomeName, shouldSkipDir, claudeDirMatchesHint } from "./projects";

describe("shouldSkipDir", () => {
  it("skips package and vcs trees", () => {
    expect(shouldSkipDir("node_modules")).toBe(true);
    expect(shouldSkipDir(".git")).toBe(true);
    expect(shouldSkipDir(".next")).toBe(true);
    expect(shouldSkipDir("dist")).toBe(true);
    expect(shouldSkipDir("src")).toBe(false);
    expect(shouldSkipDir(".claude")).toBe(false);
    expect(shouldSkipDir(".codex")).toBe(false);
  });
});

describe("isSessionHomeName", () => {
  it("recognizes claude and codex session roots", () => {
    expect(isSessionHomeName(".claude")).toBe(true);
    expect(isSessionHomeName(".codex")).toBe(true);
    expect(isSessionHomeName("projects")).toBe(true);
    expect(isSessionHomeName("sessions")).toBe(true);
    expect(isSessionHomeName("PalettelLab")).toBe(false);
  });
});

describe("claudeDirMatchesHint", () => {
  it("matches encoded Claude project folders by cwd name", () => {
    expect(claudeDirMatchesHint("-Users-q-workspace-finalspace-api-light", "api-light")).toBe(true);
    expect(claudeDirMatchesHint("-Users-q-workspace-finalspace-api-light", "api-light")).toBe(true);
    expect(claudeDirMatchesHint("-Users-q-workspace-finalspace-api-light", "work")).toBe(false);
    expect(claudeDirMatchesHint("api-light", "api-light")).toBe(true);
  });
});
