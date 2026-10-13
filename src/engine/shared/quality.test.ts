import { describe, expect, it } from "vitest";
import { FrameBudget, TIERS, adaptQuality, budgetOptions, maxPixelRatio, resolveQuality, stepDown, type QualityInputs } from "./quality";

const desktop: QualityInputs = { pref: "auto", isWebGPU: true, coarsePointer: false, viewportWidth: 1600 };

describe("resolveQuality", () => {
  it("starts a desktop WebGPU visitor on auto at hi, and measures", () => {
    expect(resolveQuality(desktop)).toEqual({ level: { tier: "hi" }, adaptive: true });
  });

  it("puts WebGL2 on lite", () => {
    expect(resolveQuality({ ...desktop, isWebGPU: false }).level).toEqual({ tier: "lite" });
  });

  it("puts a coarse pointer or a viewport narrower than 900 px on lite", () => {
    expect(resolveQuality({ ...desktop, coarsePointer: true }).level.tier).toBe("lite");
    expect(resolveQuality({ ...desktop, viewportWidth: 899 }).level.tier).toBe("lite");
    expect(resolveQuality({ ...desktop, viewportWidth: 900 }).level.tier).toBe("hi");
  });

  it("honours an explicit preference and never adapts it", () => {
    expect(resolveQuality({ ...desktop, pref: "hi", coarsePointer: true })).toEqual({ level: { tier: "hi" }, adaptive: false });
    expect(resolveQuality({ ...desktop, pref: "lite" })).toEqual({ level: { tier: "lite" }, adaptive: false });
  });

  it("lets a URL override pin the tier without adapting", () => {
    expect(resolveQuality({ ...desktop, override: { tier: "mid" } })).toEqual({ level: { tier: "mid" }, adaptive: false });
  });

  it("never adapts a scripted run", () => {
    expect(resolveQuality({ ...desktop, scripted: true }).adaptive).toBe(false);
  });
});

describe("tiers", () => {
  it("shrink the particle cap, crowd and pixel ratio monotonically down the ladder", () => {
    const { hi, mid, lite } = TIERS;
    expect(hi.particleCap).toBeGreaterThan(mid.particleCap);
    expect(mid.particleCap).toBeGreaterThan(lite.particleCap);
    expect(hi.crowdSize).toBeGreaterThan(mid.crowdSize);
    expect(mid.crowdSize).toBeGreaterThan(lite.crowdSize);
    expect(hi.pixelRatio).toBeGreaterThanOrEqual(mid.pixelRatio);
    expect(mid.pixelRatio).toBeGreaterThanOrEqual(lite.pixelRatio);
  });
});

describe("stepDown", () => {
  it("walks hi to mid to lite, then stops", () => {
    expect(stepDown({ tier: "hi" })).toEqual({ tier: "mid" });
    expect(stepDown({ tier: "mid" })).toEqual({ tier: "lite" });
    expect(stepDown({ tier: "lite" })).toBeNull();
  });
});

describe("FrameBudget", () => {
  const feed = (b: FrameBudget, ms: number, n: number) => {
    const verdicts = new Set<string>();
    for (let i = 0; i < n; i++) verdicts.add(b.push(ms));
    return verdicts;
  };

  it("skips the warm-up frames, then judges the mean of 90 frames against 20 ms", () => {
    const slow = new FrameBudget({ warmup: 30 });
    // Warm-up frames (shader compiles) are huge and must not count.
    expect(feed(slow, 200, 30)).toEqual(new Set(["sampling"]));
    // A slow renderer on a 60 Hz display: some frames make the vsync, most miss it.
    expect(feed(slow, 16.7, 9)).toEqual(new Set(["sampling"]));
    expect(feed(slow, 22, 80)).toEqual(new Set(["sampling"]));
    expect(slow.push(22)).toBe("slow");

    const fine = new FrameBudget({ warmup: 30 });
    feed(fine, 200, 30);
    feed(fine, 19, 89);
    expect(fine.push(19)).toBe("ok");
  });

  it("does not condemn a fast GPU on a 30 Hz display, whose every frame is 33 ms", () => {
    const b = new FrameBudget({ warmup: 30 });
    feed(b, 200, 30);
    feed(b, 33.3, 89);
    expect(b.push(33.3)).toBe("ok");
    // A genuinely slow renderer on a 60 Hz display misses vsyncs: intervals well past the refresh.
    const slow = new FrameBudget({ warmup: 30 });
    feed(slow, 200, 30);
    feed(slow, 16.7, 10);
    feed(slow, 50, 79);
    expect(slow.push(50)).toBe("slow");
  });

  it("uses the mean, so a few long frames do not condemn a fast device", () => {
    const b = new FrameBudget({ warmup: 0 });
    feed(b, 16, 85);
    feed(b, 60, 4);
    expect(b.push(16)).toBe("ok");
  });

  it("ignores gaps longer than a second, as when the tab was hidden", () => {
    const b = new FrameBudget({ warmup: 0 });
    feed(b, 10, 45);
    expect(b.push(5000)).toBe("sampling");
    feed(b, 10, 44);
    expect(b.push(10)).toBe("ok");
  });

  it("starts a fresh round after reset, warm-up included, and says done once judged ok", () => {
    const b = new FrameBudget({ warmup: 10 });
    feed(b, 40, 10);
    feed(b, 16.7, 5);
    feed(b, 40, 84);
    expect(b.push(40)).toBe("slow");
    b.reset();
    expect(feed(b, 40, 10)).toEqual(new Set(["sampling"]));
    feed(b, 12, 89);
    expect(b.push(12)).toBe("ok");
    expect(b.push(50)).toBe("done");
  });
});

