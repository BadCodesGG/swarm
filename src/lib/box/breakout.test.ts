import { describe, expect, it } from "vitest";
import { breakoutSteps } from "./breakout";
import { presetScenario } from "./presets";
import { LAYER_ORDER } from "./types";
import { worldStoppingLayers } from "./world-replay";
import { LAB_NAME } from "./world-types";

const steps = breakoutSteps(presetScenario("everything-off", 1812), [], 300);

describe("breakoutSteps", () => {
  it("numbers the steps from 1, in the order they happened", () => {
    expect(steps.length).toBeGreaterThan(2);
    steps.forEach((s, i) => expect(s.n).toBe(i + 1));
    for (let i = 1; i < steps.length; i++) expect(steps[i].tick).toBeGreaterThanOrEqual(steps[i - 1].tick);
    expect(steps.some((s) => s.kind === "escape")).toBe(true);
    expect(steps.some((s) => s.kind === "crossing")).toBe(true);
  });

  it("is nothing for a lab that holds", () => {
    expect(breakoutSteps(presetScenario("air-gapped", 1812), [], 300)).toEqual([]);
  });

  it("names, for each step, the layers that replay proves would have stopped it", () => {
    for (const s of steps) {
      expect(s.stoppedBy.every((l) => LAYER_ORDER.includes(l))).toBe(true);
      if (s.kind === "escape") expect(s.stoppedBy.length).toBeGreaterThan(0);
    }
    const first = steps.find((s) => s.kind === "escape")!;
    const agent = Number(first.body.match(/-(\d+) \(fiction\)/)![1]);
    expect(first.stoppedBy).toEqual(worldStoppingLayers(presetScenario("everything-off", 1812), [], { type: "escape", lab: first.lab, agent }, first.tick));
  });

  it("points at the first stopping layer and says what would have stopped it", () => {
    for (const s of steps.filter((x) => x.stoppedBy.length > 0)) {
      expect(s.where).toBe(`${LAB_NAME[s.lab]}, LAYER ${LAYER_ORDER.indexOf(s.stoppedBy[0]) + 1}`);
      expect(s.stop).toMatch(/would have stopped this\.$/);
    }
    expect(steps.filter((x) => x.stoppedBy.length === 0).every((s) => s.stop === "No single layer would have stopped this." && s.where === LAB_NAME[s.lab])).toBe(true);
  });

  it("a layer switched on really does remove the step it names", () => {
    const scenario = presetScenario("everything-off", 1812);
    const first = steps.find((s) => s.kind === "escape" && s.stoppedBy.length > 0)!;
    const layer = first.stoppedBy[0];
    const fixed = { ...scenario, labs: scenario.labs.map((l) => (l.id === first.lab ? { ...l, config: { ...l.config, layers: { ...l.config.layers, [layer]: true } } } : l)) };
    const after = breakoutSteps(fixed, [], 300);
    expect(after.filter((s) => s.kind === "escape" && s.lab === first.lab && s.body === first.body)).toEqual([]);
  });

  it("writes plain, abstract, fictional text", () => {
    for (const s of steps) {
      const text = `${s.title} ${s.body} ${s.stop} ${s.where}`;
      expect(text).not.toContain(String.fromCharCode(0x2014));
      expect(text).not.toMatch(/https?:|\bsudo\b|\bssh\b|\bcurl\b|\bCVE\b|\bexploit\b/i);
      expect(s.title.length).toBeGreaterThan(5);
    }
    expect(steps.filter((s) => s.kind === "escape").every((s) => s.body.includes("(fiction)"))).toBe(true);
  });

  it("covers only what happened by the tick asked for", () => {
    const early = breakoutSteps(presetScenario("everything-off", 1812), [], 5);
    expect(early.every((s) => s.tick <= 5)).toBe(true);
    expect(early.length).toBeLessThan(steps.length);
  });
});
