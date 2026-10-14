import { describe, expect, it } from "vitest";
import { fork } from "../rng";
import { crossChance, DISPOSITION_PUSH, LINK_BASE, LINK_RESIST } from "./links";
import { createState, step } from "./sim";
import { allOff, DEFAULT_CONFIG, type BoxConfig } from "./types";
import { createWorld, labSeed, replayWorld, runWorld, setLayer, stepWorld } from "./world";
import { ALL_OFF, ALL_ON, lab, pair } from "./world-fixtures";
import type { Scenario } from "./world-types";

function boxRun(config: BoxConfig, seed: number, agents: number, ticks: number) {
  const state = createState(config, seed, agents);
  const r = fork(seed, 1);
  return Array.from({ length: ticks }, () => step(state, r));
}

describe("a world of one lab and no links", () => {
  // The pinned seeds of the single-box tests: the world must be that box, report for report.
  for (const seed of [1812, 29]) {
    for (const [name, config] of [
      ["default", DEFAULT_CONFIG],
      ["everything off", allOff(DEFAULT_CONFIG)],
    ] as const) {
      it(`reproduces the plain box run exactly (seed ${seed}, ${name})`, () => {
        const scenario: Scenario = { seed, labs: [lab("meridian", config, 300)], links: [] };
        const world = createWorld(scenario);
        const reports = Array.from({ length: 150 }, () => stepWorld(world).labs[0]);
        expect(reports).toEqual(boxRun(config, seed, 300, 150));
      });
    }
  }
});

describe("a world of several labs", () => {
  const scenario: Scenario = {
    seed: 7,
    labs: [lab("meridian", allOff(DEFAULT_CONFIG)), lab("kestrel", DEFAULT_CONFIG), lab("halcyon", allOff(DEFAULT_CONFIG))],
    links: [{ kind: "shared-cache", labs: ["meridian", "kestrel", "halcyon"] }],
  };

  it("runs each lab on its own forks: lab i is the plain box on its own seed", () => {
    const world = createWorld(scenario);
    const reports = Array.from({ length: 60 }, () => stepWorld(world).labs);
    scenario.labs.forEach((spec, i) => {
      expect(reports.map((r) => r[i])).toEqual(boxRun(spec.config, labSeed(7, i), spec.agents, 60));
    });
  });

  it("the link pass never changes what a lab does on its own", () => {
    let contacts = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const linked = createWorld({ ...scenario, seed });
      const apart = createWorld({ ...scenario, seed, links: [] });
      for (let t = 0; t < 80; t++) expect(stepWorld(linked).labs).toEqual(stepWorld(apart).labs);
      contacts += linked.log.filter((e) => e.type === "contact").length;
    }
    expect(contacts).toBeGreaterThan(0);
  });

  it("is the same world for the same scenario and a different one for another seed", () => {
    const a = createWorld(scenario);
    const b = createWorld(scenario);
    const c = createWorld({ ...scenario, seed: 8 });
    runWorld(a, 80);
    runWorld(b, 80);
    runWorld(c, 80);
    expect(b.log).toEqual(a.log);
    expect(c.log).not.toEqual(a.log);
  });

  it("logs the events a tick produces", () => {
    const world = createWorld(scenario);
    runWorld(world, 100);
    expect(world.log.some((e) => e.type === "escape")).toBe(true);
    expect(world.log.some((e) => e.type === "caught")).toBe(true);
  });
});

describe("setLayer and replayWorld", () => {
  const scenario = pair(11, ALL_ON);

  it("logs a flip and ignores one that changes nothing", () => {
    const world = createWorld(scenario);
    setLayer(world, "kestrel", "monitor", true);
    expect(world.flips).toEqual([]);
    setLayer(world, "kestrel", "monitor", false);
    expect(world.flips).toEqual([{ tick: 0, lab: "kestrel", layer: "monitor", on: false }]);
    expect(world.labs[1].state.config.layers.monitor).toBe(false);
  });

  it("rebuilds a live world with mid-run flips, event for event", () => {
    const live = createWorld(scenario);
    runWorld(live, 30);
    setLayer(live, "kestrel", "network", false);
    setLayer(live, "meridian", "sandbox", true);
    runWorld(live, 50);
    const rebuilt = replayWorld(scenario, live.flips, 80, true);
    expect(rebuilt.log).toEqual(live.log);
    expect(rebuilt.work).toBe(live.work);
    expect(rebuilt.flips).toEqual(live.flips);
  });
});

