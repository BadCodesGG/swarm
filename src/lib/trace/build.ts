import { categorize, modelFamily } from "./categories";
import { classifyFile, type FileRole } from "./session-files";
import {
  COMPACT_TRIGGERS,
  TRACE_LIMITS,
  type CapName,
  type CompactInfo,
  type EventKind,
  type ParseError,
  type ParseReport,
  type ParseResult,
  type PermissionSource,
  type SessionTrace,
  type ToolCategory,
  type TraceAgent,
  type TraceEvent,
  type Usage,
} from "./types";

export type TraceLimits = { -readonly [K in keyof typeof TRACE_LIMITS]: number };

export interface TraceBuilder {
  /** Registers a file; false when the file cap is hit and the file will be ignored. */
  accepts(file: string): boolean;
  /** One transcript line (no line terminator). */
  line(file: string, text: string): void;
  /** The whole text of an `agent-*.meta.json`. */
  meta(file: string, text: string): void;
  /** What has been counted so far. */
  report(): ParseReport;
  finish(): ParseResult;
}

/** Record types that carry nothing the trace needs; anything else is counted as unknown. */
const IGNORED_TYPES = new Set([
  "attachment",
  "system",
  "queue-operation",
  "summary",
  "progress",
  "custom-title",
  "ai-title",
  "tag",
  "last-prompt",
  "agent-name",
  "agent-setting",
  "atis-latch",
  "mode",
  "permission-mode",
  "pr-link",
  "cost-state",
  "bridge-session",
  "dev-mods",
  "frame-link",
  "artifact-comment-monitor",
  "artifact-autoreact-ledger",
]);

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
/**
 * Longest kept field (ids, names, models, a description, a handback). The caps bound counts, so
 * without this a few hundred records with megabyte-long names would fill the worker's heap.
 */
const FIELD_CHARS = 300;
/** Tool names repeat on every call event (up to the events cap), so they get a tighter cap. */
const TOOL_CHARS = 100;
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? cutText(v, FIELD_CHARS) : undefined;
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const nat = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

/** At most `n` UTF-16 units, never ending on half a surrogate pair. */
export function cutText(s: string, n: number): string {
  if (s.length <= n) return s;
  const end = n > 0 && (s.charCodeAt(n - 1) & 0xfc00) === 0xd800 ? n - 1 : n;
  return s.slice(0, end);
}

/** Where a permission decision came from: `user_temporary` is a human approval wait. */
function permissionOf(v: unknown): PermissionSource | undefined {
  if (!isObj(v) || typeof v.source !== "string") return undefined;
  const s = v.source;
  if (s.startsWith("user")) return "user";
  if (s === "config" || s === "rule" || s.startsWith("settings") || s.endsWith("_rule")) return "rule";
  if (s === "classifier" || s === "auto" || s === "mode" || s.startsWith("auto")) return "auto";
  return "other";
}

