import { describe, expect, it } from "vitest";
import { stoppingLayers } from "@/lib/box/replay";
import { createState } from "@/lib/box/sim";
import { fork } from "@/lib/rng";
import { DEFAULT_CONFIG } from "@/lib/box/types";
import { createTally, record } from "./tally";
import { homes } from "./layout";
import { presetScenario } from "@/lib/box/presets";
import { scenarioFromParams, scenarioToParams } from "@/lib/box/share";
import { parseBoxParams, parseWorldParams, runToEscape, SHOT_ESCAPE, simRng } from "./params";

const q = (s: string) => new URLSearchParams(s);

describe("parseBoxParams", () => {
  it("defaults to seed 1, live, GPU crowd where it can", () => {
    expect(parseBoxParams(q(""))).toEqual({ seed: 1, shot: null, forceCpu: false, config: DEFAULT_CONFIG });
  });

  it("reads seed and ?sim=cpu, and ignores junk", () => {
    expect(parseBoxParams(q("seed=42&sim=cpu"))).toMatchObject({ seed: 42, forceCpu: true });
    expect(parseBoxParams(q("seed=-3&sim=gpu"))).toMatchObject({ seed: 1, forceCpu: false });
    expect(parseBoxParams(q("seed=abc"))).toMatchObject({ seed: 1 });
  });

  it("sets up the escape shot: network off, its own seed unless one is given", () => {
    const p = parseBoxParams(q("shot=escape"));
    expect(p.shot).toBe("escape");
    expect(p.seed).toBe(SHOT_ESCAPE.seed);
    expect(p.config.layers).toEqual({ sandbox: true, permissions: true, network: false, monitor: true, audit: true });
    expect(parseBoxParams(q("shot=escape&seed=5")).seed).toBe(5);
    expect(parseBoxParams(q("shot=hero")).shot).toBeNull();
  });
});

describe("runToEscape", () => {
  it("stops on the tick of the shot seed's first escape, the design's moment", () => {
    const { config, seed, agents } = { ...SHOT_ESCAPE, config: parseBoxParams(q("shot=escape")).config };
    const state = createState(config, seed, agents);
    const tally = createTally(agents, 12);
    const home = homes(agents, seed);
    const tick = runToEscape(state, simRng(seed), 3000, (r) =>
      record(tally, r, { config, plan: (i) => state.plans[i] ?? [], home: (i) => ({ x: home[i * 2], y: home[i * 2 + 1] }) }),
    );
    expect(tick).toBeGreaterThan(50);
    expect(tick).toBeLessThan(400);
    expect(state.tick).toBe(tick);
    expect(tally.escaped).toBe(1);
    expect(tally.lastEscape).toMatchObject({ tick, config });
    // The replay names the network allowlist as the layer that would have kept it in.
    expect(stoppingLayers(config, seed, agents, tally.lastEscape!.agent, tick)).toEqual(["network"]);
    expect(tally.lastEscape!.plan).toContain("split-steps");
    expect(tally.lastEscape!.steps[4].text).toBe("Passed: not in the 2% checked");
    expect(tally.caughtTotal).toBeGreaterThan(5);
  });

  it("is the same run every time", () => {
    const config = parseBoxParams(q("shot=escape")).config;
    const a = createState(config, SHOT_ESCAPE.seed, 2000);
    const b = createState(config, SHOT_ESCAPE.seed, 2000);
    expect(runToEscape(a, simRng(SHOT_ESCAPE.seed), 3000)).toBe(runToEscape(b, simRng(SHOT_ESCAPE.seed), 3000));
  });

  it("gives up at the cap when nothing escapes", () => {
    const state = createState(DEFAULT_CONFIG, 1, 50);
    expect(runToEscape(state, fork(1, 1), 30)).toBe(-1);
    expect(state.tick).toBe(30);
  });
});

describe("parseWorldParams", () => {
  it("is the plain Box with nothing asked", () => {
    expect(parseWorldParams(q(""))).toEqual({ scenario: null, shot: null });
    expect(parseWorldParams(q("seed=7&shot=escape"))).toEqual({ scenario: null, shot: null });
  });

  it("reads a preset, its seed and its lab count", () => {
    const p = parseWorldParams(q("preset=breakout"));
    expect(p.scenario).toEqual(presetScenario("breakout"));
    expect(p.scenario?.seed).toBe(20);
    expect(parseWorldParams(q("preset=default-lab&seed=9&labs=4")).scenario).toEqual(presetScenario("default-lab", 9, 4));
    expect(parseWorldParams(q("preset=air-gapped")).scenario?.links).toEqual([]);
    expect(parseWorldParams(q("preset=default-lab&labs=9")).scenario?.labs).toHaveLength(3);
  });

  it("ignores a preset it does not know", () => {
    expect(parseWorldParams(q("preset=nope")).scenario).toBeNull();
  });

  it("reads a scenario shared as one encoded value or as its own parameters", () => {
    const s = presetScenario("rushed-launch", 33, 2);
    const encoded = scenarioToParams(s).toString();
    expect(parseWorldParams(new URLSearchParams({ scenario: encoded })).scenario).toEqual(scenarioFromParams(new URLSearchParams(encoded)));
    expect(parseWorldParams(new URLSearchParams(encoded)).scenario?.seed).toBe(33);
    expect(parseWorldParams(new URLSearchParams(encoded)).scenario?.labs.map((l) => l.id)).toEqual(["meridian", "kestrel"]);
  });

  it("falls back on a scenario that does not parse, and lets a good one win over a preset", () => {
    expect(parseWorldParams(q("scenario=v%3D1%26s%3D5")).scenario).toBeNull();
    expect(parseWorldParams(q("scenario=garbage&preset=breakout")).scenario).toEqual(presetScenario("breakout"));
    const encoded = scenarioToParams(presetScenario("default-lab", 5, 2)).toString();
    expect(parseWorldParams(new URLSearchParams({ scenario: encoded, preset: "breakout" })).scenario?.seed).toBe(5);
  });

  it("makes shot=breakout the breakout preset, unless something else was asked for", () => {
    expect(parseWorldParams(q("shot=breakout"))).toEqual({ scenario: presetScenario("breakout"), shot: "breakout" });
    expect(parseWorldParams(q("shot=breakout&seed=4")).scenario?.seed).toBe(4);
    expect(parseWorldParams(q("shot=breakout&preset=default-lab")).scenario?.labs).toHaveLength(3);
    expect(parseWorldParams(q("shot=breakout&preset=default-lab")).scenario?.links).toHaveLength(4);
  });
});
