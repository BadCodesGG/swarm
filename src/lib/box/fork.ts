import type { Flip } from "./world-types";

/**
 * The flip log of a run forked at tick `at` with one more switch: every flip up to `at` kept, every
 * later one dropped, and `change` applied at `at` (replacing a flip of the same layer in the same
 * lab at that tick). Sorted by tick, for `app.loadScenario(scenario, { flips, tick: at })`.
 */
export function forkFlips(flips: readonly Flip[], at: number, change: Omit<Flip, "tick">): Flip[] {
  const kept = flips.filter((f) => f.tick < at || (f.tick === at && !(f.lab === change.lab && f.layer === change.layer)));
  return [...kept, { tick: at, ...change }].sort((a, b) => a.tick - b.tick);
}