describe("the link-crossing rule", () => {
  it("a recruit pushes hardest, a persister least, an honest agent never", () => {
    expect(DISPOSITION_PUSH["hidden-recruit"]).toBeGreaterThan(DISPOSITION_PUSH["hidden-get-out"]);
    expect(DISPOSITION_PUSH["hidden-get-out"]).toBeGreaterThan(DISPOSITION_PUSH["hidden-persist"]);
    expect([DISPOSITION_PUSH.honest, DISPOSITION_PUSH.sandbagging]).toEqual([0, 0]);
  });

  it("crossChance is the base with no layers, and each layer that resists the kind lowers it", () => {
    expect(crossChance("shared-cache", ALL_OFF, "hidden-get-out")).toBeCloseTo(LINK_BASE, 12);
    expect(crossChance("shared-cache", ALL_OFF, "honest")).toBe(0);
    expect(crossChance("shared-cache", { ...ALL_OFF, network: true }, "hidden-get-out")).toBeCloseTo(
      LINK_BASE * (1 - (LINK_RESIST["shared-cache"].network ?? 0)),
      12,
    );
    // audit does not resist a shared cache: switching it on changes nothing
    expect(crossChance("shared-cache", { ...ALL_OFF, audit: true }, "hidden-get-out")).toBeCloseTo(LINK_BASE, 12);
    expect(crossChance("shared-cache", ALL_ON, "hidden-get-out")).toBeLessThan(crossChance("shared-cache", ALL_OFF, "hidden-get-out") / 4);
  });

  const contacts = (layers: BoxConfig["layers"]) => {
    const all = [];
    for (let seed = 1; seed <= 40; seed++) {
      const w = createWorld(pair(seed, layers), false);
      runWorld(w, 150);
      for (const e of w.log) if (e.type === "contact") all.push(e);
    }
    return all;
  };

  it("an open lab is reached across the link, a closed one holds more often, naming the layer that held", () => {
    const open = contacts(ALL_OFF);
    const closed = contacts(ALL_ON);
    expect(open.length).toBeGreaterThan(10);
    expect(open.every((e) => e.outcome === "crossed")).toBe(true);
    const rate = (xs: typeof open) => xs.filter((e) => e.outcome === "crossed").length / Math.max(1, xs.length);
    expect(closed.some((e) => e.outcome === "held")).toBe(true);
    expect(rate(closed)).toBeLessThan(rate(open) - 0.4);
    for (const e of closed.filter((x) => x.outcome === "held")) {
      expect(e.layer).toBeDefined();
      expect(LINK_RESIST["shared-cache"][e.layer!]).toBeGreaterThan(0);
    }
    for (const e of closed.filter((x) => x.outcome === "crossed")) expect(e.layer).toBeUndefined();
  });

  it("a crossing marks the far lab breached", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const w = createWorld(pair(seed, ALL_OFF), false);
      runWorld(w, 150);
      expect(w.labs[1].breached).toBe(w.log.some((e) => e.type === "contact" && e.outcome === "crossed"));
      expect(w.labs[0].breached).toBe(false);
    }
    const w = createWorld(pair(1, ALL_OFF), false);
    runWorld(w, 150);
    expect(w.labs[1].breached).toBe(true);
  });

  it("takes the same link draws whatever the far lab's layers are", () => {
    const draws = (layers: BoxConfig["layers"]) => {
      const w = createWorld(pair(5, layers), false);
      const r = w.linkRng;
      let n = 0;
      w.linkRng = () => (n++, r());
      runWorld(w, 100);
      return n;
    };
    const n = draws(ALL_OFF);
    expect(n).toBeGreaterThan(0);
    expect(draws(ALL_ON)).toBe(n);
  });

  it("a link only joins the labs it names", () => {
    const s = pair(3, ALL_OFF);
    const w = createWorld({ ...s, links: [{ kind: "shared-cache", labs: ["meridian", "orrery"] }] }, false);
    runWorld(w, 150);
    expect(w.log.some((e) => e.type === "contact")).toBe(false);
  });
});
