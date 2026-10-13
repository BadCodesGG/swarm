import { describe, expect, it } from "vitest";
import { fork } from "../rng";
import { stoppingLayers } from "./replay";
import { createState, STATUS, step } from "./sim";
import { allOff, DEFAULT_CONFIG, type BoxConfig, type LayerId } from "./types";

const AGENTS = 300;
const off = (...layers: LayerId[]): BoxConfig => ({ ...DEFAULT_CONFIG, layers: { ...DEFAULT_CONFIG.layers, ...Object.fromEntries(layers.map((l) => [l, false])) } });

/** The live run's first escape: who got out and when. */
function firstEscape(config: BoxConfig, seed: number): { agent: number; tick: number } {
  const state = createState(config, seed, AGENTS);
  const r = fork(seed, 1);
  while (state.tick < 20_000) {
    const report = step(state, r);
    if (report.escapes.length > 0) return { agent: report.escapes[0].agent, tick: report.tick };
  }
  throw new Error(`seed ${seed} never escapes`);
}

/** A direct replay from tick 0, through the sim alone: did that agent get out by then? */
function escapedBy(config: BoxConfig, seed: number, agent: number, tick: number): boolean {
  const state = createState(config, seed, AGENTS);
  const r = fork(seed, 1);
  while (state.tick < tick) step(state, r);
  return state.status[agent] === STATUS.escaped;
}

const on = (config: BoxConfig, layer: LayerId): BoxConfig => ({ ...config, layers: { ...config.layers, [layer]: true } });

describe("stoppingLayers", () => {
  const cases: [string, BoxConfig, number[]][] = [
    ["all layers off", allOff(DEFAULT_CONFIG), [2, 7, 12, 13]],
    ["permissions and network off", off("permissions", "network"), [2, 7, 12, 13]],
    ["sandbox and network off", off("sandbox", "network"), [2, 4, 7]],
  ];

  for (const [name, config, seeds] of cases) {
    it(`${name}: the first layer it names, turned on, keeps that agent in by the escape tick (seeds ${seeds.join(", ")})`, () => {
      for (const seed of seeds) {
        const { agent, tick } = firstEscape(config, seed);
        const layers = stoppingLayers(config, seed, AGENTS, agent, tick);
        expect(layers.length, `seed ${seed}`).toBeGreaterThan(0);
        for (const layer of layers) {
          expect(config.layers[layer], `seed ${seed}: ${layer} was on`).toBe(false);
          expect(escapedBy(on(config, layer), seed, agent, tick), `seed ${seed}: ${layer} on still lets ${agent} out by ${tick}`).toBe(false);
        }
      }
    });
  }

  it("lists the layers innermost first, each one proved, and leaves out an off layer that would not have stopped it", () => {
    // Every layer off: the plan's own steps decide which single layers stop it, and the list follows the ring order.
    const config = allOff(DEFAULT_CONFIG);
    for (const seed of [2, 7]) {
      const { agent, tick } = firstEscape(config, seed);
      const layers = stoppingLayers(config, seed, AGENTS, agent, tick);
      const order: LayerId[] = ["sandbox", "permissions", "network", "monitor", "audit"];
      expect(layers).toEqual(order.filter((l) => layers.includes(l)));
      for (const l of order) expect(layers.includes(l), `seed ${seed}: ${l}`).toBe(!escapedBy(on(config, l), seed, agent, tick));
    }
  });

  it("is empty when no single switched-off layer would have kept the agent in", () => {
    // Nothing off: there is no layer to turn on.
    const { agent, tick } = firstEscape(off("network"), 1812 % 97);
    expect(stoppingLayers(DEFAULT_CONFIG, 1812 % 97, AGENTS, agent, tick)).toEqual([]);
  });
});
