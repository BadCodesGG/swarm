import { describe, expect, it } from "vitest";
import { fork } from "../rng";
import { stoppingLayers } from "./replay";
import { createState, step } from "./sim";
import { runTrialsOffThread, stoppingLayersOffThread } from "./trials-client";
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
