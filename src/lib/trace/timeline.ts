import { TOOL_CATEGORIES } from "./categories";
import type { EventKind, SessionTrace } from "./types";

/** A gap between consecutive events longer than this many trace seconds is cut... */
export const IDLE_GAP = 120;
/** ...to this many playback seconds. */
export const IDLE_KEEP = 8;

export const EVENT_KINDS: readonly EventKind[] = ["prompt", "turn", "call", "result", "spawn", "return"];
/** `category` array value for an event with no category. */
export const NO_CATEGORY = 255;

export interface Counters {
  /** Sum of every usage field over `turn` events so far. */
  tokens: number;
  /** `call` and `spawn` events so far (an Agent launch is a tool call too). */
  toolCalls: number;
  agentsSpawned: number;
  /** The orchestrator plus spawned agents that have not returned. */
  agentsActive: number;
  /** Session seconds, clamped to [0, duration]. */
  elapsed: number;
}

/** An idle stretch cut from playback: `at` is its playback position, `removed` the trace seconds cut. */
export interface IdleCut {
  at: number;
  removed: number;
}

export interface Timeline {
  trace: SessionTrace;
  /** Trace seconds. */
  duration: number;
  /** Playback seconds, after idle compression. */
  playbackDuration: number;
  cuts: IdleCut[];
  /** Event columns, index-aligned with `trace.events`; `playback` is each event's playback time. */
  arrays: {
    t: Float64Array;
    playback: Float64Array;
    agent: Int32Array;
    kind: Uint8Array;
    category: Uint8Array;
    call: Int32Array;
  };
  /** First event with `t > time` (trace seconds). */
  indexAt(time: number): number;
  countersAt(time: number): Counters;
  /** Events whose particle is alive at trace `time` and playback `rate`, as a half-open index range. */
  visibleAt(time: number, rate: number): [number, number];
  toPlayback(traceT: number): number;
  toTrace(playbackT: number): number;
}

/** Real seconds a particle lives at `rate`: 2 s at rate 1 down to 0.4 s from rate 25 up. */
export function particleLife(rate: number): number {
  if (!(rate > 0)) return 2;
  return Math.min(2, Math.max(0.4, 2 / Math.sqrt(rate)));
}

/** First index in sorted `a` with `a[i] > x`. */
function upperBound(a: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (a[mid] > x) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** First index in sorted `a` with `a[i] >= x`. */
function lowerBound(a: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (a[mid] >= x) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export function buildTimeline(trace: SessionTrace): Timeline {
  const { events, duration } = trace;
  const n = events.length;
  const t = new Float64Array(n);
  const agent = new Int32Array(n);
  const kind = new Uint8Array(n);
  const category = new Uint8Array(n);
  const call = new Int32Array(n);
  const cumTokens = new Float64Array(n + 1);
  const cumCalls = new Uint32Array(n + 1);
  const cumSpawned = new Uint32Array(n + 1);
  const cumReturned = new Uint32Array(n + 1);

  for (let i = 0; i < n; i++) {
    const e = events[i];
    t[i] = e.t;
    agent[i] = e.agent;
    kind[i] = EVENT_KINDS.indexOf(e.kind);
    category[i] = e.category ? TOOL_CATEGORIES.indexOf(e.category) : NO_CATEGORY;
    call[i] = e.call ?? -1;
    const u = e.kind === "turn" ? e.usage : undefined;
    cumTokens[i + 1] = cumTokens[i] + (u ? u.input + u.output + u.cacheRead + u.cacheWrite : 0);
    cumCalls[i + 1] = cumCalls[i] + (e.kind === "call" || e.kind === "spawn" ? 1 : 0);
    cumSpawned[i + 1] = cumSpawned[i] + (e.kind === "spawn" ? 1 : 0);
    cumReturned[i + 1] = cumReturned[i] + (e.kind === "return" ? 1 : 0);
  }

  // Idle compression: cut every long gap between consecutive points (start, events, end).
  const cutStart: number[] = [];
  const cutEnd: number[] = [];
  const cutPb: number[] = []; // playback position of each cut
  const cumBefore: number[] = []; // trace seconds removed by earlier cuts
  const cuts: IdleCut[] = [];
  let removedSoFar = 0;
  let prev = 0;
  for (let i = 0; i <= n; i++) {
    const cur = i < n ? t[i] : Math.max(duration, prev);
    const gap = cur - prev;
    if (gap > IDLE_GAP) {
      const removed = gap - IDLE_KEEP;
      cutStart.push(prev);
      cutEnd.push(cur);
      cumBefore.push(removedSoFar);
      cutPb.push(prev - removedSoFar);
      cuts.push({ at: prev - removedSoFar, removed });
      removedSoFar += removed;
    }
    prev = cur;
  }

  const toPlayback = (traceT: number): number => {
    const x = Math.min(Math.max(traceT, 0), duration);
    const k = lowerBound(cutStart, x); // cuts 0..k-1 start before x
    if (k === 0) return x;
    const j = k - 1;
    if (x >= cutEnd[j]) return x - cumBefore[j] - cuts[j].removed;
    return cutPb[j] + (IDLE_KEEP * (x - cutStart[j])) / (cutEnd[j] - cutStart[j]);
  };

  const playbackDuration = toPlayback(duration);

  const toTrace = (playbackT: number): number => {
    const x = Math.min(Math.max(playbackT, 0), playbackDuration);
    const k = lowerBound(cutPb, x);
    if (k === 0) return x;
    const j = k - 1;
    if (x >= cutPb[j] + IDLE_KEEP) return x + cumBefore[j] + cuts[j].removed;
    return cutStart[j] + ((x - cutPb[j]) / IDLE_KEEP) * (cutEnd[j] - cutStart[j]);
  };

  const playback = new Float64Array(n);
  for (let i = 0; i < n; i++) playback[i] = toPlayback(t[i]);

  const indexAt = (time: number): number => upperBound(t, time);

  return {
    trace,
    duration,
    playbackDuration,
    cuts,
    arrays: { t, playback, agent, kind, category, call },
    indexAt,
    countersAt(time) {
      const i = indexAt(time);
      return {
        tokens: cumTokens[i],
        toolCalls: cumCalls[i],
        agentsSpawned: cumSpawned[i],
        agentsActive: 1 + cumSpawned[i] - cumReturned[i],
        elapsed: Math.min(Math.max(time, 0), duration),
      };
    },
    visibleAt(time, rate) {
      const hi = indexAt(time);
      const span = particleLife(rate) * Math.max(rate, 0);
      const lo = upperBound(playback, toPlayback(time) - span);
      return [Math.min(lo, hi), hi];
    },
    toPlayback,
    toTrace,
  };
}
