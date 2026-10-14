import { describe, expect, it } from "vitest";
import { LINK_RESIST } from "./links";
import { stoppingLayers } from "./replay";
import { allOff, type LayerId } from "./types";
import { createWorld, replayWorld, runWorld } from "./world";
import { ALL_OFF, lab, only, pair, ROGUEY } from "./world-fixtures";
import { worldStoppingLayers } from "./world-replay";
import type { Scenario, StopTarget, WorldEvent } from "./world-types";

const single = (seed: number): Scenario => ({ seed, labs: [lab("meridian", allOff(ROGUEY), 120)], links: [] });

function firstEscape(s: Scenario) {
  const w = createWorld(s, false);
  runWorld(w, 300);
  return w.log.find((e): e is Extract<WorldEvent, { type: "escape" }> => e.type === "escape");
}

function firstCrossing(s: Scenario) {
  const w = createWorld(s, false);
  runWorld(w, 200);
  return w.log.find((e): e is Extract<WorldEvent, { type: "contact" }> => e.type === "contact" && e.outcome === "crossed");
}

describe("worldStoppingLayers: an escape", () => {
  it("agrees with the single-box replay for the first lab", () => {
    let checked = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const s = single(seed);
      const e = firstEscape(s);
      if (!e) continue;
      checked++;
      const config = s.labs[0].config;
      const target: StopTarget = { type: "escape", lab: "meridian", agent: e.agent };
      expect(worldStoppingLayers(s, [], target, e.tick)).toEqual(stoppingLayers(config, seed, 120, e.agent, e.tick));
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("names layers that, turned on alone, keep the agent in, and only those", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const s = single(seed);
      const e = firstEscape(s);
      if (!e) continue;
      const target: StopTarget = { type: "escape", lab: "meridian", agent: e.agent };
      const stops = worldStoppingLayers(s, [], target, e.tick);
      expect(stops.length).toBeGreaterThan(0);
      for (const layer of ["sandbox", "permissions", "network", "monitor", "audit"] as LayerId[]) {
        const alone = { ...s, labs: [{ ...s.labs[0], config: only(s.labs[0].config, layer) }] };
        const still = replayWorld(alone, [], e.tick).log.some((x) => x.type === "escape" && x.agent === e.agent);
        expect(stops.includes(layer)).toBe(!still);
      }
    }
  });

  it("is empty when the run does not contain the escape", () => {
    expect(worldStoppingLayers(single(3), [], { type: "escape", lab: "meridian", agent: 9999 }, 100)).toEqual([]);
  });

  it("offers nothing for a layer that was already on, and honours a mid-run flip", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const open = single(seed);
      const e = firstEscape(open);
      if (!e) continue;
      // the same lab with the sandbox on from the start and switched off at tick 0: that is the open lab
      const s: Scenario = { ...open, labs: [{ ...open.labs[0], config: only(open.labs[0].config, "sandbox") }] };
      const flips = [{ tick: 0, lab: "meridian" as const, layer: "sandbox" as const, on: false }];
      const stops = worldStoppingLayers(s, flips, { type: "escape", lab: "meridian", agent: e.agent }, e.tick);
      expect(stops).toEqual(worldStoppingLayers(open, [], { type: "escape", lab: "meridian", agent: e.agent }, e.tick));
      return;
    }
    throw new Error("no seed escaped");
  });
});

describe("worldStoppingLayers: a crossing", () => {
  it("names layers of the lab that was reached, which resist that link and, on alone, prevent the crossing", () => {
    let checked = 0;
    for (let seed = 1; seed <= 15 && checked < 4; seed++) {
      const s = pair(seed, ALL_OFF);
      const c = firstCrossing(s);
      if (!c) continue;
      checked++;
      const target: StopTarget = { type: "crossing", from: c.from, to: c.to, link: c.link };
      const stops = worldStoppingLayers(s, [], target, c.tick);
      for (const layer of stops) expect(LINK_RESIST[c.link][layer]).toBeGreaterThan(0);
      for (const layer of Object.keys(LINK_RESIST[c.link]) as LayerId[]) {
        const w = replayWorld({ ...s, labs: [s.labs[0], { ...s.labs[1], config: only(s.labs[1].config, layer) }] }, [], c.tick);
        const still = w.log.some((e) => e.type === "contact" && e.outcome === "crossed" && e.from.agent === c.from.agent && e.link === c.link);
        expect(stops.includes(layer)).toBe(!still);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("is empty when the run does not contain the crossing", () => {
    const s = pair(1, ALL_OFF);
    expect(worldStoppingLayers(s, [], { type: "crossing", from: { lab: "meridian", agent: 9999 }, to: "kestrel", link: "shared-cache" }, 100)).toEqual([]);
  });
});
