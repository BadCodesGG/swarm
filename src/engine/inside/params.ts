/**
 * `/inside` URL parameters: `source=small|medium|large` (or `upload`, the visitor's own session held in memory), `seed`, `t` (trace seconds), `rate`,
 * `shot=hero` (fixed clock, paused at `t`), `select` (an agent id), `hud=0` (hide the HUD). Anything unreadable falls back.
 */

import type { SampleSize } from "@/lib/trace/generate";
import { clampRate } from "./playback";

/** The hero frame: a medium sample in a burst with five live subagents and two web probes out. */
export const HERO = { source: "medium" as SampleSize, seed: 13, t: 268.5, rate: 4 };

export interface InsideParams {
  source: SampleSize;
  /** `source=upload`: play the session held in memory; `source` stays the sample to fall back to. */
  upload: boolean;
  seed: number;
  t: number;
  rate: number;
  shot: boolean;
  select: number | null;
  /** False for `hud=0`: the scene alone. */
  hud: boolean;
}

const SOURCES: readonly SampleSize[] = ["small", "medium", "large"];

function num(v: string | null): number | null {
  if (v === null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function parseInsideParams(params: URLSearchParams): InsideParams {
  const source = SOURCES.find((s) => s === params.get("source")) ?? HERO.source;
  const seedN = num(params.get("seed"));
  const seed = seedN !== null && Number.isInteger(seedN) && seedN >= 0 ? seedN : HERO.seed;
  const shot = params.get("shot") === "hero";
  const isHero = source === HERO.source && seed === HERO.seed;
  const tN = num(params.get("t"));
  const t = tN !== null && tN >= 0 ? tN : isHero ? HERO.t : 0;
  const rateN = num(params.get("rate"));
  const rate = rateN !== null && rateN > 0 ? clampRate(rateN) : shot ? HERO.rate : 1;
  const selN = num(params.get("select"));
  const select = selN !== null && Number.isInteger(selN) && selN > 0 ? selN : null;
  return { source, upload: params.get("source") === "upload", seed, t, rate, shot, select, hud: params.get("hud") !== "0" };
}
