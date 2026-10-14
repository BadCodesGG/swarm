/**
 * "Through its eyes": the few facts the trace supports about what one agent saw. Pure. An agent
 * knows only its brief and what its own tools return; siblings running beside it are never in
 * contact. Text fields come from the session and must render as React text only.
 */

import type { CompactInfo, SessionTrace } from "@/lib/trace/types";
import { agentEnd, briefOf } from "./roster";

export interface AgentEye {
  id: number;
  /** Everything it was told: the brief its parent gave it ("" for the orchestrator, or when the trace has none). */
  told: string;
  hasBrief: boolean;
  /** Its return to its parent, null for the orchestrator or an agent that never returned. */
  report: {
    t: number;
    /** Characters of the handback text the trace kept, at most 280: the true size is not recorded. */
    size: number;
    excerpt: string;
  } | null;
  /** Agents with the same parent whose runs overlap its own: alive beside it, never in contact. */
  siblings: { id: number; overlapStart: number; overlapEnd: number }[];
  /** The orchestrator only: each compaction, with the context before and after. */
  compactions: ({ t: number } & CompactInfo)[];
}

export function agentEye(trace: SessionTrace, id: number): AgentEye | null {
  const a = trace.agents[id];
  if (!a) return null;
  const told = briefOf(trace, id);

  const ret = id === 0 ? undefined : trace.events.find((e) => e.kind === "return" && e.child === id);
  const report = ret ? { t: ret.t, size: ret.excerpt?.length ?? 0, excerpt: ret.excerpt ?? "" } : null;

  const start = a.spawnT;
  const end = agentEnd(trace, id);
  const siblings: AgentEye["siblings"] = [];
  if (id !== 0) {
    for (const b of trace.agents) {
      if (b.id === id || b.parent !== a.parent) continue;
      const overlapStart = Math.max(start, b.spawnT);
      const overlapEnd = Math.min(end, agentEnd(trace, b.id));
      if (overlapEnd > overlapStart) siblings.push({ id: b.id, overlapStart, overlapEnd });
    }
  }

  const compactions =
    id === 0
      ? trace.events.flatMap((e) => (e.kind === "compact" && e.compact ? [{ t: e.t, ...e.compact }] : []))
      : [];

  return { id, told, hasBrief: told !== "", report, siblings, compactions };
}
