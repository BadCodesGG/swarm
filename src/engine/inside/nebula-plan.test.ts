import { describe, expect, it } from "vitest";
import { generateTrace } from "@/lib/trace/generate";
import { agentPose, FOLD_TIME, newPose, returnPose, SPAWN_TIME } from "./layout";
import { CLOUD_AGENTS, cloudAt, newCloudState, planNebula, RETURNED_DIM, SLOTS, STATION_SLOT0 } from "./nebula-plan";

const medium = generateTrace(50, "medium");

describe("cloudAt", () => {
  const returned = medium.agents.find((a) => a.parent >= 0 && a.returned && a.returnT + FOLD_TIME < medium.duration)!;
  const state = newCloudState();

  it("is unlit before the agent spawns and fully lit once it is out", () => {
    expect(cloudAt(medium, returned.id, returned.spawnT - 1, state).life).toBe(0);
    const t = returned.spawnT + SPAWN_TIME + 1;
    cloudAt(medium, returned.id, t, state);
    expect(state.life).toBe(1);
    expect(state.returned).toBe(0);
    const p = agentPose(medium, returned.id, t, newPose());
    expect([state.x, state.y, state.z]).toEqual([p.x, p.y, p.z]);
  });

  it("stays where it returned, dimmed to a third, and never disappears", () => {
    for (const t of [returned.returnT + FOLD_TIME, returned.returnT + FOLD_TIME + 600, medium.duration]) {
      cloudAt(medium, returned.id, t, state);
      expect(state.life).toBeCloseTo(RETURNED_DIM, 6);
      expect(state.returned).toBe(1);
      const home = returnPose(medium, returned.id, newPose());
      expect([state.x, state.y, state.z]).toEqual([home.x, home.y, home.z]);
      // Off its parent, where the point itself has folded back to.
      const parent = agentPose(medium, returned.parent, t, newPose());
      expect(Math.hypot(state.x - parent.x, state.y - parent.y, state.z - parent.z)).toBeGreaterThan(1);
    }
  });

  it("dims over the fold, so a return never pops", () => {
    const mid = cloudAt(medium, returned.id, returned.returnT + FOLD_TIME / 2, state).life;
    expect(mid).toBeGreaterThan(RETURNED_DIM);
    expect(mid).toBeLessThan(1);
  });

  it("keeps every returned agent's cloud lit at the end of the run", () => {
    let seen = 0;
    for (const a of medium.agents) {
      if (a.parent < 0 || !a.returned) continue;
      seen++;
      expect(cloudAt(medium, a.id, medium.duration, state).life).toBeGreaterThanOrEqual(RETURNED_DIM - 1e-6);
    }
    expect(seen).toBeGreaterThan(5);
  });
});

describe("planNebula", () => {
  it("is deterministic for a seed and differs across seeds", () => {
    const a = planNebula(medium, 50, 20_000);
    const b = planNebula(medium, 50, 20_000);
    const c = planNebula(medium, 51, 20_000);
    expect(Array.from(a.local.slice(0, 400))).toEqual(Array.from(b.local.slice(0, 400)));
    expect(Array.from(a.local.slice(0, 400))).not.toEqual(Array.from(c.local.slice(0, 400)));
  });

  it("never spends more points than the tier's budget, and every point belongs to a slot with points", () => {
    for (const budget of [16_000, 30_000, 60_000]) {
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
