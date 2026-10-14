/**
 * The HUD's instruments, read at a trace time `t`: agents, tool mix, model mix, token rate, the
 * orchestrator's context gauge and a live log. Everything is precomputed once per timeline into
 * cumulative arrays, so each read is one binary search plus a little arithmetic: fine to call every
 * animation frame. Pure. Log lines carry agent names, tool names and numbers, never session text.
 */

import { MODEL_FAMILIES, TOOL_CATEGORIES } from "@/lib/trace/categories";
import type { Timeline } from "@/lib/trace/timeline";
import type { EventKind, ModelFamily, ToolCategory } from "@/lib/trace/types";
import { compact as compactNumber } from "./format";
import { agentName } from "./roster";

/** The nominal context window the gauge is measured against. */
export const CONTEXT_WINDOW = 1_000_000;
/** Seconds the rolling token rate looks back over. */
export const RATE_WINDOW = 60;

export interface LogLine {
  t: number;
  kind: EventKind;
  agent: number;
  text: string;
}

export interface ContextReading {
  /** Tokens in the orchestrator's context: input + cacheRead + cacheWrite of its latest turn, or the size left after a compaction. */
  tokens: number;
  /** tokens / CONTEXT_WINDOW, clamped to 0..1. */
  fraction: number;
}

export interface Instruments {
  agentsAt(t: number): { spawned: number; active: number };
  /** Calls and launches so far per category. */
  toolMixAt(t: number): Record<ToolCategory, number>;
  /** Tokens so far per model family. */
  modelMixAt(t: number): Record<ModelFamily, number>;
  /** Tokens per minute over the last `RATE_WINDOW` seconds (less at the start of the run). */
  tokensPerMinuteAt(t: number): number;
  /** The rate sampled at `points` evenly spaced times over the whole run, for a sparkline. */
  tokensPerMinuteSeries(points: number): number[];
  contextAt(t: number): ContextReading;
  /** The last `n` loggable events at or before `t`, oldest first. */
  logAt(t: number, n?: number): LogLine[];
}

const NC = TOOL_CATEGORIES.length;
const NM = MODEL_FAMILIES.length;

function emptyRecord<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
}

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

const cache = new WeakMap<Timeline, Instruments>();

export function buildInstruments(tl: Timeline): Instruments {
  const hit = cache.get(tl);
  if (hit) return hit;
  const { trace } = tl;
  const { events } = trace;
  const n = events.length;

  const toolCum = new Uint32Array((n + 1) * NC);
  const modelCum = new Float64Array((n + 1) * NM);
  const ctxT: number[] = [];
  const ctxV: number[] = [];
  for (let i = 0; i < n; i++) {
    const e = events[i];
    toolCum.copyWithin((i + 1) * NC, i * NC, (i + 1) * NC);
    modelCum.copyWithin((i + 1) * NM, i * NM, (i + 1) * NM);
    if (e.kind === "call" || e.kind === "spawn") {
      toolCum[(i + 1) * NC + Math.max(0, TOOL_CATEGORIES.indexOf(e.category ?? "other"))]++;
    } else if (e.kind === "turn" && e.usage) {
      const u = e.usage;
      const m = Math.max(0, MODEL_FAMILIES.indexOf(trace.agents[e.agent]?.model ?? "other"));
      modelCum[(i + 1) * NM + m] += u.input + u.output + u.cacheRead + u.cacheWrite;
      if (e.agent === 0) {
        ctxT.push(e.t);
        ctxV.push(u.input + u.cacheRead + u.cacheWrite);
      }
    } else if (e.kind === "compact" && e.compact && e.agent === 0) {
      ctxT.push(e.t);
      ctxV.push(e.compact.postTokens);
    }
  }

  const tokensAt = (t: number) => tl.countersAt(t).tokens;
  const rateAt = (t: number): number => {
    const x = Math.min(Math.max(t, 0), tl.duration);
    const w = Math.min(RATE_WINDOW, x);
    return w > 0 ? ((tokensAt(x) - tokensAt(x - w)) * 60) / w : 0;
  };

  const lineFor = (i: number): LogLine | null => {
    const e = events[i];
    const who = agentName(trace, e.agent);
    const child = e.child !== undefined ? agentName(trace, e.child) : "a subagent";
    let text: string | null = null;
    switch (e.kind) {
      case "prompt":
        text = "You sent a prompt";
        break;
      case "call":
        text = `${who} called ${e.tool ?? "a tool"}`;
        break;
      case "result":
        if (e.isError) text = `${e.tool ?? "A tool"} failed for ${who}`;
        break;
      case "spawn":
        text = e.isError ? `${who} failed to start ${child}` : `${who} started ${child}`;
        break;
      case "return":
        text = `${child} reported back to ${who}`;
        break;
      case "compact":
        if (e.compact) text = `Context compacted: ${compactNumber(e.compact.preTokens)} to ${compactNumber(e.compact.postTokens)} tokens`;
        break;
    }
    return text === null ? null : { t: e.t, kind: e.kind, agent: e.agent, text };
  };

  const inst: Instruments = {
    agentsAt(t) {
      const c = tl.countersAt(t);
      return { spawned: c.agentsSpawned, active: c.agentsActive };
    },
    toolMixAt(t) {
      const base = tl.indexAt(t) * NC;
      const out = emptyRecord(TOOL_CATEGORIES);
      TOOL_CATEGORIES.forEach((c, k) => (out[c] = toolCum[base + k]));
      return out;
    },
    modelMixAt(t) {
      const base = tl.indexAt(t) * NM;
      const out = emptyRecord(MODEL_FAMILIES);
      MODEL_FAMILIES.forEach((m, k) => (out[m] = modelCum[base + k]));
      return out;
    },
    tokensPerMinuteAt: rateAt,
    tokensPerMinuteSeries(points) {
      const k = Math.max(0, Math.floor(points));
      return Array.from({ length: k }, (_, i) => rateAt(k <= 1 ? tl.duration : (i / (k - 1)) * tl.duration));
    },
    contextAt(t) {
      const i = upperBound(ctxT, t);
      const tokens = i === 0 ? 0 : ctxV[i - 1];
      return { tokens, fraction: Math.min(1, Math.max(0, tokens / CONTEXT_WINDOW)) };
    },
    logAt(t, count = 8) {
      const out: LogLine[] = [];
      for (let i = tl.indexAt(t) - 1; i >= 0 && out.length < count; i--) {
        const line = lineFor(i);
        if (line) out.push(line);
      }
      return out.reverse();
    },
  };
  cache.set(tl, inst);
  return inst;
}
