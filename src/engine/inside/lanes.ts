/**
 * The scrubber's three lanes: prompts, agents (coloured by model) and tool calls, binned over
 * playback time (idle stretches already compressed), plus the tick marks of the time axis. Pure.
 */

import type { Timeline } from "@/lib/trace/timeline";
import type { ModelFamily } from "@/lib/trace/types";
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
