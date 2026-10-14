import { describe, expect, it } from "vitest";
import { generateTrace } from "@/lib/trace/generate";
import { agent, trace as literal } from "@/lib/trace/test-trace";
import { agentEye } from "./agent-eye";

const events = [
  { t: 10, agent: 0, kind: "spawn" as const, child: 1, excerpt: "do the first thing" },
  { t: 11, agent: 0, kind: "spawn" as const, child: 2, excerpt: "do the second thing" },
  { t: 30, agent: 0, kind: "spawn" as const, child: 3 },
  { t: 20, agent: 0, kind: "return" as const, child: 1, excerpt: "first done" },
  { t: 40, agent: 0, kind: "compact" as const, compact: { trigger: "auto" as const, preTokens: 800, postTokens: 80, durationMs: 5 } },
].sort((a, b) => a.t - b.t);
const agents = [agent(0), agent(1, { spawnT: 10, returnT: 20 }), agent(2, { spawnT: 11, returnT: 25 }), agent(3, { spawnT: 30, returnT: 35 })];
const t = literal(events, agents);

describe("agentEye", () => {
  it("gives the brief as everything it was told, and its report-back", () => {
    expect(agentEye(t, 1)).toMatchObject({ told: "do the first thing", hasBrief: true, report: { t: 20, size: 10, excerpt: "first done" } });
  });

  it("lists only siblings whose runs overlap, with the overlap", () => {
    expect(agentEye(t, 1)!.siblings).toEqual([{ id: 2, overlapStart: 11, overlapEnd: 20 }]);
    expect(agentEye(t, 3)!.siblings).toEqual([]);
  });

  it("gives the orchestrator its compactions and no brief, report or siblings", () => {
    const eye = agentEye(t, 0)!;
    expect(eye.compactions).toEqual([{ t: 40, trigger: "auto", preTokens: 800, postTokens: 80, durationMs: 5 }]);
    expect(eye).toMatchObject({ told: "", hasBrief: false, report: null, siblings: [] });
    expect(agentEye(t, 1)!.compactions).toEqual([]);
  });

  it("degrades without a brief or a return, and for an unknown agent", () => {
    expect(agentEye(t, 3)).toMatchObject({ told: "", hasBrief: false, report: null });
    expect(agentEye(t, 99)).toBeNull();
    expect(agentEye(literal([]), 0)).toMatchObject({ compactions: [], report: null });
  });

  it("works on a large sample", () => {
    const g = generateTrace(7, "large");
    expect(agentEye(g, 0)!.compactions).toHaveLength(1);
    const returned = g.agents.find((a) => a.id > 0 && a.returned)!;
    expect(agentEye(g, returned.id)!.report).not.toBeNull();
  });
});
