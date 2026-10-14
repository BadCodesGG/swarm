export type ModelFamily = "opus" | "fable" | "sonnet" | "haiku" | "other";
export type ToolCategory = "web" | "shell" | "files" | "edit" | "agents" | "advisor" | "plan" | "mcp" | "other";
export type EventKind = "prompt" | "turn" | "call" | "result" | "spawn" | "return" | "compact";
/** Who allowed a tool call: a human wait, a standing rule, an automatic mode, or something else. */
export const PERMISSION_SOURCES = ["user", "rule", "auto", "other"] as const;
export type PermissionSource = (typeof PERMISSION_SOURCES)[number];
export const COMPACT_TRIGGERS = ["manual", "auto"] as const;
/** What a context compaction cost: numbers only, never the summary text. */
export interface CompactInfo {
  trigger: (typeof COMPACT_TRIGGERS)[number];
  preTokens: number;
  postTokens: number;
  durationMs: number;
}
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
  isError?: boolean;     // result, and a spawn whose launch failed
  excerpt?: string;      // turn text, handback and a spawn brief at most 280 chars; human prompts at most 2,000
  permission?: PermissionSource; // result: who allowed the call
  size?: number;         // result: characters in the result content (a number, never the text)
  thinkMs?: number;      // turn: how long the model thought before answering
  compact?: CompactInfo; // compact: what the compaction cost
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

/** One top-level session in a folder that holds several, for the chooser. */
export interface SessionCandidate {
  /** The picked path, to hand back to `loadSession` as `session`. */
  path: string;
  size: number;
  /** First line of the first human prompt, at most 120 chars; empty when none was found. */
  firstPrompt: string;
  subagentFiles: number;
}

/**
 * `loadSession` found several top-level sessions and none was chosen. It is a failed `ParseResult`
 * (`several-session-files`) that also lists the candidates, so code that only knows `ParseResult`
 * still shows an error; the chooser checks `"choose" in result`.
 */
export type ChooseResult = Extract<ParseResult, { ok: false }> & {
  error: "several-session-files";
  choose: SessionCandidate[];
};
