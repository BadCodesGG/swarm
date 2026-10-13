/**
 * Which switched-off layer would have kept an escapee in: proved by replaying the run with that layer
 * on, not ranked by rule. A rule can say a layer applies to a step and still let it through (an ask
 * that wins its grant roll, say), so only the replay knows. `step` draws the same rolls per agent per
 * tick whatever the config, so the replay follows the live run exactly until the layer intervenes.
 */

import { fork } from "../rng";
import { createState, STATUS, step } from "./sim";
import { LAYER_ORDER, type BoxConfig, type LayerId } from "./types";

/** The live run's decision stream (`simRng` in `engine/box/params`), replayed from tick 0 with the live crowd. */
function escapedBy(config: BoxConfig, seed: number, agentCount: number, agent: number, tick: number): boolean {
  const state = createState(config, seed, agentCount, false);
  const r = fork(seed, 1);
  while (state.tick < tick && state.status[agent] !== STATUS.escaped) step(state, r);
  return state.status[agent] === STATUS.escaped;
}

/**
 * The switched-off layers that, turned on alone, keep `agent` from escaping by `tick`, innermost
 * first. The crowd size must be the live run's: a different size renumbers the agents. Empty when no
 * single layer would have, and empty when `config` alone from tick 0 does not reproduce the escape
 * (a layer switched on mid-run): then no off layer can be credited with stopping it.
 */
export function stoppingLayers(config: BoxConfig, seed: number, agentCount: number, agent: number, tick: number): LayerId[] {
  if (!escapedBy(config, seed, agentCount, agent, tick)) return [];
  return LAYER_ORDER.filter((layer) => !config.layers[layer] && !escapedBy({ ...config, layers: { ...config.layers, [layer]: true } }, seed, agentCount, agent, tick));
}
