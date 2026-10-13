import { describe, expect, it } from "vitest";
import { agentTypeCategory, categorize, modelFamily } from "./categories";

describe("categorize", () => {
  it.each([
    ["WebSearch", "web"],
    ["WebFetch", "web"],
    ["mcp__claude-in-chrome__navigate", "web"],
    ["mcp__playwright__browser_click", "web"],
    ["Bash", "shell"],
    ["PowerShell", "shell"],
    ["Read", "files"],
    ["Grep", "files"],
    ["Glob", "files"],
    ["LS", "files"],
    ["Edit", "edit"],
    ["Write", "edit"],
    ["MultiEdit", "edit"],
    ["NotebookEdit", "edit"],
    ["Agent", "agents"],
    ["Task", "agents"],
    ["advisor", "advisor"],
    ["TodoWrite", "plan"],
    ["TaskCreate", "plan"],
    ["ExitPlanMode", "plan"],
    ["EnterPlanMode", "plan"],
    ["mcp__github__create_issue", "mcp"],
    ["mcp__x", "mcp"],
    ["ToolSearch", "other"],
    ["Skill", "other"],
    ["", "other"],
    ["constructor", "other"],
    ["toString", "other"],
    ["__proto__", "other"],
  ])("%s -> %s", (name, cat) => {
    expect(categorize(name)).toBe(cat);
  });
});

describe("modelFamily", () => {
  it.each([
    ["claude-opus-4-1-20250805", "opus"],
    ["claude-sonnet-4-5", "sonnet"],
    ["claude-haiku-4-5-20251001", "haiku"],
    ["claude-fable-1", "fable"],
    ["CLAUDE-OPUS", "opus"],
    ["<synthetic>", "other"],
    ["gpt-5", "other"],
  ])("%s -> %s", (id, fam) => {
    expect(modelFamily(id)).toBe(fam);
  });
});

describe("agentTypeCategory", () => {
  it.each([
    ["main", "main"],
    ["general-purpose", "general"],
    ["Explore", "explore"],
    ["Plan", "plan"],
    ["code-reviewer", "review"],
    ["qa-reviewer", "review"],
    ["test-runner", "test"],
    ["builder", "build"],
    ["implementer", "build"],
    ["some-plugin:thing", "other"],
    ["", "other"],
  ])("%s -> %s", (t, cat) => {
    expect(agentTypeCategory(t)).toBe(cat);
  });
});
