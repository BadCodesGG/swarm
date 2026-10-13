import { describe, expect, it } from "vitest";
import { generateTrace } from "@/lib/trace/generate";
import { buildTimeline } from "@/lib/trace/timeline";
import { axisTicks, barHeight, buildLanes } from "./lanes";

describe("lanes", () => {
  const trace = generateTrace(1, "medium");
  const tl = buildTimeline(trace);
  const lanes = buildLanes(tl);

  it("bins every event exactly once", () => {
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    expect(lanes.prompts).toHaveLength(120);
    expect(sum(lanes.prompts)).toBe(trace.events.filter((e) => e.kind === "prompt").length);
    expect(sum(lanes.agents)).toBe(trace.events.filter((e) => e.kind === "spawn").length);
    expect(sum(lanes.tools)).toBe(trace.events.filter((e) => e.kind === "call" || e.kind === "spawn").length);
  });

  it("colours an agent bin by its spawned child's model", () => {
    const e = trace.events.find((x) => x.kind === "spawn")!;
    const bin = Math.min(119, Math.floor((tl.toPlayback(e.t) / tl.playbackDuration) * 120));
    expect(lanes.agents[bin]).toBeGreaterThan(0);
    expect(trace.agents.map((a) => a.model)).toContain(lanes.agentModel[bin]);
  });

  it("sizes bars", () => {
    expect(barHeight(0, 10, 20)).toBe(1);
    expect(barHeight(1, 100, 20)).toBe(3);
    expect(barHeight(10, 10, 20)).toBe(20);
  });

  it("places axis ticks in order inside the track", () => {
    const ticks = axisTicks(tl);
    expect(ticks[0]).toEqual({ at: 0, label: "00:00" });
    for (let i = 1; i < ticks.length; i++) expect(ticks[i].at).toBeGreaterThan(ticks[i - 1].at);
    expect(ticks[ticks.length - 1].at).toBeLessThanOrEqual(1);
    expect(ticks.length).toBeLessThanOrEqual(7);
  });
});
