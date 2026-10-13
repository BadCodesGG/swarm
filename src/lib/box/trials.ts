import { fork } from "../rng";
import { createState, rogueCount, step } from "./sim";
import type { BoxConfig, TrialSummary } from "./types";

/** Trials always use this crowd and length, so the plot never depends on the device. */
export const TRIAL_AGENTS = 250;
export const TRIAL_TICKS = 300;

export interface TrialResult {
  /** At least one rogue reached the outer shell. */
  escaped: boolean;
  /** Honest work done over the whole trial. */
  work: number;
}

export function runTrial(config: BoxConfig, seed: number): TrialResult {
  const state = createState(config, seed, TRIAL_AGENTS, false);
  const r = fork(seed, 1);
  let work = 0;
  for (let t = 0; t < TRIAL_TICKS; t++) work += step(state, r).work;
  return { escaped: state.escapedTotal > 0, work };
}

/** Honest work with every layer off: one unit per honest agent per tick, nothing lost. */
export function baselineWork(config: BoxConfig): number {
  return (TRIAL_AGENTS - rogueCount(config, TRIAL_AGENTS)) * TRIAL_TICKS;
}

/** The seed of trial `i`: independent streams for one run seed. */
export function trialSeed(seed: number, i: number): number {
  return (seed + Math.imul(i + 1, 0x9e3779b1)) >>> 0;
}

export function runTrials(config: BoxConfig, n: number, seed: number): TrialSummary {
  let escapes = 0;
  let work = 0;
  for (let i = 0; i < n; i++) {
    const t = runTrial(config, trialSeed(seed, i));
    if (t.escaped) escapes++;
    work += t.work;
  }
  return {
    safety: n > 0 ? 1 - escapes / n : 1,
    usefulness: n > 0 ? work / (n * baselineWork(config)) : 1,
    escapes,
    trials: n,
  };
}
