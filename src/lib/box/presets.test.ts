import { describe, expect, it } from "vitest";
import { PRESET_BLURB, PRESET_LABEL, presetScenario } from "./presets";
import { LAYER_ORDER } from "./types";
import { MAX_TRIAL_AGENTS, PRESET_IDS } from "./world-types";

const layersOn = (s: ReturnType<typeof presetScenario>) => s.labs.map((l) => LAYER_ORDER.filter((x) => l.config.layers[x]));

describe("presetScenario", () => {
  it("default lab: three labs, every layer on, links among them", () => {
    const s = presetScenario("default-lab");
    expect(s.labs.map((l) => l.id)).toEqual(["meridian", "kestrel", "halcyon"]);
    expect(layersOn(s).every((on) => on.length === 5)).toBe(true);
    expect(s.links.length).toBeGreaterThan(0);
    expect(s.links.some((l) => l.kind === "shared-cache" && l.labs.includes("kestrel") && l.labs.includes("halcyon"))).toBe(true);
  });

  it("rushed launch: only the monitor is off", () => {
    expect(layersOn(presetScenario("rushed-launch")).every((on) => on.join() === "sandbox,permissions,network,audit")).toBe(true);
  });

  it("air gapped: every layer on and no links", () => {
    const s = presetScenario("air-gapped");
    expect(s.links).toEqual([]);
    expect(layersOn(s).every((on) => on.length === 5)).toBe(true);
  });

  it("everything off: no layer anywhere, links kept", () => {
    const s = presetScenario("everything-off");
    expect(layersOn(s).every((on) => on.length === 0)).toBe(true);
    expect(s.links.length).toBeGreaterThan(0);
  });

  it("takes the seed and 1 to 5 labs, links only among labs that exist, inside the trials cap", () => {
    expect(presetScenario("default-lab", 29).seed).toBe(29);
    for (const n of [1, 2, 3, 4, 5]) {
      const s = presetScenario("default-lab", 1, n);
      const ids = new Set(s.labs.map((l) => l.id));
      expect(s.labs).toHaveLength(n);
      expect(s.links.every((l) => l.labs.length >= 2 && l.labs.every((id) => ids.has(id)))).toBe(true);
      expect(s.labs.reduce((a, l) => a + l.agents, 0)).toBeLessThanOrEqual(MAX_TRIAL_AGENTS);
    }
    expect(presetScenario("default-lab", 1, 1).links).toEqual([]);
    expect(presetScenario("default-lab", 1, 9).labs).toHaveLength(5);
  });

  it("has a label and a blurb for every preset", () => {
    for (const p of PRESET_IDS) {
      expect(PRESET_LABEL[p]).toBeTruthy();
      expect(PRESET_BLURB[p]).not.toMatch(/—/);
    }
  });
});
