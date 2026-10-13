/** A random source: returns a float in [0, 1). Every draw in the project goes through one. */
export type Rng = () => number;

/** mulberry32: small, fast, good enough for sampling and layout. */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An independent stream derived from a seed, so adding draws to one stream never shifts another. */
export function fork(seed: number, stream: number): Rng {
  let h = (seed ^ Math.imul(stream + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return rng((h ^ (h >>> 16)) >>> 0);
}

/** Index drawn in proportion to `weights` (non-negative, at least one positive). */
export function pick(weights: readonly number[], r: Rng): number {
  let total = 0;
  for (const w of weights) total += w;
  if (!(total > 0)) throw new Error("pick: weights must sum above zero");
  let x = r() * total;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i];
    if (x < 0) return i;
  }
  return weights.length - 1;
}

/** Quantiles at p10, p25, p50, p75, p90, p99 of a positive quantity. */
export interface Quantiles {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p99: number;
}

const QS: readonly [number, keyof Quantiles][] = [
  [0.1, "p10"],
  [0.25, "p25"],
  [0.5, "p50"],
  [0.75, "p75"],
  [0.9, "p90"],
  [0.99, "p99"],
];

/**
 * Draw from a distribution described by its quantiles: piecewise linear in log space between
 * them, clamped to [p10, p99] at the tails.
 */
export function sampleQuantiles(q: Quantiles, r: Rng): number {
  const u = r();
  if (u <= QS[0][0]) return q.p10;
  for (let i = 1; i < QS.length; i++) {
    const [p1, k1] = QS[i];
    if (u <= p1) {
      const [p0, k0] = QS[i - 1];
      const f = (u - p0) / (p1 - p0);
      const a = Math.log(Math.max(q[k0], 1e-9));
      const b = Math.log(Math.max(q[k1], 1e-9));
      return Math.exp(a + (b - a) * f);
    }
  }
  return q.p99;
}
