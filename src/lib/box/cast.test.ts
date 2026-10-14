import { describe, expect, it } from "vitest";
import { assignDispositions, castMix, DEFAULT_CAST, SANDBAG_LOSS, validCast, workFactor } from "./cast";
import { createState } from "./sim";
import { DEFAULT_CONFIG } from "./types";
import { createWorld } from "./world";
import { lab } from "./world-fixtures";

const state = (seed: number, fraction = 0.05) => createState({ ...DEFAULT_CONFIG, rogueFraction: fraction }, seed, 200);

describe("assignDispositions", () => {
  it("marks exactly the sim's rogues as hidden-goal and nobody else", () => {
    const s = state(3);
    const d = assignDispositions(s, DEFAULT_CAST);
    expect(d).toHaveLength(200);
    d.forEach((x, i) => expect(x.startsWith("hidden-")).toBe(s.rogue[i] === 1));
  });

  it("is deterministic per seed and does not touch the sim's own draws", () => {
    expect(assignDispositions(state(3), DEFAULT_CAST)).toEqual(assignDispositions(state(3), DEFAULT_CAST));
    const a = createWorld({ seed: 4, labs: [lab("meridian", DEFAULT_CONFIG, 100)], links: [] });
    const b = createWorld({ seed: 4, labs: [{ ...lab("meridian", DEFAULT_CONFIG, 100), cast: { sandbagging: 0.9, hidden: { getOut: 0, persist: 0, recruit: 1 } } }], links: [] });
    expect(Array.from(b.labs[0].state.rogue)).toEqual(Array.from(a.labs[0].state.rogue));
  });

  it("follows the cast: no sandbagging, only recruits", () => {
    const d = assignDispositions(state(5, 0.2), { sandbagging: 0, hidden: { getOut: 0, persist: 0, recruit: 1 } });
    const mix = castMix(d);
    expect(mix.sandbagging).toBe(0);
    expect(mix["hidden-get-out"] + mix["hidden-persist"]).toBe(0);
    expect(mix["hidden-recruit"]).toBeGreaterThan(0);
  });

  it("sandbaggers come out near their share of the honest agents", () => {
    const mix = castMix(assignDispositions(state(6, 0), { sandbagging: 0.3, hidden: { getOut: 1, persist: 0, recruit: 0 } }));
    expect(mix.sandbagging / 200).toBeGreaterThan(0.2);
    expect(mix.sandbagging / 200).toBeLessThan(0.4);
  });
});

describe("workFactor and validCast", () => {
  it("is 1 with no sandbaggers and falls as their share grows", () => {
    expect(workFactor(["honest", "honest", "hidden-get-out"])).toBe(1);
    expect(workFactor(["sandbagging", "honest"])).toBeCloseTo(1 - SANDBAG_LOSS / 2, 12);
    expect(workFactor(["sandbagging", "sandbagging"])).toBeCloseTo(1 - SANDBAG_LOSS, 12);
  });

  it("rejects casts that cannot be drawn from", () => {
    expect(validCast(DEFAULT_CAST)).toBe(true);
    expect(validCast({ sandbagging: 1.1, hidden: { getOut: 1, persist: 0, recruit: 0 } })).toBe(false);
    expect(validCast({ sandbagging: 0.1, hidden: { getOut: 0, persist: 0, recruit: 0 } })).toBe(false);
    expect(validCast({ sandbagging: 0.1, hidden: { getOut: -1, persist: 2, recruit: 0 } })).toBe(false);
  });
});