/** Characters in a tool_result's content, never the text itself. */
function sizeOf(content: unknown): number | undefined {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return undefined;
  let n = 0;
  for (const b of content) if (isObj(b) && typeof b.text === "string") n += b.text.length;
  return n;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

function parseUsage(v: unknown): Usage | undefined {
  if (!isObj(v)) return undefined;
  return {
    input: nat(v.input_tokens),
    output: nat(v.output_tokens),
    cacheRead: nat(v.cache_read_input_tokens),
    cacheWrite: nat(v.cache_creation_input_tokens),
  };
}

const zeroUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

function serverCategory(name: string): ToolCategory {
  if (name === "advisor") return "advisor";
  if (name.startsWith("web_")) return "web";
  return categorize(name);
}

interface FileState {
  key: string;
  role: FileRole;
  agentKey: string;
  /** Latest conversation record, ms since epoch. */
  lastMs: number;
  lastText: string | undefined;
  msgs: Map<string, Msg>;
  calls: Map<string, RawEvent>;
  spawns: Map<string, SpawnRec>;
  /** Set when a spawn claims this subagent file. */
  claimed: boolean;
  agent: number;
}

interface RawEvent {
  tMs: number;
  file: FileState;
  kind: EventKind;
  category?: ToolCategory;
  tool?: string;
  call?: RawEvent;
  spawn?: SpawnRec;
  usage?: Usage;
  isError?: boolean;
  excerpt?: string;
  permission?: PermissionSource;
  size?: number;
  thinkMs?: number;
  compact?: CompactInfo;
  /** Where it landed in the sorted output. */
  out: number;
}

interface Msg {
  turn: RawEvent;
  bestOutput: number;
  haveText: boolean;
}

interface Meta {
  toolUseId?: string;
  agentType?: string;
  description?: string;
  model?: string;
}

interface SpawnRec {
  seq: number;
  toolUseId: string;
  file: FileState;
  event: RawEvent;
  description?: string;
  subagentType?: string;
  model?: string;
  background: boolean;
  resultAgentId?: string;
  resolvedModel?: string;
  agentType?: string;
  durationMs?: number;
  totalTokens?: number;
  toolUseCount?: number;
  handback?: string;
  /** When a result that was not a background launch arrived. */
  completedMs?: number;
  childFile?: FileState;
  meta?: Meta;
}

interface Window {
  spawn: number;
  ret: number;
}

export function createTraceBuilder(limitOverrides: Partial<TraceLimits> = {}): TraceBuilder {
  const limits: TraceLimits = { ...TRACE_LIMITS, ...limitOverrides };
  const files = new Map<string, FileState | null>();
  const metas = new Map<string, Meta>();
  const raw: RawEvent[] = [];
  const spawns: SpawnRec[] = [];
  const sessions = new Set<FileState>();
  const caps = new Set<CapName>();
  const counts = { linesRead: 0, malformedLines: 0, overlongLines: 0, unknownTypes: 0 };
  const fileModels = new Map<FileState, string>(); // first model id each transcript names
  let firstMs = Infinity;
  let excerptChars = 0;

  const cap = (name: CapName) => void caps.add(name);

  /** Room for one more event, keeping one slot per spawn free for its `return`. */
  const room = (extra: number) => raw.length + spawns.length + extra <= limits.events;

  function takeExcerpt(text: string, max: number, keepNewlines = false): string | undefined {
    const s = cutText(keepNewlines ? text.trim() : text.replace(/\s+/g, " ").trim(), max);
    if (!s) return undefined;
    if (excerptChars + s.length > limits.excerptBytes) {
      cap("excerpt-bytes");
      return undefined;
    }
    excerptChars += s.length;
    return s;
  }

  function fileState(key: string): FileState | null {
    const known = files.get(key);
    if (known !== undefined) return known;
    if (files.size >= limits.files) {
      files.set(key, null);
      cap("files");
      return null;
    }
    const info = classifyFile(key);
    const fs: FileState = {
      key,
      role: info.role,
      agentKey: info.agentKey,
      lastMs: -Infinity,
      lastText: undefined,
      msgs: new Map(),
      calls: new Map(),
      spawns: new Map(),
      claimed: false,
      agent: -1,
    };
    files.set(key, fs);
    if (fs.role === "session") sessions.add(fs);
    return fs;
  }

  function push(ev: Omit<RawEvent, "out">): RawEvent {
    const e: RawEvent = { ...ev, out: -1 };
    raw.push(e);
    return e;
  }

  function onToolUse(fs: FileState, b: Json, tMs: number, server: boolean): void {
    const full = str(b.name);
    if (!full) return;
    const name = cutText(full, TOOL_CHARS);
    const id = str(b.id);
    const isSpawn = !server && (name === "Agent" || name === "Task");
    if (isSpawn) {
      if (spawns.length >= limits.agents - 1) {
        cap("agents");
        return;
      }
      if (!room(2)) {
        cap("events");
        return;
      }
      const input = isObj(b.input) ? b.input : {};
      // A spawn is the only tool call whose input is read: the brief plus the four fields below; every other argument is dropped.
      const brief = typeof input.prompt === "string" ? takeExcerpt(input.prompt, limits.excerpt) : undefined;
      const event = push({ tMs, file: fs, kind: "spawn", category: "agents", tool: name, excerpt: brief });
      const rec: SpawnRec = {
        seq: spawns.length,
        toolUseId: id ?? "",
        file: fs,
        event,
        description: str(input.description),
        subagentType: str(input.subagent_type),
        model: str(input.model),
        background: input.run_in_background === true,
      };
      event.spawn = rec;
      spawns.push(rec);
      if (id) fs.spawns.set(id, rec);
      return;
    }
    if (!room(1)) {
      cap("events");
      return;
    }
    const event = push({ tMs, file: fs, kind: "call", category: server ? serverCategory(name) : categorize(name), tool: name });
    // A server tool's result is not a separate record, so there is nothing to match.
    if (id && !server) fs.calls.set(id, event);
  }

  function onSpawnResult(rec: SpawnRec, result: unknown, tMs: number, isError: boolean): void {
    const r = isObj(result) ? result : undefined;
    const launched = r ? r.isAsync === true || r.status === "async_launched" : rec.background;
    rec.resultAgentId ??= str(r?.agentId);
    rec.resolvedModel ??= str(r?.resolvedModel);
    rec.agentType ??= str(r?.agentType);
    rec.durationMs ??= num(r?.totalDurationMs);
    rec.totalTokens ??= num(r?.totalTokens);
    rec.toolUseCount ??= num(r?.totalToolUseCount);
    if (isObj(r?.handbackReport)) rec.handback ??= str(r.handbackReport.text);
    if (!launched || isError) rec.completedMs ??= tMs;
    if (isError) rec.event.isError = true;
  }

  function onUser(fs: FileState, rec: Json, tMs: number): void {
    const msg = isObj(rec.message) ? rec.message : undefined;
    const content = msg?.content;

    if (fs.role === "session" && rec.isCompactSummary !== true && isObj(rec.origin) && rec.origin.kind === "human" && room(1)) {
      let text = "";
      if (typeof content === "string") text = content;
      else if (Array.isArray(content)) {
        text = content
          .filter((b): b is Json => isObj(b) && b.type === "text" && typeof b.text === "string")
          .map((b) => b.text as string)
          .join("\n");
      }
      push({ tMs, file: fs, kind: "prompt", excerpt: takeExcerpt(text, limits.prompt, true) });
    }

    if (!Array.isArray(content)) return;
    for (const b of content) {
      if (!isObj(b) || b.type !== "tool_result") continue;
      const id = str(b.tool_use_id);
      if (!id) continue;
      const isError = b.is_error === true;
      const spawn = fs.spawns.get(id);
      if (spawn) {
        onSpawnResult(spawn, rec.toolUseResult, tMs, isError);
        continue;
      }
      const call = fs.calls.get(id);
      if (!call || !room(1)) continue;
      fs.calls.delete(id);
      push({
        tMs: Math.max(tMs, call.tMs),
        file: fs,
        kind: "result",
        category: call.category,
        tool: call.tool,
        call,
        isError,
        permission: permissionOf(rec.permissionDecision),
        size: sizeOf(b.content),
      });
    }
  }

  function onAssistant(fs: FileState, rec: Json, tMs: number): void {
    const msg = isObj(rec.message) ? rec.message : undefined;
    if (!msg) return;
    const model = str(msg.model);
    if (model?.startsWith("<")) return; // "<synthetic>" notices are not model turns
    const id = str(msg.id) ?? str(rec.uuid);
    if (!id) return;
    const usage = parseUsage(msg.usage);
    let m = fs.msgs.get(id);
    if (!m) {
      if (!room(1)) {
        cap("events");
        return;
      }
      const turn = push({ tMs, file: fs, kind: "turn", usage: usage ?? zeroUsage() });
      m = { turn, bestOutput: usage ? usage.output : -1, haveText: false };
      fs.msgs.set(id, m);
    } else if (usage && usage.output > m.bestOutput) {
      m.turn.usage = usage;
      m.bestOutput = usage.output;
    }
    const think = num(rec.thinkingDurationMs);
    if (think !== undefined && think >= 0) m.turn.thinkMs = Math.max(m.turn.thinkMs ?? 0, think);
    if (model) fileModels.set(fs, fileModels.get(fs) ?? model);

    const blocks = Array.isArray(msg.content) ? msg.content : [];
    for (const b of blocks) {
      if (!isObj(b)) continue;
      if (b.type === "text") {
        if (!m.haveText && typeof b.text === "string") {
          const ex = takeExcerpt(b.text, limits.excerpt);
          if (ex !== undefined) {
            m.turn.excerpt = ex;
            m.haveText = true;
            fs.lastText = ex;
          }
        }
      } else if (b.type === "tool_use") onToolUse(fs, b, tMs, false);
      else if (b.type === "server_tool_use") onToolUse(fs, b, tMs, true);
    }
  }

  /** A `compact_boundary` marker: the token counts and timing only, never the summary. */
  function onCompact(fs: FileState, rec: Json, tMs: number): void {
    const m = isObj(rec.compactMetadata) ? rec.compactMetadata : undefined;
    if (!m || !room(1)) return;
    const trigger = COMPACT_TRIGGERS.find((t) => t === m.trigger) ?? "auto";
    push({
      tMs,
      file: fs,
      kind: "compact",
      compact: { trigger, preTokens: nat(m.preTokens), postTokens: nat(m.postTokens), durationMs: nat(m.durationMs) },
    });
  }

  function accepts(file: string): boolean {
    return fileState(file) !== null;
  }

  function line(file: string, text: string): void {
    const fs = fileState(file);
    if (!fs || (fs.role !== "session" && fs.role !== "subagent")) return;
    if (text.trim() === "") return;
    counts.linesRead++;
    if (text.length > limits.lineBytes) {
      counts.overlongLines++;
      cap("line-bytes");
      return;
    }
    let rec: unknown;
    try {
      rec = JSON.parse(text);
    } catch {
      counts.malformedLines++;
      return;
    }
    if (!isObj(rec)) {
      counts.malformedLines++;
      return;
    }
    const type = rec.type;
    if (type === "user" || type === "assistant") {
      const tMs = typeof rec.timestamp === "string" ? Date.parse(rec.timestamp) : NaN;
      if (!Number.isFinite(tMs)) return;
      if (fs.role === "session" && rec.isSidechain === true) return;
      if (tMs > fs.lastMs) fs.lastMs = tMs;
      if (fs.role === "session" && tMs < firstMs) firstMs = tMs;
      if (type === "user") onUser(fs, rec, tMs);
      else onAssistant(fs, rec, tMs);
      return;
    }
    if (type === "system" && rec.subtype === "compact_boundary") {
      const tMs = typeof rec.timestamp === "string" ? Date.parse(rec.timestamp) : NaN;
      if (Number.isFinite(tMs) && !(fs.role === "session" && rec.isSidechain === true)) onCompact(fs, rec, tMs);
      return;
    }
    if (typeof type !== "string" || !(IGNORED_TYPES.has(type) || type.startsWith("file-history"))) counts.unknownTypes++;
  }

  function meta(file: string, text: string): void {
    const fs = fileState(file);
    if (!fs || fs.role !== "meta") return;
    let m: unknown;
    try {
      m = JSON.parse(text);
    } catch {
      counts.malformedLines++;
      return;
    }
    if (!isObj(m)) {
      counts.malformedLines++;
      return;
    }
    metas.set(fs.agentKey, {
      toolUseId: str(m.toolUseId),
      agentType: str(m.agentType),
      description: str(m.description),
      model: str(m.model),
    });
  }

  function report(): ParseReport {
    return { ...counts, capsHit: [...caps] };
  }

  function fail(error: ParseError): ParseResult {
    return { ok: false, error, report: report() };
  }

  function finish(): ParseResult {
    if (sessions.size === 0) return fail("no-session-file");
    if (sessions.size > 1) return fail("several-session-files");
    if (!Number.isFinite(firstMs)) return fail("no-conversation");
    const root = [...sessions][0];
    const t0 = firstMs;

    // Link each spawn to its transcript: parent tool_use id -> meta -> agentId -> subagent file.
    const childFiles = new Map<string, FileState>();
    for (const f of files.values()) if (f && f.role === "subagent") childFiles.set(f.agentKey, f);
    const agentByToolUse = new Map<string, string>();
    for (const [agentKey, m] of metas) if (m.toolUseId) agentByToolUse.set(m.toolUseId, agentKey);
    for (const s of spawns) {
      const key = agentByToolUse.get(s.toolUseId) ?? s.resultAgentId;
      const cf = key ? childFiles.get(key) : undefined;
      if (cf && !cf.claimed && cf.lastMs > -Infinity) {
        cf.claimed = true;
        s.childFile = cf;
      }
      s.meta = key ? metas.get(key) : undefined;
    }

    // The trace ends at the latest thing anything in it did.
    let endMs = root.lastMs;
    for (const s of spawns) {
      if (s.childFile) endMs = Math.max(endMs, s.childFile.lastMs);
      if (s.completedMs !== undefined) endMs = Math.max(endMs, s.completedMs);
      if (s.durationMs !== undefined) endMs = Math.max(endMs, s.event.tMs + s.durationMs);
    }
    const durationMs = Math.max(0, endMs - t0);

    const newAgent = (over: Partial<TraceAgent>): TraceAgent => ({
      id: 0,
      parent: -1,
      depth: 0,
      model: "other",
      modelId: "",
      agentType: "main",
      label: "Main session",
      spawnT: 0,
      returnT: durationMs / 1000,
      returned: false,
      background: false,
      usage: zeroUsage(),
      toolCalls: 0,
      childMissing: false,
      ...over,
    });

    const rootModel = fileModels.get(root) ?? "";
    const agents: TraceAgent[] = [newAgent({ model: modelFamily(rootModel), modelId: rootModel })];
    const windows: Window[] = [{ spawn: 0, ret: durationMs }];
    root.agent = 0;
    const spawnsOf = new Map<FileState, SpawnRec[]>();
    for (const s of spawns) {
      const list = spawnsOf.get(s.file);
      if (list) list.push(s);
      else spawnsOf.set(s.file, [s]);
    }
    const agentOfSpawn = new Map<SpawnRec, number>();
    const frontier: SpawnRec[] = [...(spawnsOf.get(root) ?? [])];
    const byTime = (a: SpawnRec, b: SpawnRec) => a.event.tMs - b.event.tMs || a.seq - b.seq;
    while (frontier.length > 0) {
      frontier.sort(byTime);
      const s = frontier.shift() as SpawnRec;
      const parent = s.file.agent;
      const pw = windows[parent];
      const spawnMs = clamp(s.event.tMs - t0, pw.spawn, pw.ret);
      let returned = true;
      let retRaw: number;
      if (s.childFile) retRaw = s.childFile.lastMs - t0;
      else if (s.durationMs !== undefined) retRaw = s.event.tMs - t0 + s.durationMs;
      else if (s.completedMs !== undefined) retRaw = s.completedMs - t0;
      else {
        returned = false;
        retRaw = durationMs;
      }
      const retMs = returned ? clamp(retRaw, spawnMs, pw.ret) : durationMs;
      const id = agents.length;
      const p = agents[parent];
      const cf = s.childFile;
      const modelId = (cf ? fileModels.get(cf) : undefined) ?? s.resolvedModel ?? s.meta?.model ?? s.model ?? p.modelId;
      const label = cutText((s.description ?? s.meta?.description ?? "").replace(/\s+/g, " ").trim(), 80);
      const agentType = s.subagentType ?? s.meta?.agentType ?? s.agentType ?? "general-purpose";
      const agent = newAgent({
        id,
        parent,
        depth: p.depth + 1,
        model: modelFamily(modelId),
        modelId,
        agentType,
        label: label || agentType,
        spawnT: spawnMs / 1000,
        returnT: retMs / 1000,
        returned,
        background: s.background,
        childMissing: !cf,
      });
      if (!cf) {
        // No transcript: the result's totals are all there is to show.
        agent.usage.input = Math.max(0, s.totalTokens ?? 0);
        agent.toolCalls = Math.max(0, s.toolUseCount ?? 0);
      }
      agents.push(agent);
      windows.push({ spawn: spawnMs, ret: retMs });
      agentOfSpawn.set(s, id);
      if (cf) {
        cf.agent = id;
        frontier.push(...(spawnsOf.get(cf) ?? []));
      }
    }

    // Events: one list in insertion order, clamped into each agent's window, then stably sorted.
    interface Out {
      t: number;
      ev: RawEvent;
      agent: number;
    }
    const outs: Out[] = [];
    const place = (ev: RawEvent, agent: number, t: number) => outs.push({ t, ev, agent });
    for (const ev of raw) {
      const agent = ev.file.agent;
      if (agent < 0) continue; // a transcript no spawn claimed
      if (ev.kind === "spawn") {
        const child = ev.spawn ? agentOfSpawn.get(ev.spawn) : undefined;
        if (child === undefined) continue;
        place(ev, agent, windows[child].spawn);
        continue;
      }
      const w = windows[agent];
      place(ev, agent, clamp(ev.tMs - t0, w.spawn, w.ret));
    }
    const placed = new Set(outs.map((o) => o.ev));
    // A result never precedes its call, and a call that was dropped takes its result with it.
    const callT = new Map<RawEvent, number>();
    for (const o of outs) if (o.ev.kind === "call") callT.set(o.ev, o.t);
    const kept: Out[] = [];
    for (const o of outs) {
      if (o.ev.kind === "result") {
        const ct = o.ev.call && placed.has(o.ev.call) ? callT.get(o.ev.call) : undefined;
        if (ct === undefined) continue;
        o.t = Math.max(o.t, ct);
      }
      kept.push(o);
    }

    // Returns are authored by the parent and sit at the child's returnT, after every spawn.
    const spawnOut = new Map<number, Out>();
    for (const o of kept) if (o.ev.kind === "spawn" && o.ev.spawn) spawnOut.set(agentOfSpawn.get(o.ev.spawn) as number, o);
    for (const s of spawns) {
      const id = agentOfSpawn.get(s);
      if (id === undefined || !agents[id].returned) continue;
      if (!spawnOut.has(id)) continue;
      const excerpt = (s.handback !== undefined ? takeExcerpt(s.handback, limits.excerpt) : undefined) ?? s.childFile?.lastText;
      const ev: RawEvent = {
        tMs: 0,
        file: s.file,
        kind: "return",
        spawn: s,
        excerpt,
        out: -1,
      };
      kept.push({ t: windows[id].ret, ev, agent: agents[id].parent });
    }

    kept.sort((a, b) => a.t - b.t); // Array.prototype.sort is stable
    kept.forEach((o, i) => (o.ev.out = i));

    const events: TraceEvent[] = kept.map((o) => {
      const { ev } = o;
      const e: TraceEvent = { t: o.t / 1000, agent: o.agent, kind: ev.kind };
      if (ev.category) e.category = ev.category;
      if (ev.tool) e.tool = ev.tool;
      if (ev.kind === "result" && ev.call) e.call = ev.call.out;
      if (ev.kind === "spawn" || ev.kind === "return") {
        const child = ev.spawn ? agentOfSpawn.get(ev.spawn) : undefined;
        if (child !== undefined) e.child = child;
        if (ev.kind === "return" && ev.spawn) e.call = ev.spawn.event.out;
      }
      if (ev.usage) e.usage = ev.usage;
      if (ev.isError !== undefined) e.isError = ev.isError;
      if (ev.excerpt !== undefined) e.excerpt = ev.excerpt;
      if (ev.permission !== undefined) e.permission = ev.permission;
      if (ev.size !== undefined) e.size = ev.size;
      if (ev.thinkMs !== undefined) e.thinkMs = ev.thinkMs;
      if (ev.compact) e.compact = ev.compact;
      return e;
    });

    for (const e of events) {
      const a = agents[e.agent];
      if (e.kind === "call" || e.kind === "spawn") a.toolCalls++;
      if (e.kind === "turn" && e.usage) {
        a.usage.input += e.usage.input;
        a.usage.output += e.usage.output;
        a.usage.cacheRead += e.usage.cacheRead;
        a.usage.cacheWrite += e.usage.cacheWrite;
      }
    }

    const trace: SessionTrace = {
      version: 1,
      source: "upload",
      label: "Your session",
      duration: durationMs / 1000,
      agents,
      events,
      truncated: caps.size > 0,
    };
    return { ok: true, trace, report: report() };
  }

  return { accepts, line, meta, report, finish };
}