describe("maxPixelRatio", () => {
  it("allows the tier ratio on a fine pointer and caps touch devices at 1.5", () => {
    expect(maxPixelRatio({ tier: "hi" }, false)).toBe(2);
    expect(maxPixelRatio({ tier: "hi" }, true)).toBe(1.5);
    expect(maxPixelRatio({ tier: "lite" }, false)).toBe(TIERS.lite.pixelRatio);
    expect(maxPixelRatio({ tier: "lite" }, true)).toBe(TIERS.lite.pixelRatio);
  });
});

describe("adaptQuality", () => {
  const fast = { warmup: 2, samples: 4, budgetMs: 20 };
  // Slow means missed vsyncs: some frames at the refresh period, the rest well past it (see FrameBudget).
  const SLOW = [16, 64];
  const feed = (a: ReturnType<typeof adaptQuality>, ms: number | number[], n: number) => {
    const pattern = typeof ms === "number" ? [ms] : ms;
    const stepped: (string | null)[] = [];
    for (let i = 0; i < n; i++) stepped.push(a.frame(pattern[i % pattern.length])?.tier ?? null);
    return stepped.filter((s) => s !== null);
  };

  it("steps hi to mid to lite while frames stay slow, then stops at the bottom", () => {
    const a = adaptQuality({ level: { tier: "hi" }, adaptive: true }, fast);
    expect(feed(a, SLOW, 6)).toEqual(["mid"]);
    expect(a.level).toEqual({ tier: "mid" });
    expect(feed(a, SLOW, 6)).toEqual(["lite"]);
    expect(feed(a, SLOW, 60)).toEqual([]);
    expect(a.level).toEqual({ tier: "lite" });
  });

  it("needs a fresh warm-up and round after each step", () => {
    const a = adaptQuality({ level: { tier: "hi" }, adaptive: true }, fast);
    expect(feed(a, SLOW, 6)).toEqual(["mid"]);
    expect(feed(a, SLOW, 5)).toEqual([]);
    expect(feed(a, SLOW, 1)).toEqual(["lite"]);
  });

  it("stops watching once a round is within budget", () => {
    const a = adaptQuality({ level: { tier: "hi" }, adaptive: true }, fast);
    expect(feed(a, 16, 6)).toEqual([]);
    expect(feed(a, SLOW, 60)).toEqual([]);
    expect(a.level).toEqual({ tier: "hi" });
  });

  it("never steps a pinned or scripted plan", () => {
    const a = adaptQuality({ level: { tier: "hi" }, adaptive: false }, fast);
    expect(feed(a, SLOW, 60)).toEqual([]);
    expect(a.level).toEqual({ tier: "hi" });
  });

  it("reads a lowered budget from ?budgetMs=, and ignores anything that is not a positive number", () => {
    expect(budgetOptions(new URLSearchParams("budgetMs=4"))).toEqual({ budgetMs: 4 });
    expect(budgetOptions(new URLSearchParams("budgetMs=-1"))).toEqual({});
    expect(budgetOptions(new URLSearchParams("budgetMs=x"))).toEqual({});
    expect(budgetOptions(new URLSearchParams(""))).toEqual({});
  });
});
