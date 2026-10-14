/**
 * The end-of-run recap. Pure. Every number is derived from the trace; a trace that predates a field
 * (`permission`, `thinkMs`, `compact`) just reports zero or null for what depends on it.
 */

import { buildCalls } from "@/lib/trace/calls";
import { MODEL_FAMILIES } from "@/lib/trace/categories";
import type { ModelFamily, SessionTrace } from "@/lib/trace/types";
import { buildAgentLanes, type AgentLane } from "./lanes";
import { agentName } from "./roster";

export interface LongestWait {
  /** Seconds. */
  duration: number;
  /** When it began, trace seconds. */
  t: number;
  /** A tool's permission prompt, or the gap before your next prompt. */
  on: "permission" | "prompt";
  /** The tool it waited on (permission waits only). */
  tool?: string;
  agent: number;
  /** "Orchestrator waited on you to allow Bash" / "waited on your next prompt", a ready sentence. */
  text: string;
}

export interface Recap {
  agentsSpawned: number;
  /** The most subagents running at once (the orchestrator is not counted). */
  peakParallel: number;
  tokensByModel: Record<ModelFamily, number>;
  longestWait: LongestWait | null;
  /** Failed tool calls plus failed launches. */
  failedCalls: number;
  compactions: number;
  /** Agent-seconds summed over every lane. */
  time: { think: number; tool: number; waiting: number };
}

function sum(lanes: AgentLane[], kind: "think" | "tool" | "waiting-on-you"): number {
  let s = 0;
  for (const l of lanes) for (const g of l.segments) if (g.kind === kind) s += g.end - g.start;
  return s;
}

export function buildRecap(trace: SessionTrace, lanes: AgentLane[] = buildAgentLanes(trace)): Recap {
  const subs = trace.agents.filter((a) => a.id !== 0);
  // Sweep subagent starts and ends for the peak.
  const edges: [number, number][] = [];
  for (const a of subs) {
    edges.push([a.spawnT, 1]);
    edges.push([a.returned ? a.returnT : trace.duration, -1]);
  }
  edges.sort((x, y) => x[0] - y[0] || x[1] - y[1]); // an end before a start at the same instant
  let live = 0;
  let peakParallel = 0;
  for (const [, d] of edges) {
    live += d;
    peakParallel = Math.max(peakParallel, live);
  }

  const tokensByModel = Object.fromEntries(MODEL_FAMILIES.map((m) => [m, 0])) as Record<ModelFamily, number>;
  for (const e of trace.events) {
    if (e.kind === "turn" && e.usage) {
      tokensByModel[trace.agents[e.agent]?.model ?? "other"] += e.usage.input + e.usage.output + e.usage.cacheRead + e.usage.cacheWrite;
    }
  }

  let longestWait: LongestWait | null = null;
  for (const l of lanes) {
    for (const g of l.segments) {
      if (g.kind !== "waiting-on-you" || (longestWait && g.end - g.start <= longestWait.duration)) continue;
      const on = g.on ?? "permission";
      longestWait = {
        duration: g.end - g.start,
        t: g.start,
        on,
        tool: g.tool,
        agent: l.agent,
        text:
          on === "prompt"
            ? `${agentName(trace, l.agent)} waited on your next prompt`
            : `${agentName(trace, l.agent)} waited on you to allow ${g.tool ?? "a tool"}`,
      };
    }
  }

  return {
    agentsSpawned: trace.events.filter((e) => e.kind === "spawn").length,
    peakParallel,
    tokensByModel,
    longestWait,
    failedCalls: buildCalls(trace).filter((c) => c.isError).length,
    compactions: trace.events.filter((e) => e.kind === "compact").length,
    time: { think: sum(lanes, "think"), tool: sum(lanes, "tool"), waiting: sum(lanes, "waiting-on-you") },
  };
}
