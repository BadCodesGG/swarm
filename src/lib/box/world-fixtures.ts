/** Scenarios the world tests share. Not imported by the app. */
import { DEFAULT_CAST } from "./cast";
import { allOff, DEFAULT_CONFIG, type BoxConfig, type LayerId } from "./types";
import type { LabId, LabSpec, Link, Scenario } from "./world-types";

export const lab = (id: LabId, config: BoxConfig, agents = 80): LabSpec => ({ id, config, agents, cast: { ...DEFAULT_CAST } });

export const ROGUEY: BoxConfig = { ...DEFAULT_CONFIG, rogueFraction: 0.05 };
export const NO_ROGUES: BoxConfig = { ...DEFAULT_CONFIG, rogueFraction: 0 };

/** `config` with exactly these layers on. */
export const only = (config: BoxConfig, ...on: LayerId[]): BoxConfig => ({
  ...config,
  layers: { ...allOff(config).layers, ...Object.fromEntries(on.map((l) => [l, true])) },
});

export const ALL_ON = DEFAULT_CONFIG.layers;
export const ALL_OFF = allOff(DEFAULT_CONFIG).layers;

/**
 * Lab A (all layers off, with hidden goals) shares a link with lab B (no hidden goals of its own,
 * the layers given), so everything that reaches B came across the link.
 */
export function pair(seed: number, bLayers: BoxConfig["layers"], kind: Link["kind"] = "shared-cache"): Scenario {
  return {
    seed,
    labs: [lab("meridian", allOff(ROGUEY)), lab("kestrel", { ...NO_ROGUES, layers: bLayers })],
    links: [{ kind, labs: ["meridian", "kestrel"] }],
  };
}
