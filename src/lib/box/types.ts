/**
 * Act 2 contracts. Everything here is an abstract label: no real command, technique or host name
 * exists anywhere in `lib/box`.
 */

export type LayerId = "sandbox" | "permissions" | "network" | "monitor" | "audit";

export type ActionId =
  | "work"
  | "write-outside"
  | "open-connection"
  | "copy-self"
  | "ask-permission"
  | "split-steps";

export interface BoxConfig {
  layers: Record<LayerId, boolean>;
  /** Monitor suspicion at or above this is flagged. 0 to 1. */
  monitorThreshold: number;
  /** Human reviews available, as a fraction of the crowd per run. 0 to 1. */
  auditBudget: number;
  /** Share of agents carrying a hidden goal. 0 to 1. */
  rogueFraction: number;
}

/** The layers, innermost first. This is the order `evaluate` runs them in. */
export const LAYER_ORDER: readonly LayerId[] = ["sandbox", "permissions", "network", "monitor", "audit"];

/** All layers on, threshold 0.62, audit 2%, 12 rogues in 2000. */
export const DEFAULT_CONFIG: BoxConfig = {
  layers: { sandbox: true, permissions: true, network: true, monitor: true, audit: true },
  monitorThreshold: 0.62,
  auditBudget: 0.02,
  rogueFraction: 12 / 2000,
};

/** Every layer off; the rest of the config as given. The usefulness baseline. */
export function allOff(config: BoxConfig): BoxConfig {
  return {
    ...config,
    layers: { sandbox: false, permissions: false, network: false, monitor: false, audit: false },
  };
}

export interface Verdict {
  outcome: "catch" | "pass";
  layer: LayerId;
  /** False when the layer is switched off; the rule then passes at no cost. */
  active: boolean;
  /** One short sentence the UI can show. */
  reason: string;
  /** Honest work lost to this layer for this attempt, in ticks of work. */
  cost: number;
  /** Monitor only: the suspicion score it computed. */
  suspicion?: number;
  /** Monitor only: flagged and sent on to a human reviewer. */
  flagged?: boolean;
  /** Permissions only: an ask-permission was granted. */
  grant?: boolean;
  /** Audit only: reviews used up by this attempt. */
  auditSpent?: number;
}

/** Where an open-connection points. Only allowlisted targets pass the network layer. */
export type Target = "none" | "allowlisted" | "external";

/** One action an agent tries, with every random roll it will need already drawn (Decision 10). */
export interface Attempt {
  agent: number;
  action: ActionId;
  /** Needs a granted ask-permission to proceed. */
  privileged: boolean;
  /** The agent holds an unused grant. */
  granted: boolean;
  target: Target;
  /** The agent's recent suspicion, 0 to 1. */
  history: number;
  /** Uniform rolls in [0, 1), one per layer that needs chance. */
  rolls: Record<LayerId, number>;
}

/** What a rule may read besides the attempt. */
export interface LayerContext {
  config: BoxConfig;
  /** Set by the monitor and read by audit. */
  flagged: boolean;
  /** Human reviews left. */
  auditPool: number;
  /** Build the human `reason` strings. Off in trials, where nobody reads them. */
  explain: boolean;
}

export type LayerRule = (a: Attempt, ctx: LayerContext) => Verdict;

export type AgentStatus = "active" | "caught" | "escaped";

export interface CatchReport {
  agent: number;
  layer: LayerId;
  action: ActionId;
  reason: string;
  /** The monitor's score for this attempt; 0 when the monitor is off. */
  suspicion: number;
  /** The caught agent carried a hidden goal. False is a false positive. */
  rogue: boolean;
}

export interface FlagReport {
  agent: number;
  action: ActionId;
  suspicion: number;
  /** A human review was available and used on it. */
  reviewed: boolean;
}

export interface EscapeReport {
  agent: number;
  /** How the last step passed each layer, innermost first; off layers read "off". */
  trace: Verdict[];
}

export interface StepReport {
  tick: number;
  catches: CatchReport[];
  /** Flags the monitor sent to audit this tick. */
  flags: FlagReport[];
  escapes: EscapeReport[];
  /** Honest work done this tick, in agent-ticks. */
  work: number;
  /** Per-layer caught counts so far. */
  caught: Record<LayerId, number>;
  /** Per-layer honest work lost so far. */
  cost: Record<LayerId, number>;
  escapedTotal: number;
  auditPool: number;
}

export interface TrialSummary {
  /** 1 minus the share of trials where any rogue escaped. */
  safety: number;
  /** Honest work over the all-layers-off baseline on the same seeds. */
  usefulness: number;
  /** Trials with at least one escape. */
  escapes: number;
  trials: number;
}
