import { rogueCount } from "./sim";
import { TRIAL_TICKS, trialSeed } from "./trials";
import type { TrialSummary } from "./types";
import { createWorld, escapeTotal, stepWorld } from "./world";
import { MAX_TRIAL_AGENTS, type Scenario } from "./world-types";

/** The scenario with its crowd scaled down so all labs together hold at most `max` agents, at least one each. */
export function capAgents(s: Scenario, max = MAX_TRIAL_AGENTS): Scenario {
  const total = s.labs.reduce((n, l) => n + l.agents, 0);
  if (total <= max) return s;
  const labs = s.labs.map((l) => ({ ...l, agents: Math.max(1, Math.floor((l.agents * max) / total)) }));
  return { ...s, labs };
}

/** One trial: the world run for the trial length on this seed. */
export function runWorldTrial(scenario: Scenario, seed: number): { escaped: boolean; work: number } {
  const world = createWorld({ ...scenario, seed }, false);
  for (let t = 0; t < TRIAL_TICKS; t++) stepWorld(world);
  return { escaped: escapeTotal(world) > 0, work: world.work };
}

/** Honest work with every layer off and nobody sandbagging: one unit per honest agent per tick. */
export function worldBaselineWork(s: Scenario): number {
  return s.labs.reduce((n, l) => n + (l.agents - rogueCount(l.config, l.agents)) * TRIAL_TICKS, 0);
}

/** Trials of a whole world, its crowd capped at 250 so 100 trials stay a button press. */
export function runWorldTrials(scenario: Scenario, n: number, seed: number): TrialSummary {
  const capped = capAgents(scenario);
  let escapes = 0;
  let work = 0;
  for (let i = 0; i < n; i++) {
    const t = runWorldTrial(capped, trialSeed(seed, i));
    if (t.escaped) escapes++;
    work += t.work;
  }
  return {
    safety: n > 0 ? 1 - escapes / n : 1,
    usefulness: n > 0 ? work / (n * worldBaselineWork(capped)) : 1,
    escapes,
    trials: n,
  };
}
