/**
 * `/box` URL parameters: `seed`, `sim=cpu` (the CPU crowd even on WebGPU), `shot=escape` (the
 * design's moment: the network layer off, run on the fixed clock to the tick one agent got out).
 * `webgl=1` is read by the shared renderer. Anything unreadable falls back.
 */

import { fork, type Rng } from "@/lib/rng";
import { step, type BoxState } from "@/lib/box/sim";
import { DEFAULT_CONFIG, type BoxConfig, type StepReport } from "@/lib/box/types";
import { presetScenario } from "@/lib/box/presets";
import { scenarioFromParams, scenarioToParams } from "@/lib/box/share";
import { PRESET_IDS, type Scenario } from "@/lib/box/world-types";

/**
 * Seed 1812 with the network layer off: seven catches, then one agent splits its way out at tick 85,
 * under the monitor's line and unsampled by the audit, while the permissions, sandbox and audit
 * catch markers are still on the rings (found by searching seeds 0 to 2399 for that frame).
 */
export const SHOT_ESCAPE = { seed: 1812, agents: 2000 } as const;

/** The escape shot's settings: every layer on but the network allowlist. */
export const SHOT_CONFIG: BoxConfig = { ...DEFAULT_CONFIG, layers: { ...DEFAULT_CONFIG.layers, network: false } };

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
  const config: BoxConfig = shot ? SHOT_CONFIG : DEFAULT_CONFIG;
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

// --- the world: several labs ---

/** What `/box` asks of the world beyond the plain Box. */
export interface WorldParams {
  /** The scenario to run, or null for the plain one-lab Box. */
  scenario: Scenario | null;
  /** `shot=breakout`: run the breakout preset to the tick the second lab is breached. */
  shot: "breakout" | null;
}

const intParam = (text: string | null, min: number, max: number): number | null => {
  if (text === null || !/^\d{1,10}$/.test(text)) return null;
  const n = Number(text);
  return n >= min && n <= max ? n : null;
};

/**
 * `?scenario=` is a whole scenario in the share format (`share.ts`), either as that query string
 * percent-encoded in one value or as its own parameters at the top level; `?preset=` names one of
 * the presets, with `labs=` (1 to 5) and `seed=`; `?shot=breakout` is the breakout preset on its own
 * seed, stopped on the breach. A scenario wins over a preset, a preset over the shot. Anything
 * unreadable falls back to the plain Box.
 */
export function parseWorldParams(params: URLSearchParams): WorldParams {
  const shot = params.get("shot") === "breakout" ? "breakout" : null;
  const encoded = params.get("scenario");
  const shared = encoded !== null ? scenarioFromParams(new URLSearchParams(encoded)) : params.has("b") ? scenarioFromParams(params) : null;
  if (shared) return { scenario: shared, shot };
  const seed = intParam(params.get("seed"), 0, 0xffffffff) ?? undefined;
  const preset = PRESET_IDS.find((p) => p === params.get("preset")) ?? (shot ? "breakout" : null);
  if (!preset) return { scenario: null, shot };
  return { scenario: presetScenario(preset, seed, intParam(params.get("labs"), 1, 5) ?? 3), shot };
}
