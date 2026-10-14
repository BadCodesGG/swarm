/**
 * Every tool call and subagent launch of a trace paired with its outcome: when it started, how long
 * it took, how big the result was, whether it failed and who allowed it. Pure. A record carries no
 * arguments: the trace holds none except a launch's brief, which stays on its spawn event. Traces that predate a field (`size`, `permission`,
 * `isError`) simply leave it unset.
 */

import type { PermissionSource, SessionTrace, ToolCategory } from "./types";

export interface CallRecord {
  /** Index of the `call` or `spawn` event in `trace.events`. */
  index: number;
  agent: number;
  tool: string;
  category: ToolCategory;
  /** Trace seconds. */
  start: number;
  /** Seconds from the call to its result (or, for a launch, to the subagent's return); 0 when none was recorded. */
  duration: number;
  /** True when a result (or return) was found for this call. */
  resolved: boolean;
  /** Characters in the result content. Unset on launches and on traces that do not carry it. */
  size?: number;
  isError: boolean;
  permission?: PermissionSource;
  /** A subagent launch rather than a plain tool call. */
  spawn: boolean;
  /** Launches: the subagent's id. */
  child?: number;
}

const cache = new WeakMap<SessionTrace, CallRecord[]>();

/** All calls and launches, in start order. Cached per trace. */
export function buildCalls(trace: SessionTrace): CallRecord[] {
  const hit = cache.get(trace);
  if (hit) return hit;
  const { events } = trace;
  // result.call / return.call point at the event that began the call.
  const closer = new Map<number, number>();
  events.forEach((e, i) => {
    if ((e.kind === "result" || e.kind === "return") && e.call !== undefined) closer.set(e.call, i);
  });
  const out: CallRecord[] = [];
  events.forEach((e, i) => {
    if (e.kind !== "call" && e.kind !== "spawn") return;
    const spawn = e.kind === "spawn";
    const ci = closer.get(i);
    const end = ci === undefined ? undefined : events[ci];
    out.push({
      index: i,
      agent: e.agent,
      tool: e.tool ?? (spawn ? "Agent" : "tool"),
      category: e.category ?? (spawn ? "agents" : "other"),
      start: e.t,
      duration: end ? Math.max(0, end.t - e.t) : 0,
      resolved: end !== undefined,
      size: spawn ? undefined : end?.size,
      isError: spawn ? e.isError === true : end?.isError === true,
      permission: spawn ? undefined : end?.permission,
      spawn,
      child: spawn ? e.child : undefined,
    });
  });
  cache.set(trace, out);
  return out;
}

/**
 * The calls one station shows: a tool category (`"files"`) or one tool name (`"Read"`), in start
 * order. `until` keeps only calls that have started by that trace time.
 */
export function stationCalls(trace: SessionTrace, key: ToolCategory | string, until = Infinity): CallRecord[] {
  return buildCalls(trace).filter((c) => (c.category === key || c.tool === key) && c.start <= until);
}
