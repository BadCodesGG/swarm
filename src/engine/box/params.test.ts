import { describe, expect, it } from "vitest";
import { stoppingLayers } from "@/lib/box/replay";
import { createState } from "@/lib/box/sim";
import { fork } from "@/lib/rng";
import { DEFAULT_CONFIG } from "@/lib/box/types";
import { createTally, record } from "./tally";
import { homes } from "./layout";
import { parseBoxParams, runToEscape, SHOT_ESCAPE, simRng } from "./params";

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
