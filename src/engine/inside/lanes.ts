/**
 * The scrubber's three lanes: prompts, agents (coloured by model) and tool calls, binned over
 * playback time (idle stretches already compressed), plus the tick marks of the time axis. Pure.
 */

import { buildCalls } from "@/lib/trace/calls";
import type { Timeline } from "@/lib/trace/timeline";
import type { CompactInfo, ModelFamily, SessionTrace } from "@/lib/trace/types";
import { clock, shortClock } from "./format";

export const LANE_BINS = 120;

export interface Lanes {
  bins: number;
  prompts: number[];
  agents: number[];
  /** The model most agents in the bin belong to; "other" for an empty bin. */
  agentModel: ModelFamily[];
  tools: number[];
}

export function buildLanes(tl: Timeline, bins = LANE_BINS): Lanes {
  const { trace } = tl;
  const { kind, playback } = tl.arrays;
  const span = Math.max(tl.playbackDuration, 1e-9);
  const prompts = new Array<number>(bins).fill(0);
  const agents = new Array<number>(bins).fill(0);
  const tools = new Array<number>(bins).fill(0);
  const models: Map<ModelFamily, number>[] = Array.from({ length: bins }, () => new Map());

  for (let i = 0; i < trace.events.length; i++) {
    const bin = Math.min(bins - 1, Math.max(0, Math.floor((playback[i] / span) * bins)));
    const k = kind[i];
    if (k === 0) prompts[bin]++; // prompt
    if (k === 2 || k === 4) tools[bin]++; // call, spawn
    if (k === 4) {
      agents[bin]++;
      const child = trace.events[i].child;
      const m = child !== undefined ? (trace.agents[child]?.model ?? "other") : "other";
      models[bin].set(m, (models[bin].get(m) ?? 0) + 1);
    }
  }
  const agentModel = models.map((m): ModelFamily => {
    let best: ModelFamily = "other";
    let n = 0;
    for (const [model, c] of m) {
      if (c > n) {
        best = model;
        n = c;
      }
    }
    return best;
  });
  return { bins, prompts, agents, agentModel, tools };
}

/** Bar height in px: 1 for an empty bin, else 3 up to `maxPx` by square root so one spike does not flatten the rest. */
export function barHeight(count: number, max: number, maxPx: number): number {
  if (count <= 0 || max <= 0) return 1;
  return Math.max(3, Math.round(Math.sqrt(count / max) * maxPx));
}

export interface AxisTick {
  /** 0..1 along the playback axis. */
  at: number;
  label: string;
}

/** Least gap between two ticks, as a fraction of the axis, so their labels never overlap. */
const MIN_TICK_GAP = 0.07;
const STEPS = [60, 120, 300, 600, 900, 1200, 1800, 3600, 7200, 14400];

