import { describe, expect, it } from "vitest";
import { generateTrace } from "@/lib/trace/generate";
import { HERO, canShareMoment, parseInsideParams, serializeMoment } from "./params";

const parse = (q: string) => parseInsideParams(new URLSearchParams(q));

describe("parseInsideParams", () => {
  it("defaults to the hero sample, playing from the hero moment", () => {
    expect(parse("")).toEqual({ source: "medium", upload: false, seed: HERO.seed, t: HERO.t, rate: 1, shot: false, select: null, follow: null, hud: true });
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
      follow: null,
      hud: true,
    });
    expect(parse("rate=900").rate).toBe(200);
    expect(parse("select=5").select).toBe(5);
    expect(parse("shot=hero").hud).toBe(true);
    expect(parse("shot=hero&hud=0").hud).toBe(false);
  });
});

describe("follow", () => {
  it("parses a positive agent id and ignores the rest", () => {
    expect(parse("follow=7").follow).toBe(7);
    expect(parse("follow=0").follow).toBeNull();
    expect(parse("follow=-2").follow).toBeNull();
    expect(parse("follow=1.5").follow).toBeNull();
    expect(parse("follow=x").follow).toBeNull();
    expect(parse("").follow).toBeNull();
  });
});

describe("canShareMoment", () => {
  const sample = generateTrace(1, "small");
  it("allows a sample trace or sample params", () => {
    expect(canShareMoment(sample)).toBe(true);
    expect(canShareMoment(parse("source=large"))).toBe(true);
  });
  it("refuses an uploaded or imported session, and anything unknown", () => {
    expect(canShareMoment({ ...sample, source: "upload" })).toBe(false);
    expect(canShareMoment(parse("source=upload"))).toBe(false);
    expect(canShareMoment(null)).toBe(false);
    expect(canShareMoment(undefined)).toBe(false);
    expect(canShareMoment({} as never)).toBe(false);
  });
});

describe("serializeMoment", () => {
  const sample = generateTrace(1, "small");
  it("round-trips t, select and follow through the parser", () => {
    const q = serializeMoment({ source: "large", seed: 9, t: 41.26, select: 4, follow: 4 }, sample)!;
    expect(q).toBe("source=large&seed=9&t=41.3&select=4&follow=4");
    expect(parse(q)).toMatchObject({ source: "large", seed: 9, t: 41.3, select: 4, follow: 4, upload: false });
  });
  it("omits select and follow when unset or the orchestrator, and clamps a negative t", () => {
    expect(serializeMoment({ source: "small", seed: 1, t: -3, select: null, follow: 0 }, sample)).toBe("source=small&seed=1&t=0");
  });
  it("returns null for an upload, so an upload never reaches a URL", () => {
    expect(serializeMoment({ source: "medium", seed: 1, t: 5, select: 2 }, { ...sample, source: "upload" })).toBeNull();
    expect(serializeMoment({ source: "medium", seed: 1, t: 5 }, parse("source=upload"))).toBeNull();
  });
});
