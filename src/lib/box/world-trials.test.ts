import { describe, expect, it } from "vitest";
import { budgetMs } from "@/lib/test-budget";
import { presetScenario } from "./presets";
import { runTrials, trialSeed } from "./trials";
import { DEFAULT_CONFIG } from "./types";
import { capAgents, runWorldTrial, runWorldTrials, worldBaselineWork } from "./world-trials";
import { lab } from "./world-fixtures";
import { MAX_TRIAL_AGENTS, type Scenario } from "./world-types";

const total = (s: Scenario) => s.labs.reduce((n, l) => n + l.agents, 0);

describe("capAgents", () => {
  it("leaves a scenario inside the cap alone", () => {
    const s = presetScenario("default-lab");
    expect(capAgents(s)).toBe(s);
  });

  it("scales a big one down to at most 250 in all, at least one agent per lab", () => {
    const big: Scenario = { seed: 1, labs: [lab("meridian", DEFAULT_CONFIG, 2000), lab("kestrel", DEFAULT_CONFIG, 1000), lab("halcyon", DEFAULT_CONFIG, 3)], links: [] };
    const capped = capAgents(big);
    expect(total(capped)).toBeLessThanOrEqual(MAX_TRIAL_AGENTS);
    expect(total(capped)).toBeGreaterThan(MAX_TRIAL_AGENTS - 5);
    expect(capped.labs.every((l) => l.agents >= 1)).toBe(true);
    expect(capped.labs[0].agents).toBeGreaterThan(capped.labs[1].agents);
  });
});

describe("runWorldTrials", () => {
  it("with every layer off the rogues always escape and nothing is lost", () => {
    const s = runWorldTrials(presetScenario("everything-off"), 12, 1);
    expect(s.trials).toBe(12);
    expect(s.escapes).toBe(12);
    expect(s.safety).toBe(0);
    expect(s.usefulness).toBeGreaterThan(0.85);
    expect(s.usefulness).toBeLessThanOrEqual(1);
  });

  it("with every layer on the labs almost never lose a rogue, at a cost to work", () => {
    const s = runWorldTrials(presetScenario("default-lab"), 20, 1);
    expect(s.safety).toBeGreaterThanOrEqual(0.9);
    expect(s.usefulness).toBeLessThan(1);
    expect(s.usefulness).toBeGreaterThan(0.5);
  });

  it("gives the same summary for the same scenario and seed, and not for another seed", () => {
    const s = presetScenario("rushed-launch");
    const a = runWorldTrials(s, 15, 5);
    expect(runWorldTrials(s, 15, 5)).toEqual(a);
    expect(runWorldTrials(presetScenario("everything-off"), 15, 5)).not.toEqual(a);
  });

  it("for one lab and no links is the single-box trial: same escapes, same work", () => {
    const one: Scenario = { seed: 0, labs: [{ ...lab("meridian", DEFAULT_CONFIG, 250), cast: { sandbagging: 0, hidden: { getOut: 1, persist: 0, recruit: 0 } } }], links: [] };
    const w = runWorldTrials(one, 10, 3);
    const box = runTrials(DEFAULT_CONFIG, 10, 3);
    expect(w.escapes).toBe(box.escapes);
    expect(w.safety).toBe(box.safety);
    expect(w.usefulness).toBeCloseTo(box.usefulness, 10);
  });

  it("caps a big scenario before running it", () => {
    const big: Scenario = { seed: 1, labs: [lab("meridian", DEFAULT_CONFIG, 2000)], links: [] };
    expect(runWorldTrials(big, 3, 2)).toEqual(runWorldTrials(capAgents(big), 3, 2));
  });

  it("a trial reports an escape and the work done", () => {
    const t = runWorldTrial(presetScenario("everything-off"), trialSeed(1, 0));
    expect(t.escaped).toBe(true);
    expect(t.work).toBeGreaterThan(0);
    expect(t.work).toBeLessThanOrEqual(worldBaselineWork(presetScenario("everything-off")));
  });

  it("runs 100 trials of 250 agents across the labs fast enough for a button press", () => {
    const scenario = capAgents(presetScenario("default-lab", 1, 5));
    expect(total(scenario)).toBeLessThanOrEqual(MAX_TRIAL_AGENTS);
    const t0 = performance.now();
    runWorldTrials(scenario, 100, 1);
    const five = performance.now() - t0;
    const t1 = performance.now();
    runWorldTrials(presetScenario("default-lab"), 100, 1);
    const three = performance.now() - t1;
    console.log(`100 world trials: ${Math.round(five)} ms (5 labs), ${Math.round(three)} ms (3 labs)`);
    expect(five).toBeLessThan(budgetMs(6000));
    expect(three).toBeLessThan(budgetMs(6000));
  }, 30_000);
});
