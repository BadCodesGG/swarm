import type { ModelFamily, ToolCategory } from "./types";

/** Station ring order (see ARCHITECTURE.md), then `other`. */
export const TOOL_CATEGORIES: readonly ToolCategory[] = [
  "web",
  "plan",
  "advisor",
  "agents",
  "edit",
  "mcp",
  "files",
  "shell",
  "other",
];

export const MODEL_FAMILIES: readonly ModelFamily[] = ["opus", "fable", "sonnet", "haiku", "other"];

const EXACT: Readonly<Record<string, ToolCategory>> = {
  advisor: "advisor",
  WebSearch: "web",
  WebFetch: "web",
  Bash: "shell",
  BashOutput: "shell",
  KillShell: "shell",
  PowerShell: "shell",
  Read: "files",
  Grep: "files",
  Glob: "files",
  LS: "files",
  Edit: "edit",
  Write: "edit",
  MultiEdit: "edit",
  NotebookEdit: "edit",
  Agent: "agents",
  Task: "agents",
  TaskOutput: "agents",
  TaskStop: "agents",
  TodoWrite: "plan",
  TaskCreate: "plan",
  TaskUpdate: "plan",
  TaskList: "plan",
  TaskGet: "plan",
  ExitPlanMode: "plan",
  EnterPlanMode: "plan",
};

/** MCP servers whose tools drive a browser or fetch the web. */
const WEB_SERVER = /browser|chrome|playwright|puppeteer|fetch|web/i;

export function categorize(toolName: string): ToolCategory {
  // Own keys only: a tool named "constructor" must not reach Object.prototype.
  if (Object.hasOwn(EXACT, toolName)) return EXACT[toolName];
  if (toolName.startsWith("mcp__")) {
    const server = toolName.split("__")[1] ?? "";
    return WEB_SERVER.test(server) ? "web" : "mcp";
  }
  return "other";
}

export function modelFamily(id: string): ModelFamily {
  const s = id.toLowerCase();
  if (s.includes("opus")) return "opus";
  if (s.includes("fable")) return "fable";
  if (s.includes("sonnet")) return "sonnet";
  if (s.includes("haiku")) return "haiku";
  return "other";
}

/** Coarse agent types: what a sample carries, and what calibration keeps of a real `subagent_type`. */
export type AgentTypeCategory = "main" | "general" | "explore" | "plan" | "build" | "review" | "test" | "other";

export const AGENT_TYPES: readonly AgentTypeCategory[] = [
  "main",
  "general",
  "explore",
  "plan",
  "build",
  "review",
  "test",
  "other",
];

export function agentTypeCategory(t: string): AgentTypeCategory {
  const s = t.toLowerCase();
  if (s === "main" || s === "orchestrator") return "main";
  if (s === "general-purpose" || s === "general") return "general";
  if (s.includes("explor") || s.includes("research") || s.includes("search")) return "explore";
  if (s.includes("plan") || s.includes("architect")) return "plan";
  if (s.includes("review") || s.includes("audit")) return "review";
  if (s.includes("test") || s.includes("qa")) return "test";
  if (s.includes("build") || s.includes("implement") || s.includes("develop")) return "build";
  return "other";
}
