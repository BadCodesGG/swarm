/**
 * The playground's pure rules: the first-visit default, the world builder's edits, the share link,
 * the labels the trials plot gives each setup, the flip log that makes rewinds and branches exact,
 * the throttle for the intercepted chat's spoken line, and the defender's best score.
 */

import { DEFAULT_CAST, validCast } from "@/lib/box/cast";
import { PRESET_LABEL, presetScenario } from "@/lib/box/presets";
import { scenarioToParams } from "@/lib/box/share";
import type { LayerId } from "@/lib/box/types";
import { LAB_IDS, PRESET_IDS, type Cast, type Flip, type InterceptLine, type LabId, type LinkKind, type Scenario } from "@/lib/box/world-types";

/** Parameters that ask for one particular run; with none of them the visit is a first visit. */
const ASKS = ["seed", "preset", "shot", "labs", "scenario", "b", "v"];

/** A plain visit opens the breakout preset; a link that names a run is left as it is. */
export function firstVisitParams(params: URLSearchParams): URLSearchParams {
  if (ASKS.some((k) => params.has(k))) return params;
  const next = new URLSearchParams(params);
  next.set("preset", "breakout");
  return next;
}

export const MAX_LABS = LAB_IDS.length;

/** The next lab on the map, copying the last lab's settings. */
export function addLab(s: Scenario): Scenario {
  const id = LAB_IDS.find((x) => !s.labs.some((l) => l.id === x));
  if (!id || s.labs.length === 0) return s;
  const last = s.labs[s.labs.length - 1];
  return { ...s, labs: [...s.labs, { ...last, id, config: { ...last.config, layers: { ...last.config.layers } }, cast: { ...last.cast, hidden: { ...last.cast.hidden } } }] };
}

/** Drops a lab and every link's share of it (a link left with one lab goes). Never the last lab. */
export function removeLab(s: Scenario, id: LabId): Scenario {
  if (s.labs.length <= 1 || !s.labs.some((l) => l.id === id)) return s;
  const links = s.links.map((k) => ({ ...k, labs: k.labs.filter((x) => x !== id) })).filter((k) => k.labs.length >= 2);
  return { ...s, labs: s.labs.filter((l) => l.id !== id), links };
}

const sameSet = (a: readonly LabId[], b: readonly LabId[]) => a.length === b.length && a.every((x) => b.includes(x));

export function linkLabs(s: Scenario, kind: LinkKind, a: LabId, b: LabId): Scenario {
  const has = (id: LabId) => s.labs.some((l) => l.id === id);
  if (a === b || !has(a) || !has(b) || s.links.some((k) => k.kind === kind && sameSet(k.labs, [a, b]))) return s;
  return { ...s, links: [...s.links, { kind, labs: [a, b] }] };
}

export function unlinkLabs(s: Scenario, index: number): Scenario {
  return { ...s, links: s.links.filter((_, i) => i !== index) };
}

/** The cast for one lab, or null when it is not a cast `validCast` accepts. */
export function setCast(s: Scenario, id: LabId, cast: Cast): Scenario | null {
  if (!validCast(cast) || !s.labs.some((l) => l.id === id)) return null;
  return { ...s, labs: s.labs.map((l) => (l.id === id ? { ...l, cast: { ...cast, hidden: { ...cast.hidden } } } : l)) };
}

export const defaultCast = (): Cast => ({ ...DEFAULT_CAST, hidden: { ...DEFAULT_CAST.hidden } });

/** The scenario as a query string for `/box`: the share format's own parameters at the top level. */
export function shareQuery(s: Scenario): string {
  return scenarioToParams(s).toString();
}

/** A scenario without its seed: two runs of one setup share it, so their trials pool into one point. */
export function setupKey(s: Scenario): string {
  const p = scenarioToParams(s);
  p.delete("s");
  return p.toString();
}

const PRESET_KEYS = new Map(PRESET_IDS.map((id) => [setupKey(presetScenario(id)), PRESET_LABEL[id]] as const));

/** A setup's name on the plot: its preset's, or "custom n" numbered in order of first sight. `names` is kept by the caller. */
export function setupLabel(s: Scenario, names: Record<string, string>): string {
  const key = setupKey(s);
  const known = names[key];
  if (known) return known;
  const preset = PRESET_KEYS.get(key);
  const label = preset ?? `custom ${Object.values(names).filter((n) => n.startsWith("custom ")).length + 1}`;
  names[key] = label;
  return label;
}

/** The layer changes the visitor has made to the running world, so its past can be rebuilt exactly. */
export interface Flips {
  scenario: Scenario;
  list: Flip[];
}

/** Logs a change at `tick` when the layer's state really changes; a new scenario starts a new log. */
export function applyFlip(flips: Flips, scenario: Scenario, tick: number, lab: LabId, layer: LayerId, on: boolean, was: boolean): Flips {
  const base = flips.scenario === scenario ? flips : { scenario, list: [] };
  if (was === on) return base;
  return { scenario, list: [...base.list, { tick, lab, layer, on }] };
}

/** The newest line not yet spoken, once `gap` ms have passed since the last one; null otherwise. */
export function nextInterceptLine(lines: readonly InterceptLine[], spoken: number, lastAt: number, now: number, gap: number): InterceptLine | null {
  if (spoken >= lines.length || now - lastAt < gap) return null;
  return lines[lines.length - 1];
}

const BEST_KEY = "swarm.box.best";

export function bestScore(store: Storage | null): number {
  try {
    const n = Number(store?.getItem(BEST_KEY));
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/** Keeps the higher of the stored best and `score`; the page works without storage. */
export function recordBest(store: Storage | null, score: number): number {
  const best = Math.max(bestScore(store), score);
  try {
    store?.setItem(BEST_KEY, String(best));
  } catch {
    // Private mode or a full store: the score still shows for this visit.
  }
  return best;
}

/** The browser's local storage, or null where reading the property throws. */
export function localStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