/** Time-axis ticks in trace time, placed through the idle compression; about five of them. */
export function axisTicks(tl: Timeline): AxisTick[] {
  if (tl.duration <= 0 || tl.playbackDuration <= 0) return [{ at: 0, label: "00:00" }];
  const step = STEPS.find((s) => tl.duration / s <= 5) ?? STEPS[STEPS.length - 1];
  const long = tl.duration >= 3600;
  const out: AxisTick[] = [];
  for (let s = 0; s <= tl.duration; s += step) {
    const at = tl.toPlayback(s) / tl.playbackDuration;
    // An idle cut can pile several ticks on one spot; keep the first.
    if (out.length === 0 || at - out[out.length - 1].at >= MIN_TICK_GAP) out.push({ at, label: long ? clock(s).slice(0, 5) : shortClock(s) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Per-agent lanes: what each agent was doing, second by second (trace time, not playback time).
// ---------------------------------------------------------------------------------------------

export type SegmentKind = "think" | "tool" | "waiting-on-you" | "idle";

export interface LaneSegment {
  kind: SegmentKind;
  /** Trace seconds. */
  start: number;
  end: number;
  /** tool and permission waits: the tool. */
  tool?: string;
  /** waiting-on-you: a permission prompt on a tool call, or the gap before your next prompt. */
  on?: "permission" | "prompt";
}

export interface ErrorTick {
  t: number;
  tool: string;
}

/** A retry is INFERRED: a failed call followed within `RETRY_WINDOW` seconds by another call of the same tool by the same agent. */
export interface RetryMark {
  /** When the second attempt started. */
  t: number;
  tool: string;
  /** When the first attempt failed. */
  failedAt: number;
  inferred: true;
}

export interface CompactionMark extends CompactInfo {
  t: number;
}

/** A tool call that waited on a human permission answer. */
export interface PermissionPause {
  t: number;
  duration: number;
  tool: string;
}

export interface AgentLane {
  agent: number;
  start: number;
  end: number;
  /** Contiguous, in order, covering [start, end]. */
  segments: LaneSegment[];
  errors: ErrorTick[];
  retries: RetryMark[];
  /** The orchestrator's lane only. */
  compactions: CompactionMark[];
  pauses: PermissionPause[];
}

/** A failed call this soon before another call of the same tool counts as retried. */
export const RETRY_WINDOW = 20;
/** The gap before a human prompt must be at least this long (seconds) to read as waiting on you. */
export const HUMAN_GAP_MIN = 5;

const PRIORITY: Record<SegmentKind, number> = { idle: 0, think: 1, tool: 2, "waiting-on-you": 3 };

interface Span extends LaneSegment {
  kind: Exclude<SegmentKind, "idle">;
}

function laneRange(trace: SessionTrace, id: number): [number, number] {
  const a = trace.agents[id];
  if (!a) return [0, 0];
  const start = id === 0 ? 0 : a.spawnT;
  const end = id === 0 ? trace.duration : a.returned ? a.returnT : trace.duration;
  return [start, Math.max(start, end)];
}

/** Lay overlapping spans onto one line: the highest priority wins each stretch; gaps are idle. */
function flatten(spans: Span[], start: number, end: number): LaneSegment[] {
  const cut = new Set<number>([start, end]);
  const clipped: Span[] = [];
  for (const sp of spans) {
    const s = Math.max(start, sp.start);
    const e = Math.min(end, sp.end);
    if (e > s) {
      clipped.push({ ...sp, start: s, end: e });
      cut.add(s);
      cut.add(e);
    }
  }
  clipped.sort((a, b) => a.start - b.start);
  const points = [...cut].sort((a, b) => a - b);
  const out: LaneSegment[] = [];
  let next = 0;
  let active: Span[] = [];
  for (let k = 0; k + 1 < points.length; k++) {
    const a = points[k];
    const b = points[k + 1];
    while (next < clipped.length && clipped[next].start <= a) active.push(clipped[next++]);
    active = active.filter((sp) => sp.end > a);
    let top: Span | undefined;
    for (const sp of active) if (!top || PRIORITY[sp.kind] > PRIORITY[top.kind]) top = sp;
    const seg: LaneSegment = top ? { kind: top.kind, start: a, end: b, tool: top.tool, on: top.on } : { kind: "idle", start: a, end: b };
    const prev = out[out.length - 1];
    if (prev && prev.kind === seg.kind && prev.tool === seg.tool && prev.on === seg.on) prev.end = b;
    else out.push(seg);
  }
  return out;
}

/**
 * One lane per agent. Segments: `think` (a turn's recorded thinking time, ending at the turn),
 * `tool` (a call in flight), `waiting-on-you` (a call whose result says `permission: "user"`, and
 * the orchestrator's stretch of silence before each human prompt), `idle` (everything else). A trace
 * without `thinkMs` or `permission` just has no think or waiting-on-you-by-permission segments.
 */
export function buildAgentLanes(trace: SessionTrace): AgentLane[] {
  const calls = buildCalls(trace).filter((c) => !c.spawn);
  const spans: Span[][] = trace.agents.map(() => []);
  const lanes: AgentLane[] = trace.agents.map((a) => {
    const [start, end] = laneRange(trace, a.id);
    return { agent: a.id, start, end, segments: [], errors: [], retries: [], compactions: [], pauses: [] };
  });

  for (const c of calls) {
    const lane = lanes[c.agent];
    if (!lane) continue;
    if (c.resolved && c.duration > 0) {
      const waits = c.permission === "user";
      spans[c.agent].push({
        kind: waits ? "waiting-on-you" : "tool",
        start: c.start,
        end: c.start + c.duration,
        tool: c.tool,
        on: waits ? "permission" : undefined,
      });
      if (waits) lane.pauses.push({ t: c.start, duration: c.duration, tool: c.tool });
    }
    if (c.isError) lane.errors.push({ t: c.start + c.duration, tool: c.tool });
  }

  // Inferred retries: per agent and tool, a failure followed soon by another call.
  const byKey = new Map<string, typeof calls>();
  for (const c of calls) {
    const k = `${c.agent}:${c.tool}`;
    const list = byKey.get(k);
    if (list) list.push(c);
    else byKey.set(k, [c]);
  }
  for (const list of byKey.values()) {
    for (let i = 0; i + 1 < list.length; i++) {
      const c = list[i];
      const failedAt = c.start + c.duration;
      const nextCall = list[i + 1];
      if (c.isError && nextCall.start >= failedAt && nextCall.start - failedAt <= RETRY_WINDOW) {
        lanes[c.agent].retries.push({ t: nextCall.start, tool: c.tool, failedAt, inferred: true });
      }
    }
  }

  let lastActivity = -1;
  trace.events.forEach((e) => {
    const lane = lanes[e.agent];
    if (e.kind === "turn" && e.thinkMs && e.thinkMs > 0 && lane) {
      spans[e.agent].push({ kind: "think", start: e.t - e.thinkMs / 1000, end: e.t });
    } else if (e.kind === "compact" && e.compact && e.agent === 0 && lane) {
      lane.compactions.push({ t: e.t, ...e.compact });
    } else if (e.kind === "prompt" && e.agent === 0) {
      if (lastActivity >= 0 && e.t - lastActivity >= HUMAN_GAP_MIN) {
        spans[0].push({ kind: "waiting-on-you", start: lastActivity, end: e.t, on: "prompt" });
      }
    }
    if (e.kind !== "compact" && e.kind !== "prompt") lastActivity = Math.max(lastActivity, e.t);
  });

  for (const lane of lanes) {
    lane.segments = flatten(spans[lane.agent], lane.start, lane.end);
    lane.errors.sort((a, b) => a.t - b.t);
    lane.retries.sort((a, b) => a.t - b.t);
    lane.pauses.sort((a, b) => a.t - b.t);
  }
  return lanes;
}
