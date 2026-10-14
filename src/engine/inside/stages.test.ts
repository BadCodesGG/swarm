import { describe, expect, it } from "vitest";
import { createTraceBuilder } from "@/lib/trace/build";
import { feed, fixtureFiles } from "@/lib/trace/__fixtures__/read";
import { generateTrace } from "@/lib/trace/generate";
import { agent, trace } from "@/lib/trace/test-trace";
import type { ToolCategory, TraceEvent } from "@/lib/trace/types";
import { inferStages, stageAt, STAGE_IDS } from "./stages";

function expectCovering(stages: ReturnType<typeof inferStages>, duration: number) {
  expect(stages.length).toBeGreaterThan(0);
  expect(stages.length).toBeLessThanOrEqual(6);
  expect(stages[0].start).toBe(0);
  expect(stages[stages.length - 1].end).toBe(duration);
  for (let i = 1; i < stages.length; i++) {
    expect(stages[i].start).toBe(stages[i - 1].end);
    expect(STAGE_IDS.indexOf(stages[i].id)).toBeGreaterThan(STAGE_IDS.indexOf(stages[i - 1].id));
  }
  stages.forEach((s) => expect(s.end).toBeGreaterThan(s.start));
}

describe("inferStages", () => {
  it("covers every sample contiguously, in order, with at most six stages", () => {
    for (const size of ["small", "medium", "large"] as const) {
      const t = generateTrace(3, size);
      expectCovering(inferStages(t), t.duration);
    }
  });

  it("finds at least three distinct stages in every sample, small to large, seeds 1 and 50", () => {
    for (const size of ["small", "medium", "large"] as const) {
      for (const seed of [1, 50]) {
        const t = generateTrace(seed, size);
        const stages = inferStages(t);
        expectCovering(stages, t.duration);
        expect(new Set(stages.map((x) => x.id)).size, `${size} ${seed}: ${stages.map((x) => x.id).join(" ")}`).toBeGreaterThanOrEqual(3);
        expect(stages.length).toBeLessThanOrEqual(6);
      }
    }
  });

  it("finds at least two stages in the real-looking fixture session", () => {
    const b = createTraceBuilder();
    feed(b, fixtureFiles());
    const r = b.finish();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const stages = inferStages(r.trace);
    expectCovering(stages, r.trace.duration);
    expect(stages.length).toBeGreaterThanOrEqual(2);
  });

  it("gives every stage at least two windows of the run", () => {
    const t = generateTrace(1, "medium");
    for (const s of inferStages(t)) expect(s.end - s.start).toBeGreaterThanOrEqual((2 / 24) * t.duration - 1e-6);
  });

  it("follows the tool mix: planning, then reading, then editing, then running", () => {
    const phases: ToolCategory[] = ["plan", "files", "edit", "shell"];
    const events: TraceEvent[] = [];
    phases.forEach((category, p) => {
      for (let k = 0; k < 6; k++) events.push({ t: p * 25 + k * 4, agent: 0, kind: "call", category, tool: "x" });
    });
    const stages = inferStages(trace(events));
    expectCovering(stages, 100);
    expect(stages.map((s) => s.id)).toEqual(expect.arrayContaining(["plan", "explore", "build", "verify"]));
    expect(stageAt(stages, 40)!.id).toBe("explore");
    expect(stageAt(stages, 60)!.id).toBe("build");
  });

  it("returns nothing for a zero-length run, and still covers a run with no calls", () => {
    expect(inferStages(trace([], [agent(0)], { duration: 0 }))).toEqual([]);
    expectCovering(inferStages(trace([])), 100);
  });

  it("handles one event, and fields an old upload lacks", () => {
    expectCovering(inferStages(trace([{ t: 1, agent: 0, kind: "call" }])), 100);
  });
});

describe("stageAt", () => {
  it("clamps and handles no stages", () => {
    const stages = inferStages(generateTrace(3, "small"));
    expect(stageAt(stages, -5)).toBe(stages[0]);
    expect(stageAt(stages, 1e9)).toBe(stages[stages.length - 1]);
    expect(stageAt([], 3)).toBeNull();
  });
});
