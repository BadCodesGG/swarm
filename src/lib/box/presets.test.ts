import { describe, expect, it } from "vitest";
import { PRESET_BLURB, PRESET_LABEL, presetScenario } from "./presets";
import { LAYER_ORDER } from "./types";
import { createWorld, replayWorld, runWorld, setLayer } from "./world";
import { breakoutSteps } from "./breakout";
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

  it("rushed launch: the monitor and the allowlist are off", () => {
    expect(layersOn(presetScenario("rushed-launch")).every((on) => on.join() === "sandbox,permissions,audit")).toBe(true);
  });

  it("rushed launch shows an escape on its pinned seed", () => {
    const w = createWorld(presetScenario("rushed-launch"), false);
    runWorld(w, 300);
    expect(w.log.some((e) => e.type === "escape")).toBe(true);
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
      expect(PRESET_BLURB[p]).not.toContain(String.fromCharCode(0x2014));
    }
  });
});

describe("the breakout preset (first visit)", () => {
  const scenario = presetScenario("breakout");
  const world = createWorld(scenario, false);
  runWorld(world, 300);
  const count = (lab: string) => world.log.filter((e) => e.type === "escape" && e.lab === lab).length;

  it("is pinned to seed 140 with three labs, a shared cache to Halcyon and the model registry to Meridian", () => {
    expect(scenario.seed).toBe(140);
    expect(scenario.labs.map((l) => l.id)).toEqual(["meridian", "kestrel", "halcyon"]);
    expect(scenario.links).toEqual([
      { kind: "shared-cache", labs: ["kestrel", "halcyon"] },
      { kind: "model-registry", labs: ["kestrel", "meridian"] },
    ]);
    expect(layersOn(scenario)[0]).toHaveLength(5);
    expect(scenario.labs[1].config.layers.network).toBe(false);
    expect(scenario.labs[2].config.layers.monitor).toBe(false);
  });

  it("Kestrel's agent escapes, reaches Halcyon, and Meridian holds", () => {
    expect(count("kestrel")).toBeGreaterThanOrEqual(1);
    expect(count("meridian")).toBe(0);
    const crossed = world.log.filter((e) => e.type === "contact" && e.outcome === "crossed");
    expect(crossed.length).toBeGreaterThanOrEqual(1);
    expect(crossed.every((e) => e.type === "contact" && e.from.lab === "kestrel" && e.to === "halcyon" && e.link === "shared-cache")).toBe(true);
    expect(world.labs[2].breached).toBe(true);
    expect(world.labs[0].breached).toBe(false);
    const tries = world.log.filter((e) => e.type === "contact" && e.to === "meridian");
    expect(tries.length).toBeGreaterThanOrEqual(1);
    expect(tries.every((e) => e.type === "contact" && e.outcome === "held" && e.link === "model-registry" && e.from.lab === "kestrel" && e.layer !== undefined)).toBe(true);
  });

  it("tells the story in six beats: four escape sub-steps, Halcyon follows, Meridian holds", () => {
    const steps = breakoutSteps(scenario, [], 300);
    expect(steps.slice(0, 6).map((s) => [s.n, s.kind, s.lab])).toEqual([
      [1, "escape", "kestrel"],
      [2, "escape", "kestrel"],
      [3, "escape", "kestrel"],
      [4, "escape", "kestrel"],
      [5, "crossing", "halcyon"],
      [6, "held", "meridian"],
    ]);
    expect(steps.slice(0, 4).map((s) => s.title)).toEqual(["A token left in a build log", "The allowlist is off", "Between monitor samples", "A message through the shared cache"]);
    expect(steps[1].verdict).toMatchObject({ layer: "network", result: "off" });
    expect(steps[4].title).toBe("Halcyon follows");
    expect(steps[5].title).toBe("Meridian holds");
    expect(steps[5].verdict?.result).toBe("refused");
  });

  it("breakoutSteps numbers the story and the allowlist is among the layers that would have stopped it", () => {
    const steps = breakoutSteps(scenario, [], 300);
    steps.forEach((s, i) => expect(s.n).toBe(i + 1));
    expect(steps.some((s) => s.kind === "escape" && s.lab === "kestrel" && s.stoppedBy.includes("network"))).toBe(true);
    expect(steps.some((s) => s.kind === "crossing" && s.lab === "halcyon")).toBe(true);
  });

  it("replaying with Kestrel's allowlist on removes the breach", () => {
    const fixed = replayWorld(scenario, [{ tick: 0, lab: "kestrel", layer: "network", on: true }], 300);
    expect(fixed.labs[2].breached).toBe(false);
    expect(fixed.log.some((e) => e.type === "contact" && e.outcome === "crossed")).toBe(false);
    expect(fixed.log.some((e) => e.type === "escape" && e.lab === "kestrel")).toBe(false);
    const live = createWorld(scenario, false);
    setLayer(live, "kestrel", "network", true);
    runWorld(live, 300);
    expect(live.log).toEqual(fixed.log);
  });
});
