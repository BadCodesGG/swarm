export type ModelFamily = "opus" | "fable" | "sonnet" | "haiku" | "other";
export type ToolCategory = "web" | "shell" | "files" | "edit" | "agents" | "advisor" | "plan" | "mcp" | "other";
export type EventKind = "prompt" | "turn" | "call" | "result" | "spawn" | "return";
export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number }

export interface TraceAgent {
  id: number;            // index into agents; 0 is the orchestrator
  parent: number;        // -1 for the orchestrator
  depth: number;
  model: ModelFamily;
  modelId: string;
  agentType: string;     // subagent_type verbatim on upload, a category in samples
  label: string;         // description, at most 80 chars
  spawnT: number;        // seconds from session start
  returnT: number;       // equals duration when it never returned
  returned: boolean;
  background: boolean;
  usage: Usage;          // once per message.id
  toolCalls: number;
  childMissing: boolean; // spawn seen, child transcript not provided
}

export interface TraceEvent {
  t: number;             // seconds from session start; events sorted ascending
  agent: number;
  kind: EventKind;
  category?: ToolCategory; // call, result, spawn ("agents")
  tool?: string;         // tool name; "advisor" for the server tool
  call?: number;         // result/return: index of the matching call/spawn event
  child?: number;        // spawn/return: the subagent's id
  usage?: Usage;         // turn: that assistant message's usage
  isError?: boolean;     // result
  excerpt?: string;      // turn text and handback at most 280 chars; human prompts at most 2,000
}

export interface SessionTrace {
  version: 1;
  source: "sample" | "upload";
  label: string;
  duration: number;
  agents: TraceAgent[];
  events: TraceEvent[];
  truncated: boolean;    // a cap was hit; the HUD says so
}

/** Why a session could not be turned into a trace. */
export type ParseError = "no-session-file" | "several-session-files" | "no-conversation" | "read-failed";

/** A limit the builder can hit; the trace still plays and `truncated` is set. */
export type CapName = "line-bytes" | "events" | "agents" | "files" | "excerpt-bytes";

/** What the builder counted while reading; text only, never a record body. */
export interface ParseReport {
  linesRead: number;
  malformedLines: number;
  overlongLines: number;
  unknownTypes: number;
  capsHit: CapName[];
}

export type ParseResult =
  | { ok: true; trace: SessionTrace; report: ParseReport }
  | { ok: false; error: ParseError; report: ParseReport };

/** Output caps (the input is never capped). */
export const TRACE_LIMITS = {
  lineBytes: 4 * 1024 * 1024,
  events: 200_000,
  agents: 2_000,
  files: 500,
  excerpt: 280,
  prompt: 2_000,
  excerptBytes: 8 * 1024 * 1024,
} as const;
