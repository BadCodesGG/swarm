import { describe, expect, it } from "vitest";
import { generateTrace } from "@/lib/trace/generate";
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
