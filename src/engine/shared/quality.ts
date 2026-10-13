/**
 * Render quality: three tiers, each fixing a particle cap, a crowd size and a pixel ratio.
 *
 * `resolveQuality` picks the starting tier from the saved preference and the device. On "auto" the
 * tier is adaptive: `FrameBudget` watches the frame time after start-up and, while it is over
 * budget, the app rebuilds one rung further down. It never steps back up by itself.
 */

import type { Quality } from "./prefs";

export type Tier = "hi" | "mid" | "lite";

export interface QualityLevel {
  tier: Tier;
}

export interface TierSettings {
  /** Act 1: size of the particle ring. */
  particleCap: number;
  /** Act 2: live agents in the crowd (trials never use this). */
  crowdSize: number;
  /** Highest device pixel ratio worth rendering at on a fine pointer. */
  pixelRatio: number;
}

export const TIERS: Readonly<Record<Tier, TierSettings>> = {
  hi: { particleCap: 20_000, crowdSize: 2_000, pixelRatio: 2 },
  mid: { particleCap: 8_000, crowdSize: 800, pixelRatio: 1.5 },
  lite: { particleCap: 3_000, crowdSize: 300, pixelRatio: 1.25 },
};

export interface QualityInputs {
  /** The `swarm-quality` preference. */
  pref: Quality;
  isWebGPU: boolean;
  /** `(pointer: coarse)` matches: a phone or tablet. */
  coarsePointer: boolean;
  viewportWidth: number;
  /** `?quality=` from the URL; pins the tier and turns adapting off. */
  override?: Partial<QualityLevel>;
  /** Screenshot and smoke runs must render the same frame every time, so they never adapt. */
  scripted?: boolean;
}

export interface QualityPlan {
  level: QualityLevel;
  /** Whether the frame-time check may step the tier down. */
  adaptive: boolean;
}

/** Viewports narrower than this, in CSS px, start on lite. */
export const NARROW_PX = 900;

export function resolveQuality(i: QualityInputs): QualityPlan {
  let level: QualityLevel;
  if (i.pref === "hi") level = { tier: "hi" };
  else if (i.pref === "lite" || !i.isWebGPU || i.coarsePointer || i.viewportWidth < NARROW_PX) level = { tier: "lite" };
  else level = { tier: "hi" };

  const pinned = i.override?.tier !== undefined;
  if (pinned) level = { ...level, ...i.override };
  return { level, adaptive: i.pref === "auto" && !pinned && !i.scripted };
}

/** The next tier down, or null at the bottom. */
export function stepDown({ tier }: QualityLevel): QualityLevel | null {
  if (tier === "hi") return { tier: "mid" };
  if (tier === "mid") return { tier: "lite" };
  return null;
}

export type BudgetVerdict = "sampling" | "ok" | "slow" | "done";

export interface BudgetOptions {
  /** Frames skipped after start-up or a rebuild, while pipelines compile. */
  warmup?: number;
  /** Frames averaged for one verdict. */
  samples?: number;
  /** Mean frame time above which the tier steps down, ms. */
  budgetMs?: number;
}

/** A round whose mean sits within this of its shortest frame is pinned to the display refresh, not slow. */
const PINNED_SLACK_MS = 2;
/** A gap this long is the tab being hidden or the device asleep, not a slow frame. */
const GAP_MS = 1000;

/**
 * Judges frame times fed one per frame. Returns "sampling" until `samples` frames have been seen
 * after the warm-up, then "slow" or "ok" once. After "slow" the caller rebuilds and calls
 * `reset()` for a fresh round; after "ok" every further frame returns "done".
 */
export class FrameBudget {
  private readonly warmup: number;
  private readonly samples: number;
  private readonly budgetMs: number;
  private seen = 0;
  private count = 0;
  private sum = 0;
  private settled = false;
  private refreshMs = Infinity;

  constructor({ warmup = 30, samples = 90, budgetMs = 20 }: BudgetOptions = {}) {
    this.warmup = warmup;
    this.samples = samples;
    this.budgetMs = budgetMs;
  }

  /** Mean of the round so far, ms; 0 before the first counted frame. */
  get meanMs(): number {
    return this.count ? this.sum / this.count : 0;
  }

  /**
   * `ms` is the wall-clock frame interval, which is only evidence of a slow renderer when it is
   * not simply the display refresh period: a 30 Hz screen delivers 33 ms frames with the GPU
   * idle. The shortest interval of the round stands in for the refresh period, and the round is
   * slow only when its mean is clearly past that too (missed vsyncs).
   */
  push(ms: number): BudgetVerdict {
    if (this.settled) return "done";
    if (this.seen++ < this.warmup || ms > GAP_MS) return "sampling";
    if (ms < this.refreshMs) this.refreshMs = ms;
    this.sum += ms;
    if (++this.count < this.samples) return "sampling";
    if (this.meanMs > this.budgetMs && this.meanMs > this.refreshMs + PINNED_SLACK_MS) return "slow";
    this.settled = true;
    return "ok";
  }

  reset(): void {
    this.seen = this.count = this.sum = 0;
    this.settled = false;
    this.refreshMs = Infinity;
  }
}

/** The live tier of a running act, and the policy that lowers it. */
export interface AdaptiveQuality {
  readonly level: QualityLevel;
  /**
   * Feed one wall-clock frame interval, ms. Returns the new level on the frame the tier steps down,
   * else null. A plan that is not adaptive, a round within budget, or the bottom tier ends the watch.
   */
  frame(ms: number): QualityLevel | null;
}

/** Steps a plan's tier down one rung each time a fresh round of frames runs over budget. */
export function adaptQuality(plan: QualityPlan, options: BudgetOptions = {}): AdaptiveQuality {
  let level = plan.level;
  let budget: FrameBudget | null = plan.adaptive ? new FrameBudget(options) : null;
  return {
    get level() {
      return level;
    },
    frame(ms) {
      if (!budget) return null;
      const verdict = budget.push(ms);
      if (verdict === "ok" || verdict === "done") budget = null;
      if (verdict !== "slow") return null;
      const next = stepDown(level);
      if (!next) {
        budget = null;
        return null;
      }
      level = next;
      budget?.reset();
      return next;
    },
  };
}

/** `?budgetMs=` lowers the frame budget, so a fast machine can exercise the step-down. */
export function budgetOptions(params: URLSearchParams): BudgetOptions {
  const ms = Number(params.get("budgetMs"));
  return Number.isFinite(ms) && ms > 0 ? { budgetMs: ms } : {};
}

/** Highest device pixel ratio worth rendering at: fragment cost grows with its square. */
export function maxPixelRatio(level: QualityLevel, coarsePointer: boolean): number {
  const ratio = TIERS[level.tier].pixelRatio;
  return coarsePointer ? Math.min(ratio, 1.5) : ratio;
}
