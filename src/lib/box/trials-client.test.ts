import { describe, expect, it } from "vitest";
import { fork } from "../rng";
import { stoppingLayers } from "./replay";
import { createState, step } from "./sim";
import { presetScenario } from "./presets";
import { runTrialsOffThread, runWorldTrialsOffThread, stoppingLayersOffThread, worldStoppingLayersOffThread } from "./trials-client";
import { createWorld, runWorld } from "./world";
import { worldStoppingLayers } from "./world-replay";
import { runWorldTrials } from "./world-trials";
import { runTrials } from "./trials";
import { allOff, DEFAULT_CONFIG } from "./types";

// Node has no Worker, so both calls take the inline path: the same answer as the direct function.
describe("the trials worker's client, without a worker", () => {
  it("runs the trials inline", async () => {
    expect(await runTrialsOffThread(DEFAULT_CONFIG, 5, 3)).toEqual(runTrials(DEFAULT_CONFIG, 5, 3));
  });

  it("finds the layers that would have stopped an escape inline", async () => {
    const config = allOff(DEFAULT_CONFIG);
    const state = createState(config, 2, 300);
    const r = fork(2, 1);
    let escape = { agent: -1, tick: -1 };
    while (escape.agent < 0) {
      const report = step(state, r);
      if (report.escapes.length > 0) escape = { agent: report.escapes[0].agent, tick: report.tick };
    }
    const layers = await stoppingLayersOffThread(config, 2, 300, escape.agent, escape.tick);
    expect(layers.length).toBeGreaterThan(0);
    expect(layers).toEqual(stoppingLayers(config, 2, 300, escape.agent, escape.tick));
  });
});

describe("the world jobs, without a worker", () => {
  const scenario = presetScenario("everything-off", 1812);

  it("runs world trials inline", async () => {
    expect(await runWorldTrialsOffThread(scenario, 4, 3)).toEqual(runWorldTrials(scenario, 4, 3));
  });

  it("finds the layers that would have stopped an escape in a world inline", async () => {
    const world = createWorld(scenario, false);
    runWorld(world, 300);
    const e = world.log.find((x) => x.type === "escape")!;
    if (e.type !== "escape") throw new Error("no escape");
    const target = { type: "escape", lab: e.lab, agent: e.agent } as const;
    const layers = await worldStoppingLayersOffThread(scenario, [], target, e.tick);
    expect(layers.length).toBeGreaterThan(0);
    expect(layers).toEqual(worldStoppingLayers(scenario, [], target, e.tick));
  });
});
