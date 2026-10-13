import { describe, expect, it } from "vitest";
import { HERO, parseInsideParams } from "./params";

const parse = (q: string) => parseInsideParams(new URLSearchParams(q));

describe("parseInsideParams", () => {
  it("defaults to the hero sample, playing from the hero moment", () => {
    expect(parse("")).toEqual({ source: "medium", upload: false, seed: HERO.seed, t: HERO.t, rate: 1, shot: false, select: null, hud: true });
  });

  it("holds the hero shot at its own rate unless one is given", () => {
    expect(parse("shot=hero")).toMatchObject({ shot: true, rate: HERO.rate, t: HERO.t });
    expect(parse("shot=hero&rate=9&t=12.5")).toMatchObject({ shot: true, rate: 9, t: 12.5 });
  });

  it("starts another sample or seed from the beginning", () => {
    expect(parse("source=large&seed=4")).toMatchObject({ source: "large", seed: 4, t: 0 });
    expect(parse("seed=4&t=30")).toMatchObject({ seed: 4, t: 30 });
  });

  it("reads source=upload as the session held in memory, with the medium sample behind it", () => {
    expect(parse("source=upload")).toMatchObject({ upload: true, source: "medium" });
    expect(parse("source=large").upload).toBe(false);
  });

  it("falls back on anything it cannot read", () => {
    expect(parse("source=huge&seed=x&t=-3&rate=abc&select=q")).toEqual({
      source: "medium",
      upload: false,
      seed: HERO.seed,
      t: HERO.t,
      rate: 1,
      shot: false,
      select: null,
      hud: true,
    });
    expect(parse("rate=900").rate).toBe(200);
    expect(parse("select=5").select).toBe(5);
    expect(parse("shot=hero").hud).toBe(true);
    expect(parse("shot=hero&hud=0").hud).toBe(false);
  });
});
