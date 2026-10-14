/**
 * The roster: one row per agent at trace time `t`. Pure. Briefs and labels come from the session and
 * must render as React text only.
 */

import type { Timeline } from "@/lib/trace/timeline";
import type { ModelFamily, SessionTrace } from "@/lib/trace/types";
import { MODEL_NAMES } from "./format";
import { waitingOnYouAt } from "./lanes";

/**
 * waiting: not started yet. working: running. waiting-on-you: live, but held on a permission prompt
 * or (the orchestrator) on your next prompt. done: returned. failed: its launch failed.
 */
export type RosterStatus = "waiting" | "working" | "waiting-on-you" | "done" | "failed";

/** Whether the status means the agent is out there (working or waiting on you). */
export const isLive = (s: RosterStatus): boolean => s === "working" || s === "waiting-on-you";

export interface RosterEntry {
  id: number;
  model: ModelFamily;
  /** The agent's own description, at most 80 chars. */
  label: string;
  /** The brief the parent handed it, at most 280 chars; "" when the trace carries none. */
  excerpt: string;
  /** Every usage field of its turns so far. */
  tokens: number;
  /** Trace seconds between its start and `t` (or its return). */
  activeTime: number;
  status: RosterStatus;
  /** -1 for the orchestrator. */
  parent: number;
  children: number[];
}

/** A short, safe name for logs and chips: never session text. */
export function agentName(trace: SessionTrace, id: number): string {
  if (id === 0) return "Orchestrator";
  const a = trace.agents[id];
  return a ? `${MODEL_NAMES[a.model]} ${id}` : `Agent ${id}`;
}

interface Facts {
  /** Per agent: turn times ascending and the running token total after each. */
  turnT: number[][];
  turnCum: number[][];
  spawn: (number | undefined)[];
  failed: boolean[];
  brief: string[];
  children: number[][];
}

const cache = new WeakMap<SessionTrace, Facts>();

function facts(trace: SessionTrace): Facts {
  const hit = cache.get(trace);
  if (hit) return hit;
  const n = trace.agents.length;
  const f: Facts = {
    turnT: trace.agents.map(() => []),
    turnCum: trace.agents.map(() => []),
    spawn: new Array<number | undefined>(n).fill(undefined),
    failed: new Array<boolean>(n).fill(false),
    brief: new Array<string>(n).fill(""),
    children: trace.agents.map(() => []),
  };
  trace.agents.forEach((a) => {
    if (a.parent >= 0 && f.children[a.parent]) f.children[a.parent].push(a.id);
  });
  for (const e of trace.events) {
    if (e.kind === "turn" && e.usage && f.turnT[e.agent]) {
      const cum = f.turnCum[e.agent];
      const u = e.usage;
      cum.push((cum[cum.length - 1] ?? 0) + u.input + u.output + u.cacheRead + u.cacheWrite);
      f.turnT[e.agent].push(e.t);
    } else if (e.kind === "spawn" && e.child !== undefined && e.child < n) {
      f.spawn[e.child] = e.t;
      f.failed[e.child] = e.isError === true;
      f.brief[e.child] = e.excerpt ?? "";
    }
  }
  cache.set(trace, f);
  return f;
}

/** The brief a parent gave `child`, "" when the trace has none. */
export function briefOf(trace: SessionTrace, child: number): string {
  return facts(trace).brief[child] ?? "";
}

/** The trace second an agent's run ends: its return, else the end of the session. */
export function agentEnd(trace: SessionTrace, id: number): number {
  const a = trace.agents[id];
  return !a ? trace.duration : a.returned ? a.returnT : trace.duration;
}

/** Tokens an agent's own turns had used by `t`: one binary search. */
export function agentTokensAt(trace: SessionTrace, id: number, t: number): number {
  const f = facts(trace);
  const times = f.turnT[id];
  if (!times) return 0;
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid] > t) hi = mid;
    else lo = mid + 1;
  }
  return lo === 0 ? 0 : f.turnCum[id][lo - 1];
}

export function rosterStatus(trace: SessionTrace, id: number, t: number): RosterStatus {
  const a = trace.agents[id];
  if (!a) return "waiting";
  if (t < a.spawnT) return "waiting";
  if (facts(trace).failed[id]) return "failed";
  if (t >= agentEnd(trace, id) && (a.returned || id === 0)) return "done";
  return waitingOnYouAt(trace, id, t) ? "waiting-on-you" : "working";
}

export function rosterEntry(trace: SessionTrace, id: number, t: number): RosterEntry | null {
  const a = trace.agents[id];
  if (!a) return null;
  const f = facts(trace);
  return {
    id,
    model: a.model,
    label: a.label,
    excerpt: f.brief[id] ?? "",
    tokens: agentTokensAt(trace, id, t),
    activeTime: Math.max(0, Math.min(t, agentEnd(trace, id)) - a.spawnT),
    status: rosterStatus(trace, id, t),
    parent: a.parent,
    children: f.children[id],
  };
}

/** Every agent, in id order, at trace time `t`. */
export function rosterAt(tl: Timeline, t: number): RosterEntry[] {
  const out: RosterEntry[] = [];
  for (let id = 0; id < tl.trace.agents.length; id++) {
    const e = rosterEntry(tl.trace, id, t);
    if (e) out.push(e);
  }
  return out;
}
