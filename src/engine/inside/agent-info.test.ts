import { describe, expect, it } from "vitest";
import { generateTrace } from "@/lib/trace/generate";
import { agent, trace as literal } from "@/lib/trace/test-trace";
import { buildTimeline } from "@/lib/trace/timeline";
import { agentInfo } from "./agent-info";
import { featuredAgent } from "./layout";
import { HERO } from "./params";

const trace = generateTrace(HERO.seed, HERO.source);
const tl = buildTimeline(trace);

describe("agentInfo", () => {
  const id = featuredAgent(trace, HERO.t);
  const a = trace.agents[id];

  it("describes a running agent from the events so far", () => {
    const info = agentInfo(tl, id, HERO.t)!;
    expect(info.state).toBe("running");
    expect(info.label).toBe(a.label);
    expect(info.running).toBeCloseTo(HERO.t - a.spawnT, 5);
    const mine = trace.events.filter((e) => e.agent === id && e.t <= HERO.t);
    expect(info.calls).toBe(mine.filter((e) => e.kind === "call" || e.kind === "spawn").length);
    expect(info.mix.reduce((n, m) => n + m.count, 0)).toBe(info.calls);
    expect(info.helpers).toBe(trace.agents.filter((c) => c.parent === id && c.spawnT <= HERO.t).length);
    expect(info.brief.length).toBeGreaterThan(0);
  });

  it("sorts the tool mix most used first", () => {
    const { mix } = agentInfo(tl, id, trace.duration)!;
    for (let i = 1; i < mix.length; i++) expect(mix[i - 1].count).toBeGreaterThanOrEqual(mix[i].count);
  });

  it("reports waiting before the spawn and returned after the return", () => {
    const early = agentInfo(tl, id, Math.max(0, a.spawnT - 1))!;
    expect(early.state).toBe("waiting");
    expect(early.running).toBe(0);
    expect(early.calls).toBe(0);
    expect(early.lastCall).toBeNull();
    if (a.returned) {
      const late = agentInfo(tl, id, a.returnT + 1)!;
      expect(late.state).toBe("returned");
      expect(late.running).toBeCloseTo(a.returnT - a.spawnT, 5);
    }
  });

  it("reads waiting-on-you off the lane: the orchestrator between prompts, a helper on a permission prompt", () => {
    const t = literal(
      [
        { t: 1, agent: 0, kind: "call", category: "shell", tool: "Bash" },
        { t: 2, agent: 0, kind: "result", category: "shell", tool: "Bash", call: 0 },
        { t: 10, agent: 0, kind: "spawn", category: "agents", tool: "Agent", child: 1 },
        { t: 12, agent: 1, kind: "call", category: "files", tool: "Read" },
        { t: 18, agent: 1, kind: "result", category: "files", tool: "Read", call: 3, permission: "user" },
        { t: 20, agent: 0, kind: "return", child: 1, call: 2 },
        { t: 50, agent: 0, kind: "prompt" },
      ],
      [agent(0), agent(1, { spawnT: 10, returnT: 20 })],
    );
    const tl2 = buildTimeline(t);
    expect(agentInfo(tl2, 0, 15)!.state).toBe("running");
    expect(agentInfo(tl2, 1, 15)!.state).toBe("waiting-on-you");
    expect(agentInfo(tl2, 0, 30)!.state).toBe("waiting-on-you");
    expect(agentInfo(tl2, 1, 30)!.state).toBe("returned");
    expect(agentInfo(tl2, 0, 55)!.state).toBe("running");
  });

  it("finds the last call at or before t", () => {
    const info = agentInfo(tl, id, trace.duration)!;
    expect(info.lastCall).not.toBeNull();
    const calls = trace.events.filter((e) => e.agent === id && (e.kind === "call" || e.kind === "spawn"));
    expect(info.lastCall!.t).toBe(calls[calls.length - 1].t);
  });

  it("is null for an unknown id", () => {
    expect(agentInfo(tl, 9999, 0)).toBeNull();
  });
});
