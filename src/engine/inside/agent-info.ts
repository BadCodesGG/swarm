/**
 * What the detail card shows about one agent at trace time `t`: state, running time, tokens, calls,
 * helpers, the tool mix, the brief it was handed and its last call. Pure. Text fields come from the
 * session and must render as React text only.
 */

import type { Timeline } from "@/lib/trace/timeline";
import type { ModelFamily, SessionTrace, ToolCategory } from "@/lib/trace/types";

export type AgentState = "waiting" | "running" | "returned";

export interface AgentInfo {
  id: number;
  label: string;
  model: ModelFamily;
  modelId: string;
  state: AgentState;
  /** Trace seconds the agent has run: up to `t`, or its whole run once returned. */
  running: number;
  tokens: number;
  calls: number;
  helpers: number;
  /** Calls per tool category so far, most used first. */
  mix: { category: ToolCategory; count: number }[];
  /** The text the agent was started with, else what its parent last said, else its label. */
  brief: string;
  lastCall: { t: number; text: string } | null;
  spawnT: number;
}

interface Index {
  /** Event indices per agent, ascending. */
  byAgent: number[][];
  /** The spawn event (index) that started each agent, or -1. */
  spawnOf: Int32Array;
}

const cache = new WeakMap<SessionTrace, Index>();

function indexOf(trace: SessionTrace): Index {
  let ix = cache.get(trace);
  if (ix) return ix;
  const byAgent: number[][] = trace.agents.map(() => []);
  const spawnOf = new Int32Array(trace.agents.length).fill(-1);
  trace.events.forEach((e, i) => {
    byAgent[e.agent]?.push(i);
    if (e.kind === "spawn" && e.child !== undefined && e.child < spawnOf.length) spawnOf[e.child] = i;
  });
  ix = { byAgent, spawnOf };
  cache.set(trace, ix);
  return ix;
}

export function agentInfo(tl: Timeline, id: number, t: number): AgentInfo | null {
  const { trace } = tl;
  const a = trace.agents[id];
  if (!a) return null;
  const ix = indexOf(trace);

  let tokens = 0;
  let calls = 0;
  let last = -1;
  const mix = new Map<ToolCategory, number>();
  for (const i of ix.byAgent[id]) {
    const e = trace.events[i];
    if (e.t > t) break;
    if (e.kind === "turn" && e.usage) tokens += e.usage.input + e.usage.output + e.usage.cacheRead + e.usage.cacheWrite;
    else if (e.kind === "call" || e.kind === "spawn") {
      calls++;
      last = i;
      const c = e.category ?? "other";
      mix.set(c, (mix.get(c) ?? 0) + 1);
    }
  }

  const spawn = ix.spawnOf[id];
  let brief = spawn >= 0 ? (trace.events[spawn].excerpt ?? "") : "";
  if (!brief && spawn >= 0) {
    for (const i of ix.byAgent[trace.events[spawn].agent]) {
      const e = trace.events[i];
      if (e.t > a.spawnT) break;
      if (e.kind === "turn" && e.excerpt) brief = e.excerpt;
    }
  }

  const lastEvent = last >= 0 ? trace.events[last] : null;
  const returnedNow = a.returned && t >= a.returnT;
  const state: AgentState = t < a.spawnT ? "waiting" : returnedNow ? "returned" : "running";

  return {
    id,
    label: a.label,
    model: a.model,
    modelId: a.modelId,
    state,
    running: Math.max(0, Math.min(t, a.returned ? a.returnT : t) - a.spawnT),
    tokens,
    calls,
    helpers: trace.agents.reduce((n, c) => n + (c.parent === id && c.spawnT <= t ? 1 : 0), 0),
    mix: [...mix.entries()].map(([category, count]) => ({ category, count })).sort((x, y) => y.count - x.count),
    brief: brief || a.label,
    lastCall: lastEvent ? { t: lastEvent.t, text: lastEvent.excerpt ? `${lastEvent.tool ?? "call"} "${lastEvent.excerpt}"` : (lastEvent.tool ?? "call") } : null,
    spawnT: a.spawnT,
  };
}
