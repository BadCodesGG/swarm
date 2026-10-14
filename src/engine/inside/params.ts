/**
 * `/inside` URL parameters: `source=small|medium|large` (or `upload`, the visitor's own session held in memory), `seed`, `t` (trace seconds), `rate`,
 * `shot=hero` (fixed clock, paused at `t`), `select` (an agent id), `follow` (an agent id the camera tracks), `hud=0` (hide the HUD). Anything unreadable falls back.
 */

import type { SampleSize } from "@/lib/trace/generate";
import type { SessionTrace } from "@/lib/trace/types";
import { clampRate } from "./playback";

/**
 * The hero frame: a medium sample (18 subagents) in a burst, six live (Fable, Sonnet and Haiku
 * around the Opus core, two levels deep), a Fable helper and a Sonnet helper searching the web
 * with a probe out past the boundary, and idle cuts ahead on the scrubber.
 */
export const HERO = { source: "medium" as SampleSize, seed: 50, t: 944, rate: 4 };

export interface InsideParams {
  source: SampleSize;
  /** `source=upload`: play the session held in memory; `source` stays the sample to fall back to. */
  upload: boolean;
  seed: number;
  t: number;
  rate: number;
  shot: boolean;
  select: number | null;
  /** An agent id the camera follows, or null. */
  follow: number | null;
  /** False for `hud=0`: the scene alone. */
  hud: boolean;
}

const SOURCES: readonly SampleSize[] = ["small", "medium", "large"];

function num(v: string | null): number | null {
  if (v === null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** A subagent id: a positive integer, else null (0 is the orchestrator and is never selected or followed by URL). */
function agentId(v: string | null): number | null {
  const n = num(v);
  return n !== null && Number.isInteger(n) && n > 0 ? n : null;
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
  const select = agentId(params.get("select"));
  const follow = agentId(params.get("follow"));
  return { source, upload: params.get("source") === "upload", seed, t, rate, shot, select, follow, hud: params.get("hud") !== "0" };
}

/** Where a moment came from: a loaded trace, or the parsed params. Anything else is not shareable. */
export type MomentSource = Pick<SessionTrace, "source"> | Pick<InsideParams, "upload"> | null | undefined;

/**
 * May a link to this moment be built? Only a seeded sample can be re-created from a URL. A visitor's
 * own session (an upload, whether held as a trace or named by `source=upload`) never reaches a URL.
 * Fails closed: an unknown source is not shareable.
 */
export function canShareMoment(source: MomentSource): boolean {
  if (!source) return false;
  // Params carry both a sample size in `source` and `upload`; check `upload` first.
  if ("upload" in source) return source.upload === false;
  return "source" in source && source.source === "sample";
}

export interface Moment {
  source: SampleSize;
  seed: number;
  /** Trace seconds. */
  t: number;
  select?: number | null;
  follow?: number | null;
}

/**
 * The query string (no leading `?`) that re-opens a moment of a sample session, or null when the
 * session cannot be shared. Round-trips through `parseInsideParams`.
 */
export function serializeMoment(moment: Moment, origin: MomentSource): string | null {
  if (!canShareMoment(origin)) return null;
  const q = new URLSearchParams({ source: moment.source, seed: String(moment.seed), t: String(Math.round(Math.max(0, moment.t) * 10) / 10) });
  if (moment.select != null && moment.select > 0) q.set("select", String(moment.select));
  if (moment.follow != null && moment.follow > 0) q.set("follow", String(moment.follow));
  return q.toString();
}
