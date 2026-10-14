import { describe, expect, it } from "vitest";
import { presetScenario } from "./presets";
import { createWorld, replayWorld, runWithFlips, setLayer, stepWorld } from "./world";
import type { Flip } from "./world-types";

const scenario = presetScenario("breakout");
const flips: Flip[] = [
  { tick: 60, lab: "kestrel", layer: "monitor", on: false },
  { tick: 140, lab: "halcyon", layer: "audit", on: false },
  { tick: 200, lab: "kestrel", layer: "monitor", on: true },
];
const HEAD = 330;

/** A run that never stopped: the flips applied by hand as the clock reaches them. */
function uninterrupted() {
  const w = createWorld(scenario, false);
  while (w.tick < HEAD) {
    for (const f of flips) if (f.tick === w.tick) setLayer(w, f.lab, f.layer, f.on);
    stepWorld(w);
  }
  return w;
}

describe("seeking by replay", () => {
  it("a run seeked back and then taken live again is the run that never stopped", () => {
    const straight = uninterrupted();
    for (const at of [0, 1, 59, 60, 141, 199, 250]) {
      const back = replayWorld(scenario, flips, at);
      expect(back.tick).toBe(at);
      expect(back.flips.every((f) => f.tick <= at)).toBe(true);
      // Live again: the same flips, carried on to the head.
      runWithFlips(back, flips, HEAD);
      expect(back.tick).toBe(HEAD);
      expect(back.log).toEqual(straight.log);
      expect(back.flips).toEqual(straight.flips);
      expect(back.labs.map((l) => l.state.escapedTotal)).toEqual(straight.labs.map((l) => l.state.escapedTotal));
      expect(back.labs.map((l) => l.breached)).toEqual(straight.labs.map((l) => l.breached));
    }
  });

  it("shows a moment as it was: only what had happened by that tick", () => {
    const head = replayWorld(scenario, flips, HEAD);
    const early = replayWorld(scenario, flips, 100);
    expect(early.log.every((e) => e.tick <= 100)).toBe(true);
    expect(head.log.slice(0, early.log.length)).toEqual(early.log);
    expect(early.flips).toEqual(flips.filter((f) => f.tick <= 100));
  });

  it("calls the viewer's hooks for every step and every flip, in order", () => {
    const w = createWorld(scenario, false);
    const seen: string[] = [];
    runWithFlips(w, flips, 150, { step: () => { stepWorld(w); seen.push(`s${w.tick}`); }, flip: (f) => seen.push(`f${f.tick}`) });
    expect(seen.filter((x) => x[0] === "f")).toEqual(["f60", "f140"]);
    expect(seen.indexOf("f60")).toBeLessThan(seen.indexOf("s61"));
    expect(seen.indexOf("f60")).toBeGreaterThan(seen.indexOf("s60"));
    expect(seen.filter((x) => x[0] === "s")).toHaveLength(150);
  });
});
