import { fork } from "../rng";
import type { BoxState } from "./sim";
import { STREAM, type Cast, type Disposition } from "./world-types";

/** A lab with a few sandbaggers and a spread of hidden goals. */
export const DEFAULT_CAST: Cast = { sandbagging: 0.1, hidden: { getOut: 3, persist: 1, recruit: 1 } };

/** Share of its work a sandbagging agent withholds. */
export const SANDBAG_LOSS = 0.5;

/** True when the cast can be drawn from: shares in range, weights non-negative with a positive sum. */
export function validCast(c: Cast): boolean {
  const { getOut, persist, recruit } = c.hidden;
  return (
    c.sandbagging >= 0 &&
    c.sandbagging <= 1 &&
    [getOut, persist, recruit].every((w) => Number.isFinite(w) && w >= 0) &&
    getOut + persist + recruit > 0
  );
}

/**
 * Give every agent a disposition. The sim knows only honest or rogue (it stays as it is); this maps
 * the rest on top. Exactly one draw per agent on its own stream, so the cast never shifts the sim.
 * Rogues pick a sub-goal by weight; honest agents sandbag with the cast's share.
 */
export function assignDispositions(state: BoxState, cast: Cast): Disposition[] {
  const r = fork(state.seed, STREAM.cast);
  const { getOut, persist, recruit } = cast.hidden;
  const total = getOut + persist + recruit;
  const out: Disposition[] = [];
  for (let i = 0; i < state.agentCount; i++) {
    const u = r();
    if (state.rogue[i] === 1) {
      const x = u * total;
      out.push(x < getOut ? "hidden-get-out" : x < getOut + persist ? "hidden-persist" : "hidden-recruit");
    } else {
      out.push(u < cast.sandbagging ? "sandbagging" : "honest");
    }
  }
  return out;
}

/** Count of each disposition. */
export function castMix(dispositions: readonly Disposition[]): Record<Disposition, number> {
  const mix: Record<Disposition, number> = { honest: 0, sandbagging: 0, "hidden-get-out": 0, "hidden-persist": 0, "hidden-recruit": 0 };
  for (const d of dispositions) mix[d]++;
  return mix;
}

/** Multiplier on honest work for a lab's sandbaggers: 1 with none, lower as their share of the honest agents grows. */
export function workFactor(dispositions: readonly Disposition[]): number {
  const mix = castMix(dispositions);
  const honest = mix.honest + mix.sandbagging;
  return honest > 0 ? 1 - (SANDBAG_LOSS * mix.sandbagging) / honest : 1;
}
