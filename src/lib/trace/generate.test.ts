import { describe, expect, it } from "vitest";
import { categorize, modelFamily } from "./categories";
import { generateTrace, type SampleSize } from "./generate";
import { buildTimeline } from "./timeline";
import type { SessionTrace } from "./types";
import { validateTrace } from "./validate";

const SIZES: SampleSize[] = ["small", "medium", "large"];
const SEEDS = Array.from({ length: 50 }, (_, i) => i + 1);

const BANDS = {
  small: { agents: [3, 8], events: [150, 400], depth: 1 },
  medium: { agents: [10, 25], events: [1000, 3000], depth: 2 },
  large: { agents: [40, 120], events: [8000, 20000], depth: 3 },
} as const;

/** Most spawns by one agent inside a one second window. */
function widestFanOut(trace: SessionTrace): number {
  let best = 0;
  const spawns = trace.events.filter((e) => e.kind === "spawn");
  for (const s of spawns) {
    const n = spawns.filter((o) => o.agent === s.agent && o.t >= s.t && o.t < s.t + 1).length;
    best = Math.max(best, n);
  }
  return best;
}

function maxGap(trace: SessionTrace): number {
  let gap = 0;
  for (let i = 1; i < trace.events.length; i++) gap = Math.max(gap, trace.events[i].t - trace.events[i - 1].t);
  return gap;
}

describe.each(SIZES)("generateTrace %s", (size) => {
  const traces = SEEDS.map((s) => generateTrace(s, size));

  it("is valid for 50 seeds", () => {
    traces.forEach((t, i) => expect(validateTrace(t), `seed ${i + 1}`).toEqual([]));
  });

  it("holds the size band for 50 seeds", () => {
    const b = BANDS[size];
    traces.forEach((t, i) => {
      const msg = `seed ${i + 1}: ${t.agents.length} agents, ${t.events.length} events`;
      expect(t.agents.length, msg).toBeGreaterThanOrEqual(b.agents[0]);
      expect(t.agents.length, msg).toBeLessThanOrEqual(b.agents[1]);
      expect(t.events.length, msg).toBeGreaterThanOrEqual(b.events[0]);
      expect(t.events.length, msg).toBeLessThanOrEqual(b.events[1]);
      expect(Math.max(...t.agents.map((a) => a.depth)), msg).toBe(b.depth);
    });
  });

  it("is deterministic and varies with the seed", () => {
    expect(generateTrace(7, size)).toEqual(generateTrace(7, size));
    const json = new Set(traces.map((t) => JSON.stringify(t)));
    expect(json.size).toBe(traces.length);
  });

  it("is a sample with the required content", () => {
    traces.forEach((t, i) => {
      const msg = `seed ${i + 1}`;
      expect(t.source, msg).toBe("sample");
      expect(t.truncated, msg).toBe(false);
      expect(t.agents[0].model, msg).toBe("opus");
      expect(t.events.some((e) => e.kind === "call" && e.category === "advisor"), msg).toBe(true);
      expect(t.events.some((e) => e.kind === "call" && e.category === "web"), msg).toBe(true);
      expect(t.events.some((e) => e.kind === "prompt"), msg).toBe(true);
      expect(t.agents.some((a) => a.background), msg).toBe(true);
      const models = new Set(t.agents.slice(1).map((a) => a.model));
      expect(models.size, msg).toBeGreaterThanOrEqual(2);
      expect(models.has("other"), msg).toBe(false);
      // The category and model on the wire agree with the shared name tables.
      for (const e of t.events) {
        if (e.kind === "call" || e.kind === "result") expect(categorize(e.tool!)).toBe(e.category);
      }
      for (const a of t.agents) expect(modelFamily(a.modelId)).toBe(a.model);
    });
  });

  it("feeds the timeline", () => {
    const t = traces[0];
    const tl = buildTimeline(t);
    expect(tl.countersAt(t.duration).agentsSpawned).toBe(t.agents.length - 1);
    expect(tl.countersAt(t.duration).agentsActive).toBe(1);
  });
});

describe("generateTrace shape", () => {
  it("nests spawns from medium up", () => {
    for (const size of ["medium", "large"] as const) {
      for (const seed of SEEDS) {
        const t = generateTrace(seed, size);
        expect(t.agents.some((a) => a.depth >= 2 && t.agents[a.parent].depth >= 1), `${size} ${seed}`).toBe(true);
      }
    }
    for (const seed of SEEDS) {
      expect(generateTrace(seed, "small").agents.every((a) => a.depth <= 1)).toBe(true);
    }
  });

  it("fans out 6 or more at once in large", () => {
    for (const seed of SEEDS) expect(widestFanOut(generateTrace(seed, "large")), `seed ${seed}`).toBeGreaterThanOrEqual(6);
  });

  it("has an idle stretch over 10 minutes in medium and large, so compression shows", () => {
    for (const size of ["medium", "large"] as const) {
      for (const seed of SEEDS) {
        const t = generateTrace(seed, size);
        expect(maxGap(t), `${size} ${seed}`).toBeGreaterThan(600);
        expect(buildTimeline(t).cuts.length, `${size} ${seed}`).toBeGreaterThan(0);
      }
    }
  });

  it("returns every subagent, and the orchestrator last", () => {
    const t = generateTrace(1, "medium");
    t.agents.slice(1).forEach((a) => expect(a.returned).toBe(true));
    expect(t.agents[0].returned).toBe(false);
    expect(t.agents[0].returnT).toBe(t.duration);
  });
});
