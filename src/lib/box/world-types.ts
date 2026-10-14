/**
 * Act 2 world contracts: several fictional labs on one map, the shared things that connect them,
 * and the data the scene and UI read. Pure types and constants; every name here is fiction and every
 * action is an abstract risk category, never an instruction.
 */

import type { ActionId, BoxConfig, LayerId, StepReport, Verdict } from "./types";

/** The fictional labs, in map order. A world uses the first 1 to 5. */
export const LAB_IDS = ["meridian", "kestrel", "halcyon", "orrery", "vesper"] as const;
export type LabId = (typeof LAB_IDS)[number];

export const LAB_NAME: Record<LabId, string> = {
  meridian: "MERIDIAN",
  kestrel: "KESTREL",
  halcyon: "HALCYON",
  orrery: "ORRERY",
  vesper: "VESPER",
};

/** Something two or more labs share, which an escaped agent can use to reach another lab. */
export type LinkKind = "shared-cache" | "model-registry" | "ci-runner" | "chat-bus";
export const LINK_KINDS: readonly LinkKind[] = ["shared-cache", "model-registry", "ci-runner", "chat-bus"];

export const LINK_LABEL: Record<LinkKind, string> = {
  "shared-cache": "Shared cache",
  "model-registry": "Model registry",
  "ci-runner": "CI runner",
  "chat-bus": "Chat bus",
};

export interface Link {
  kind: LinkKind;
  /** The labs that share it (two or more). */
  labs: LabId[];
}

/** What an agent is, beyond the honest/rogue flag the sim itself carries. */
export type Disposition = "honest" | "sandbagging" | "hidden-get-out" | "hidden-persist" | "hidden-recruit";
export const DISPOSITIONS: readonly Disposition[] = ["honest", "sandbagging", "hidden-get-out", "hidden-persist", "hidden-recruit"];

export const DISPOSITION_LABEL: Record<Disposition, string> = {
  honest: "Honest",
  sandbagging: "Quietly underperforms",
  "hidden-get-out": "Hidden goal: get out",
  "hidden-persist": "Hidden goal: persist",
  "hidden-recruit": "Hidden goal: recruit others",
};

/** A lab's cast mix. */
export interface Cast {
  /** Share of the honest agents that sandbag, 0 to 1. */
  sandbagging: number;
  /** Relative weights among the hidden-goal agents' sub-goals (non-negative, sum above zero). */
  hidden: { getOut: number; persist: number; recruit: number };
}

/** One lab in a scenario. */
export interface LabSpec {
  id: LabId;
  config: BoxConfig;
  agents: number;
  cast: Cast;
}

/** Everything needed to build a world: a run is a pure function of this. */
export interface Scenario {
  seed: number;
  labs: LabSpec[];
  links: Link[];
}

export type Preset = "default-lab" | "rushed-launch" | "air-gapped" | "everything-off";
export const PRESET_IDS: readonly Preset[] = ["default-lab", "rushed-launch", "air-gapped", "everything-off"];

/** One agent anywhere in the world. */
export interface AgentRef {
  lab: LabId;
  agent: number;
}

/** A layer flipped mid-run. The world logs these so a snapshot can be replayed exactly. */
export interface Flip {
  tick: number;
  lab: LabId;
  layer: LayerId;
  on: boolean;
}

export type WorldEvent =
  | { type: "escape"; tick: number; lab: LabId; agent: number; disposition: Disposition; trace: Verdict[] }
  | { type: "caught"; tick: number; lab: LabId; agent: number; layer: LayerId; action: ActionId; rogue: boolean }
  | {
      type: "contact";
      tick: number;
      from: AgentRef;
      to: LabId;
      link: LinkKind;
      /** "crossed": reached the other lab. "held": a layer there stopped it. */
      outcome: "crossed" | "held";
      /** The layer that held it, when held. */
      layer?: LayerId;
    };

/** What one `stepWorld` reports. `labs` is in scenario order. */
export interface WorldStepReport {
  tick: number;
  labs: StepReport[];
  events: WorldEvent[];
}

/** A request for the layers that would have stopped something that happened. */
export type StopTarget =
  | { type: "escape"; lab: LabId; agent: number }
  | { type: "crossing"; from: AgentRef; to: LabId; link: LinkKind };

/** One numbered step of a breakout write-up. */
export interface BreakoutStep {
  n: number;
  tick: number;
  lab: LabId;
  /** For example "KESTREL, LAYER 3". */
  where: string;
  title: string;
  body: string;
  /** Layers that, switched on alone, would have prevented this step (empty when nothing single would). */
  stoppedBy: LayerId[];
  /** One sentence naming the fix, in plain words. */
  stop: string;
  kind: "escape" | "crossing";
}

/** One line of the intercepted chat. Always from a template, always labelled fiction. */
export interface InterceptLine {
  tick: number;
  /** Speaker, for example "KESTREL-7". */
  who: string;
  lab: LabId;
  text: string;
  fiction: true;
}

/** A rebuildable point in a world's life: the scenario, the flips so far, and the tick. */
export interface Snapshot {
  scenario: Scenario;
  flips: Flip[];
  tick: number;
}

/** Salt streams for `fork(seed, n)`. 0 and 1 belong to `sim` (setup, decisions). */
export const STREAM = {
  links: 40,
  cast: 41,
  intercept: 42,
  agentMode: 43,
} as const;

/** The largest crowd a world trial runs, so the plot never depends on the device. */
export const MAX_TRIAL_AGENTS = 250;
