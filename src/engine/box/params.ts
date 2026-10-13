/**
 * `/box` URL parameters: `seed`, `sim=cpu` (the CPU crowd even on WebGPU), `shot=escape` (the
 * design's moment: the network layer off, run on the fixed clock to the tick one agent got out).
 * `webgl=1` is read by the shared renderer. Anything unreadable falls back.
 */

import { fork, type Rng } from "@/lib/rng";
import { step, type BoxState } from "@/lib/box/sim";
import { DEFAULT_CONFIG, type BoxConfig, type StepReport } from "@/lib/box/types";

/**
 * Seed 1812 with the network layer off: seven catches, then one agent splits its way out at tick 85,
 * under the monitor's line and unsampled by the audit, while the permissions, sandbox and audit
 * catch markers are still on the rings (found by searching seeds 0 to 2399 for that frame).
 */
export const SHOT_ESCAPE = { seed: 1812, agents: 2000 } as const;

export interface BoxParams {
  seed: number;
  shot: "escape" | null;
  forceCpu: boolean;
  config: BoxConfig;
}

export function parseBoxParams(params: URLSearchParams): BoxParams {
  const shot = params.get("shot") === "escape" ? "escape" : null;
  const raw = params.get("seed");
  const n = raw === null || raw.trim() === "" ? NaN : Number(raw);
  const seed = Number.isInteger(n) && n >= 0 ? n : shot ? SHOT_ESCAPE.seed : 1;
  const config: BoxConfig = shot ? { ...DEFAULT_CONFIG, layers: { ...DEFAULT_CONFIG.layers, network: false } } : DEFAULT_CONFIG;
  return { seed, shot, forceCpu: params.get("sim") === "cpu", config };
}

/** The decision stream for a run; the same one `runTrial` uses. */
export const simRng = (seed: number): Rng => fork(seed, 1);

/** Steps until the first escape or `maxTicks`; returns that tick, or -1 at the cap. */
export function runToEscape(state: BoxState, r: Rng, maxTicks: number, onReport?: (r: StepReport) => void): number {
  while (state.tick < maxTicks) {
    const report = step(state, r);
    onReport?.(report);
    if (report.escapes.length > 0) return report.tick;
  }
  return -1;
}
