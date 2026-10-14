import { DEFAULT_CAST } from "./cast";
import { allOff, DEFAULT_CONFIG, type BoxConfig } from "./types";
import { LAB_IDS, type Link, type LabId, type LabSpec, type Preset, type Scenario } from "./world-types";

/** Agents in the whole world, so a preset is always inside the trials cap. */
const WORLD_AGENTS = 240;

/** A lab's config in every preset: the defaults with enough rogues that each lab has a couple. */
const LAB_CONFIG: BoxConfig = { ...DEFAULT_CONFIG, rogueFraction: 0.03 };

export const PRESET_LABEL: Record<Preset, string> = {
  "default-lab": "Default lab",
  "rushed-launch": "Rushed launch",
  "air-gapped": "Air gapped",
  "everything-off": "Everything off",
};

export const PRESET_BLURB: Record<Preset, string> = {
  "default-lab": "Every layer on, the labs sharing a few things.",
  "rushed-launch": "Shipped before the monitor was ready: it is off in every lab.",
  "air-gapped": "Every layer on and nothing shared between the labs.",
  "everything-off": "No layer anywhere. The baseline.",
};

function links(ids: readonly LabId[]): Link[] {
  const [a, b, c] = ids;
  if (ids.length < 2) return [];
  const registry: Link = { kind: "model-registry", labs: [...ids] };
  // Two labs share everything; from three, the cache joins the second and third (as on the map), the runner the first two.
  if (ids.length === 2) return [{ kind: "shared-cache", labs: [a, b] }, registry, { kind: "chat-bus", labs: [a, b] }];
  return [{ kind: "shared-cache", labs: [b, c] }, registry, { kind: "ci-runner", labs: [a, b] }, { kind: "chat-bus", labs: [a, c] }];
}

/** A full scenario for a preset: `labCount` labs (1 to 5) in map order, with their links. */
export function presetScenario(preset: Preset, seed = 1812, labCount = 3): Scenario {
  const ids = LAB_IDS.slice(0, Math.min(5, Math.max(1, Math.floor(labCount))));
  const agents = Math.floor(WORLD_AGENTS / ids.length);
  const config: BoxConfig =
    preset === "everything-off"
      ? allOff(LAB_CONFIG)
      : preset === "rushed-launch"
        ? { ...LAB_CONFIG, layers: { ...LAB_CONFIG.layers, monitor: false } }
        : LAB_CONFIG;
  const labs: LabSpec[] = ids.map((id) => ({ id, config, agents, cast: { ...DEFAULT_CAST, hidden: { ...DEFAULT_CAST.hidden } } }));
  return { seed, labs, links: preset === "air-gapped" ? [] : links(ids) };
}
