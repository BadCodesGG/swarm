import { describe, expect, it } from "vitest";
import { fork, pick, rng, sampleQuantiles } from "./rng";

describe("rng", () => {
  it("repeats for the same seed and differs across seeds", () => {
    const a = rng(1);
    const b = rng(1);
    const c = rng(2);
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    expect([c(), c(), c()]).not.toEqual(xs);
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true);
  });

  it("forks streams that do not track each other", () => {
    const s0 = fork(7, 0);
    const s1 = fork(7, 1);
    expect(s0()).not.toBe(s1());
    expect(fork(7, 1)()).toBe(fork(7, 1)());
  });
});

describe("pick", () => {
  it("never returns a zero-weight index and follows the weights", () => {
    const r = rng(3);
    const counts = [0, 0, 0];
    for (let i = 0; i < 4000; i++) counts[pick([1, 0, 3], r)]++;
    expect(counts[1]).toBe(0);
    expect(counts[2] / counts[0]).toBeGreaterThan(2.4);
    expect(counts[2] / counts[0]).toBeLessThan(3.6);
  });

  it("rejects weights that sum to zero", () => {
    expect(() => pick([0, 0], rng(1))).toThrow();
  });
});

describe("sampleQuantiles", () => {
  const q = { p10: 1, p25: 2, p50: 4, p75: 8, p90: 16, p99: 64 };

  it("stays inside [p10, p99] and lands near the median", () => {
    const r = rng(5);
    const xs = Array.from({ length: 4000 }, () => sampleQuantiles(q, r)).sort((a, b) => a - b);
    expect(xs[0]).toBeGreaterThanOrEqual(1);
    expect(xs[xs.length - 1]).toBeLessThanOrEqual(64);
    const median = xs[2000];
    expect(median).toBeGreaterThan(3.3);
    expect(median).toBeLessThan(4.8);
  });
});
