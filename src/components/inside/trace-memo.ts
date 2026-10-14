/** Per-trace results the HUD reads from several places, built once per trace. */

import { buildAgentLanes, type AgentLane } from "@/engine/inside/lanes";
import { buildRecap, type Recap } from "@/engine/inside/recap";
import { stationCalls, type CallRecord } from "@/lib/trace/calls";
import type { SessionTrace } from "@/lib/trace/types";

const lanes = new WeakMap<SessionTrace, AgentLane[]>();
const recaps = new WeakMap<SessionTrace, Recap>();
const calls = new WeakMap<SessionTrace, Map<string, CallRecord[]>>();

export function lanesOf(trace: SessionTrace): AgentLane[] {
  let hit = lanes.get(trace);
  if (!hit) lanes.set(trace, (hit = buildAgentLanes(trace)));
  return hit;
}

export function recapOf(trace: SessionTrace): Recap {
  let hit = recaps.get(trace);
  if (!hit) recaps.set(trace, (hit = buildRecap(trace, lanesOf(trace))));
  return hit;
}

/** Every call of one station, in start order. */
export function callsOf(trace: SessionTrace, key: string): CallRecord[] {
  let byKey = calls.get(trace);
  if (!byKey) calls.set(trace, (byKey = new Map()));
  let hit = byKey.get(key);
  if (!hit) byKey.set(key, (hit = stationCalls(trace, key)));
  return hit;
}

/** How many of `list` (in start order) had started by `t`. */
export function startedBy(list: readonly CallRecord[], t: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (list[mid].start > t) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
