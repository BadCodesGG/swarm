/**
 * Which switched-off layer would have kept something from happening in a world: proved by replaying
 * the world with that layer on, the same way `replay.ts` does for one box. The labs' sims and the
 * link pass take the same draws whatever any layer says, so a replay follows the live run exactly
 * until the layer intervenes.
 */

import { LAYER_ORDER, type LayerId } from "./types";
import { replayWorld, type World } from "./world";
import type { Flip, Scenario, StopTarget } from "./world-types";

function happened(world: World, target: StopTarget): boolean {
  return world.log.some((e) =>
    target.type === "escape"
      ? e.type === "escape" && e.lab === target.lab && e.agent === target.agent
      : e.type === "contact" && e.outcome === "crossed" && e.to === target.to && e.link === target.link && e.from.lab === target.from.lab && e.from.agent === target.from.agent,
  );
}

/** The layer states of lab `lab` at `tick`: the scenario's, then each flip up to it. */
function layersAt(scenario: Scenario, flips: readonly Flip[], lab: string, tick: number): Record<LayerId, boolean> {
  const spec = scenario.labs.find((l) => l.id === lab);
  if (!spec) throw new Error(`no lab ${lab} in this scenario`);
  const layers = { ...spec.config.layers };
  for (const f of flips) if (f.lab === lab && f.tick <= tick) layers[f.layer] = f.on;
  return layers;
}

/**
 * The layers, off at `tick` in the lab concerned (where the escape was, or the lab that was reached),
 * that turned on alone from the start would have prevented `target` by `tick`, innermost first. Empty
 * when the run does not reproduce the event or no single layer would have stopped it.
 */
export function worldStoppingLayers(scenario: Scenario, flips: readonly Flip[], target: StopTarget, tick: number): LayerId[] {
  if (!happened(replayWorld(scenario, flips, tick), target)) return [];
  const lab = target.type === "escape" ? target.lab : target.to;
  const at = layersAt(scenario, flips, lab, tick);
  return LAYER_ORDER.filter((layer) => {
    if (at[layer]) return false;
    const labs = scenario.labs.map((l) => (l.id === lab ? { ...l, config: { ...l.config, layers: { ...l.config.layers, [layer]: true } } } : l));
    const rest = flips.filter((f) => !(f.lab === lab && f.layer === layer));
    return !happened(replayWorld({ ...scenario, labs }, rest, tick), target);
  });
}
