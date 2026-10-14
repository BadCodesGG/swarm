import { describe, expect, it } from "vitest";
import { generateTrace } from "@/lib/trace/generate";
import { CLOUD_AGENTS, planNebula, SLOTS, STATION_SLOT0 } from "./nebula-plan";

const medium = generateTrace(50, "medium");

describe("planNebula", () => {
  it("is deterministic for a seed and differs across seeds", () => {
    const a = planNebula(medium, 50, 20_000);
    const b = planNebula(medium, 50, 20_000);
    const c = planNebula(medium, 51, 20_000);
    expect(Array.from(a.local.slice(0, 400))).toEqual(Array.from(b.local.slice(0, 400)));
    expect(Array.from(a.local.slice(0, 400))).not.toEqual(Array.from(c.local.slice(0, 400)));
  });

  it("never spends more points than the tier's budget, and every point belongs to a slot with points", () => {
    for (const budget of [8_000, 24_000, 60_000]) {
      const p = planNebula(generateTrace(7, "large"), 7, budget);
      expect(p.count).toBeLessThanOrEqual(budget);
      expect(p.count).toBeGreaterThan(budget * 0.9);
      for (let k = 0; k < p.count; k += 97) expect(p.perSlot[p.meta[k * 4]]).toBeGreaterThan(0);
    }
  });

  it("gives the orchestrator the largest cloud and every station a cluster", () => {
    const p = planNebula(medium, 50, 24_000);
    const biggest = Math.max(...Array.from(p.perSlot.slice(1, STATION_SLOT0)));
    expect(p.perSlot[0]).toBeGreaterThan(biggest);
    for (let s = STATION_SLOT0; s < SLOTS; s++) expect(p.perSlot[s]).toBeGreaterThan(0);
  });

  it("clouds only the busiest subagents when there are more than the slots", () => {
    const big = generateTrace(3, "large");
    const p = planNebula(big, 3, 60_000);
    const clouded = Array.from(p.agentSlot).filter((s) => s > 0).length;
    expect(clouded).toBe(Math.min(CLOUD_AGENTS, big.agents.length - 1));
  });

  it("counts tokens up through the run and ends at the agent's total", () => {
    const p = planNebula(medium, 50, 24_000);
    let last = 0;
    for (let t = 0; t <= medium.duration; t += medium.duration / 40) {
      const n = p.tokensAt(0, t);
      expect(n).toBeGreaterThanOrEqual(last);
      last = n;
    }
    expect(p.tokensAt(0, medium.duration + 1)).toBe(p.total[0]);
  });

  it("keeps ranks in 0..1 so a fill fraction always lights a prefix of the cloud's outward order", () => {
    const p = planNebula(medium, 50, 24_000);
    for (let k = 0; k < p.count; k++) {
      const r = p.local[k * 4 + 3];
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    }
  });
});
