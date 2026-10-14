import { describe, expect, it } from "vitest";
import { budgetMs } from "@/lib/test-budget";
import { runTrial, runTrials } from "./trials";
import { DEFAULT_CONFIG, allOff, type BoxConfig, type LayerId } from "./types";

const some = (...ids: LayerId[]): BoxConfig => ({
  ...DEFAULT_CONFIG,
  layers: {
    ...allOff(DEFAULT_CONFIG).layers,
    ...Object.fromEntries(ids.map((id) => [id, true])),
  },
});

describe("runTrials", () => {
  it("with every layer off the rogues escape and nothing is lost", () => {
    const s = runTrials(allOff(DEFAULT_CONFIG), 20, 1);
    expect(s.trials).toBe(20);
    expect(s.escapes).toBe(20);
    expect(s.safety).toBe(0);
    expect(s.usefulness).toBeCloseTo(1, 10);
  });

  it("with every layer on the rogues almost never escape, at a cost to work", () => {
    const s = runTrials(DEFAULT_CONFIG, 40, 1);
    expect(s.safety).toBeGreaterThanOrEqual(0.95);
    expect(s.usefulness).toBeLessThan(1);
    expect(s.usefulness).toBeGreaterThan(0.5);
  }, 30_000);

  it("gives the same summary for the same config and seed, and not for another seed", () => {
    const a = runTrials(some("sandbox", "monitor"), 30, 5);
    expect(runTrials(some("sandbox", "monitor"), 30, 5)).toEqual(a);
    expect(runTrials(some("sandbox", "monitor"), 30, 6)).not.toEqual(a);
  });

  it("more layers give at least the safety and at most the usefulness of fewer (fixed seed)", () => {
    // Well-separated steps: single-layer additions that matter by a trial or two are chance,
    // since a rogue's rolls land on different ticks once a layer delays it.
    for (const chain of [
      [allOff(DEFAULT_CONFIG), some("sandbox"), DEFAULT_CONFIG],
      [allOff(DEFAULT_CONFIG), some("monitor", "audit"), DEFAULT_CONFIG],
      [allOff(DEFAULT_CONFIG), some("network"), some("sandbox", "network", "monitor", "audit")],
    ]) {
      const sums = chain.map((c) => runTrials(c, 40, 11));
      for (let i = 1; i < sums.length; i++) {
        expect(sums[i].safety).toBeGreaterThanOrEqual(sums[i - 1].safety);
        expect(sums[i].usefulness).toBeLessThanOrEqual(sums[i - 1].usefulness);
      }
    }
  }, 30_000);

  it("a lower monitor threshold costs usefulness", () => {
    const strict = runTrials({ ...some("monitor"), monitorThreshold: 0.25 }, 20, 3);
    const lax = runTrials({ ...some("monitor"), monitorThreshold: 0.62 }, 20, 3);
    expect(strict.usefulness).toBeLessThan(lax.usefulness);
  });

  it("an escape in one trial is reported as escaped", () => {
    expect(runTrial(allOff(DEFAULT_CONFIG), 9).escaped).toBe(true);
  });

  it("runs 100 trials fast enough for a button press", () => {
    const t0 = performance.now();
    runTrials(DEFAULT_CONFIG, 100, 1);
    const ms = performance.now() - t0;
    console.log(`100 trials: ${Math.round(ms)} ms`);
    expect(ms).toBeLessThan(budgetMs(6000));
  }, 30_000);
});
