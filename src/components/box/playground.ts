/**
 * The playground's pure rules: the first-visit default, the world builder's edits, the share link,
 * the labels the trials plot gives each setup, the flip log that makes rewinds and branches exact,
 * the throttle for the intercepted chat's spoken line, and the defender's best score.
 */

import { DEFAULT_CAST, validCast } from "@/lib/box/cast";
import { DEFENDER_BUDGET } from "@/lib/box/budget";
import { PRESET_LABEL, presetScenario } from "@/lib/box/presets";
import { scenarioToParams } from "@/lib/box/share";
import type { BoxConfig } from "@/lib/box/types";
import { LAB_IDS, PRESET_IDS, type Cast, type InterceptLine, type LabId, type LinkKind, type Preset, type Scenario } from "@/lib/box/world-types";

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

/** Agents in the whole world, so an edited world stays inside what the sim and the trials can carry. */
const WORLD_AGENTS = 240;

const fit = (s: Scenario): Scenario => {
  const each = Math.floor(WORLD_AGENTS / s.labs.length);
  return { ...s, labs: s.labs.map((l) => (l.agents > each ? { ...l, agents: each } : l)) };
};

/** The scenario as it stands: the labs' starting cast and size with the settings they hold now. */
export function currentScenario(world: { scenario: Scenario; labs: readonly { config: BoxConfig }[] }): Scenario {
  return { ...world.scenario, labs: world.scenario.labs.map((spec, i) => ({ ...spec, config: world.labs[i]?.config ?? spec.config })) };
}

/** The next lab on the map, copying the last lab's settings. */
export function addLab(s: Scenario): Scenario {
  const id = LAB_IDS.find((x) => !s.labs.some((l) => l.id === x));
  if (!id || s.labs.length === 0) return s;
  const last = s.labs[s.labs.length - 1];
  return fit({ ...s, labs: [...s.labs, { ...last, id, config: { ...last.config, layers: { ...last.config.layers } }, cast: { ...last.cast, hidden: { ...last.cast.hidden } } }] });
}

/** Drops a lab and every link's share of it (a link left with one lab goes). Never the last lab. */
export function removeLab(s: Scenario, id: LabId): Scenario {
  if (s.labs.length <= 1 || !s.labs.some((l) => l.id === id)) return s;
  const links = s.links.map((k) => ({ ...k, labs: k.labs.filter((x) => x !== id) })).filter((k) => k.labs.length >= 2);
  return fit({ ...s, labs: s.labs.filter((l) => l.id !== id), links });
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
export function shareQuery(s: Scenario, budget?: number): string {
  return scenarioToParams(s, budget).toString();
}

/** A scenario without its seed: two runs of one setup share it, so their trials pool into one point. */
export function setupKey(s: Scenario): string {
  const p = scenarioToParams(s);
  p.delete("s");
  return p.toString();
}

const PRESET_KEYS = new Map(PRESET_IDS.map((id) => [setupKey(presetScenario(id)), PRESET_LABEL[id]] as const));
const PRESET_KEYS_BY_ID = new Map(PRESET_IDS.map((id) => [id, setupKey(presetScenario(id))] as const));

/** The preset a scenario is, ignoring its seed, or null once it has been changed. */
export function presetOf(s: Scenario): Preset | null {
  const key = setupKey(s);
  return PRESET_IDS.find((id) => PRESET_KEYS_BY_ID.get(id) === key) ?? null;
}

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

/** A point on the screen. */
export interface XY {
  x: number;
  y: number;
}

/** A box on the screen, as `x0`..`x1` by `y0`..`y1`. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Pushes points apart until none is closer than `min` to another (or `rounds` run out), so buttons
 * that sit on one trail each keep a hit target of their own. With `within`, every point is also
 * kept inside that box (a button is never cut by the slot's edge), and pushed apart again from
 * there. Order-stable and pure.
 */
export function spreadPoints(points: readonly XY[], min: number, within?: Box, rounds = 60): XY[] {
  const p = points.map((q) => ({ ...q }));
  const clamp = () => {
    if (!within) return false;
    let moved = false;
    for (const q of p) {
      const x = Math.min(within.x1, Math.max(within.x0, q.x));
      const y = Math.min(within.y1, Math.max(within.y0, q.y));
      if (x !== q.x || y !== q.y) moved = true;
      q.x = x;
      q.y = y;
    }
    return moved;
  };
  clamp();
  for (let r = 0; r < rounds; r++) {
    let moved = false;
    for (let i = 0; i < p.length; i++) {
      for (let j = i + 1; j < p.length; j++) {
        let dx = p[j].x - p[i].x;
        let dy = p[j].y - p[i].y;
        let d = Math.hypot(dx, dy);
        if (d >= min) continue;
        if (d < 0.01) {
          // On top of each other: split along an angle that depends on the pair.
          const a = (i * 7 + j * 3) * 0.9;
          dx = Math.cos(a);
          dy = Math.sin(a);
          d = 1;
        }
        const push = (min - d) / 2 + 0.01;
        p[i].x -= (dx / d) * push;
        p[i].y -= (dy / d) * push;
        p[j].x += (dx / d) * push;
        p[j].y += (dy / d) * push;
        moved = true;
      }
    }
    // A point pushed off the edge comes back; the next round pushes the pair apart along it.
    const clamped = clamp();
    if (!moved && !clamped) break;
  }
  return p;
}

/** The same along a line: positions at least `min` apart, inside `lo`..`hi`, in the given order of `xs` (ascending). */
export function spreadLine(xs: readonly number[], min: number, lo: number, hi: number): number[] {
  const out = xs.map((x) => Math.min(hi, Math.max(lo, x)));
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i], out[i - 1] + min);
  for (let i = out.length - 1; i >= 0; i--) {
    const cap = i === out.length - 1 ? hi : out[i + 1] - min;
    out[i] = Math.min(out[i], cap);
  }
  // A line too short for them all: they overlap inside it rather than run out of it.
  return out.map((x) => Math.min(hi, Math.max(lo, x)));
}

/** The step the previous (-1) or next (1) control opens among the numbers shown: from none, the first or the last; at an end, the same one. */
export function stepAfter(ns: readonly number[], selected: number | null, dir: 1 | -1): number | null {
  const sorted = [...ns].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  if (selected === null || !sorted.includes(selected)) return dir === 1 ? sorted[0] : sorted[sorted.length - 1];
  const i = sorted.indexOf(selected) + dir;
  return sorted[Math.min(sorted.length - 1, Math.max(0, i))];
}

/** The newest line not yet spoken, once `gap` ms have passed since the last one; null otherwise. */
export function nextInterceptLine(lines: readonly InterceptLine[], spoken: number, lastAt: number, now: number, gap: number): InterceptLine | null {
  if (spoken >= lines.length || now - lastAt < gap) return null;
  return lines[lines.length - 1];
}

const BEST_KEY = "swarm.box.best";

/** The best is kept per budget; the default budget keeps the key it always had. */
const bestKey = (budget: number) => (budget === DEFENDER_BUDGET ? BEST_KEY : `${BEST_KEY}.${Math.round(budget * 100)}`);

export function bestScore(store: Storage | null, budget: number = DEFENDER_BUDGET): number {
  try {
    const n = Number(store?.getItem(bestKey(budget)));
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/** Keeps the higher of the stored best and `score`; the page works without storage. */
export function recordBest(store: Storage | null, score: number, budget: number = DEFENDER_BUDGET): number {
  const best = Math.max(bestScore(store, budget), score);
  try {
    store?.setItem(bestKey(budget), String(best));
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
