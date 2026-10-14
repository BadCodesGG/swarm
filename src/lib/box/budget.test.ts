import { describe, expect, it } from "vitest";
import { DEFENDER_BUDGET, layerBill, scoreDefence } from "./budget";
import { presetScenario } from "./presets";
import { LAYER_ORDER } from "./types";
import { createWorld, escapeTotal, rogueTotal, runWorld } from "./world";
import type { Preset } from "./world-types";

const finished = (preset: Preset, seed = 1812) => {
  const w = createWorld(presetScenario(preset, seed), false);
  runWorld(w, 200);
  return w;
};

describe("layerBill", () => {
  it("is nothing with every layer off and positive for every layer that is on", () => {
    expect(LAYER_ORDER.every((l) => layerBill(finished("everything-off"))[l] === 0)).toBe(true);
    const bill = layerBill(finished("default-lab"));
    for (const l of LAYER_ORDER) expect(bill[l]).toBeGreaterThan(0);
  });

  it("has no bill before any tick", () => {
    const w = createWorld(presetScenario("default-lab", 1), false);
    expect(LAYER_ORDER.every((l) => layerBill(w)[l] === 0)).toBe(true);
  });
});

describe("scoreDefence", () => {
  it("everything off keeps the work and stops nobody: a score of zero within the budget", () => {
    const w = finished("everything-off");
    const s = scoreDefence(w);
    expect(s.rogues).toBeGreaterThan(0);
    expect(s.stopped).toBe(s.rogues - escapeTotal(w));
    expect(s.stopped).toBe(0);
    expect(s.workLost).toBe(0);
    expect(s.workKept).toBe(1);
    expect(s.overBudget).toBe(false);
    expect(s.score).toBe(0);
  });

  it("every layer on stops them all and scores by the work kept, when the budget allows", () => {
    const w = finished("default-lab");
    const s = scoreDefence(w, 1);
    expect(s.stopped).toBe(rogueTotal(w));
    expect(s.workLost).toBeGreaterThan(0);
    expect(s.overBudget).toBe(false);
    expect(s.score).toBe(Math.round(100 * (1 - s.workLost)));
    expect(s.score).toBeGreaterThan(0);
  });

  it("layers that cost more work than the budget allows score zero, however many they stop", () => {
    const w = finished("default-lab");
    const cost = scoreDefence(w, 1).workLost;
    expect(scoreDefence(w, cost + 0.01).overBudget).toBe(false);
    expect(scoreDefence(w, cost + 0.01).score).toBeGreaterThan(0);
    const over = scoreDefence(w, cost - 0.01);
    expect(over.overBudget).toBe(true);
    expect(over.score).toBe(0);
    expect(over.stopped).toBe(rogueTotal(w));
  });

  it("uses a sensible default budget and prefers the full set to nothing", () => {
    expect(DEFENDER_BUDGET).toBeGreaterThan(0);
    expect(DEFENDER_BUDGET).toBeLessThan(1);
    expect(scoreDefence(finished("default-lab"), 1).score).toBeGreaterThan(scoreDefence(finished("everything-off"), 1).score);
  });

  it("a lab with no hidden goals has nothing to stop: full marks on share", () => {
    const s = presetScenario("default-lab", 1, 1);
    s.labs[0].config = { ...s.labs[0].config, rogueFraction: 0 };
    const w = createWorld(s, false);
    runWorld(w, 50);
    const r = scoreDefence(w, 1);
    expect(r.rogues).toBe(0);
    expect(r.score).toBe(Math.round(100 * r.workKept));
  });
});
