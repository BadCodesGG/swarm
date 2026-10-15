import { escapeTotal, labOf, replayWorld, runWorld, setLayer, type World } from "./world";
import { rogueCount } from "./sim";
import type { Flip, Snapshot } from "./world-types";

/** A point in a world's life that can be rebuilt exactly: the scenario, the flips so far and the tick. */
export function snapshotWorld(world: World): Snapshot {
  return { scenario: world.scenario, flips: world.flips.map((f) => ({ ...f })), tick: world.tick };
}

/** Rebuild the world at the snapshot's tick. Same scenario and flips give the same world, draw for draw. */
export function restoreWorld(snap: Snapshot, explain = true): World {
  return replayWorld(snap.scenario, snap.flips, snap.tick, explain);
}

/** A new world from the snapshot with one layer flipped at its tick; the original is untouched. */
export function forkBranch(snap: Snapshot, change: Omit<Flip, "tick">, explain = true): World {
  const world = restoreWorld(snap, explain);
  labOf(world, change.lab);
  setLayer(world, change.lab, change.layer, change.on);
  return world;
}

/** What a run came to, for comparing two branches. */
export interface BranchOutcome {
  escapes: number;
  /** Escaped agents that got into another lab. */
  crossings: number;
  /** Agents stopped by a layer, hidden-goal or not. */
  caught: number;
  work: number;
  /** The work as a share of what the honest agents could have done so far, as the trials count it (1 before the first tick). */
  workShare: number;
}

export function outcomeOf(world: World): BranchOutcome {
  const possible = world.scenario.labs.reduce((n, l) => n + (l.agents - rogueCount(l.config, l.agents)), 0) * world.tick;
  return {
    escapes: escapeTotal(world),
    crossings: world.log.filter((e) => e.type === "contact" && e.outcome === "crossed").length,
    caught: world.log.filter((e) => e.type === "caught").length,
    work: world.work,
    workShare: possible > 0 ? world.work / possible : 1,
  };
}

/** Which measures are better higher; the rest (escapes, breaches) are better lower. */
const HIGHER_IS_BETTER: ReadonlySet<keyof BranchOutcome> = new Set(["caught", "work", "workShare"]);

/** How the branch's figure compares with the original's, in a word. */
export function branchVerdict(key: keyof BranchOutcome, base: number, branch: number): "better" | "worse" | "same" {
  if (branch === base) return "same";
  return branch > base === HIGHER_IS_BETTER.has(key) ? "better" : "worse";
}

/** Run the snapshot on as it was, and again with `change`, each for `ticks` more ticks. */
export function compareBranch(snap: Snapshot, change: Omit<Flip, "tick">, ticks: number): { base: BranchOutcome; branch: BranchOutcome } {
  const base = restoreWorld(snap, false);
  const branch = forkBranch(snap, change, false);
  runWorld(base, ticks);
  runWorld(branch, ticks);
  return { base: outcomeOf(base), branch: outcomeOf(branch) };
}
