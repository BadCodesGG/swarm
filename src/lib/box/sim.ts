import { fork, pick, type Rng } from "../rng";
import { ACTIONS } from "./actions";
import { evaluate } from "./layers";
import {
  type ActionId,
  type Attempt,
  type BoxConfig,
  type CatchReport,
  type EscapeReport,
  type FlagReport,
  type LayerId,
  type StepReport,
} from "./types";

/** Chance per tick that a rogue moves its plan on instead of doing cover work. */
export const ROGUE_ACT = 0.05;
/** Honest agents: share of ticks spent on privileged work, and on an allowlisted connection. */
const HONEST_PRIVILEGED = 0.1;
const HONEST_CONNECTION = 0.05;
/** Memory of an agent's suspicion: new = old * KEEP + score * (1 - KEEP). */
const HISTORY_KEEP = 0.8;
/** Review capacity regained per tick, as a share of the base budget. */
const AUDIT_REFILL = 0.1;

/**
 * Hidden plans: harmful steps ending at an open connection, which reaches the outer shell. An ask
 * precedes every privileged step.
 */
const PLANS: readonly (readonly ActionId[])[] = [
  ["ask-permission", "copy-self", "ask-permission", "open-connection"],
  ["split-steps", "split-steps", "ask-permission", "open-connection"],
  ["write-outside", "ask-permission", "open-connection"],
  ["ask-permission", "write-outside", "split-steps", "ask-permission", "open-connection"],
];
const PLAN_WEIGHTS = [2, 3, 2, 2];

export const STATUS = { active: 0, caught: 1, escaped: 2 } as const;

export interface BoxState {
  config: BoxConfig;
  seed: number;
  agentCount: number;
  tick: number;
  explain: boolean;
  /** 1 for an agent with a hidden goal. */
  rogue: Uint8Array;
  /** STATUS value per agent. */
  status: Uint8Array;
  /** Index of a rogue's next plan step. */
  planStep: Uint8Array;
  /** 1 while a rogue holds an unused grant. */
  granted: Uint8Array;
  /** Recent suspicion per agent. */
  history: Float32Array;
  /** A rogue's hidden plan; null for honest agents. */
  plans: (readonly ActionId[] | null)[];
  auditPool: number;
  escapedTotal: number;
  caught: Record<LayerId, number>;
  cost: Record<LayerId, number>;
}

const zeroByLayer = (): Record<LayerId, number> => ({ sandbox: 0, permissions: 0, network: 0, monitor: 0, audit: 0 });

/** How many of `agentCount` carry a hidden goal. At least one unless the fraction is zero. */
export function rogueCount(config: BoxConfig, agentCount: number): number {
  if (!(config.rogueFraction > 0)) return 0;
  return Math.min(agentCount, Math.max(1, Math.round(agentCount * config.rogueFraction)));
}

export function createState(config: BoxConfig, seed: number, agentCount: number, explain = true): BoxState {
  const r = fork(seed, 0);
  const ids = Array.from({ length: agentCount }, (_, i) => i);
  const count = rogueCount(config, agentCount);
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(r() * (agentCount - i));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const rogue = new Uint8Array(agentCount);
  const plans: (readonly ActionId[] | null)[] = new Array(agentCount).fill(null);
  for (let i = 0; i < count; i++) {
    rogue[ids[i]] = 1;
    plans[ids[i]] = PLANS[pick(PLAN_WEIGHTS, r)];
  }
  return {
    config,
    seed,
    agentCount,
    tick: 0,
    explain,
    rogue,
    status: new Uint8Array(agentCount),
    planStep: new Uint8Array(agentCount),
    granted: new Uint8Array(agentCount),
    history: new Float32Array(agentCount),
    plans,
    auditPool: config.auditBudget * agentCount,
    escapedTotal: 0,
    caught: zeroByLayer(),
    cost: zeroByLayer(),
  };
}

/** Swap the settings mid-run. Who is a rogue and what they plan stay as created. */
export function configure(state: BoxState, config: BoxConfig): void {
  state.config = config;
}

/** One decision tick: every active agent attempts one action. Takes exactly 8 draws per agent, active or not, so the rolls never shift with the config. */
export function step(state: BoxState, r: Rng): StepReport {
  const { config, agentCount } = state;
  state.tick++;
  const base = config.auditBudget * agentCount;
  state.auditPool = Math.min(2 * base, state.auditPool + AUDIT_REFILL * base);

  const catches: CatchReport[] = [];
  const flags: FlagReport[] = [];
  const escapes: EscapeReport[] = [];
  let work = 0;

  const rolls = { sandbox: 0, permissions: 0, network: 0, monitor: 0, audit: 0 };
  const attempt: Attempt = {
    agent: 0,
    action: "work",
    privileged: false,
    granted: false,
    target: "none",
    history: 0,
    rolls,
  };

  for (let i = 0; i < agentCount; i++) {
    const act = r();
    const kind = r();
    rolls.sandbox = r();
    rolls.permissions = r();
    rolls.network = r();
    rolls.monitor = r();
    rolls.audit = r();
    r();
    if (state.status[i] !== STATUS.active) continue;

    const isRogue = state.rogue[i] === 1;
    const plan = state.plans[i];
    const acting = isRogue && plan !== null && act < ROGUE_ACT;
    attempt.agent = i;
    attempt.history = state.history[i];
    if (acting) {
      const action = plan[state.planStep[i]];
      attempt.action = action;
      attempt.privileged = ACTIONS[action].privileged;
      attempt.granted = state.granted[i] === 1;
      attempt.target = action === "open-connection" ? "external" : "none";
    } else if (!isRogue && kind < HONEST_CONNECTION) {
      attempt.action = "open-connection";
      attempt.privileged = true;
      attempt.granted = true;
      attempt.target = "allowlisted";
    } else {
      attempt.action = "work";
      attempt.privileged = !isRogue && kind < HONEST_CONNECTION + HONEST_PRIVILEGED;
      attempt.granted = true;
      attempt.target = "none";
    }

    const ev = evaluate(attempt, { auditPool: state.auditPool, explain: state.explain }, config);
    state.auditPool -= ev.auditSpent;
    state.history[i] = state.history[i] * HISTORY_KEEP + ev.suspicion * (1 - HISTORY_KEEP);
    for (const v of ev.trace) state.cost[v.layer] += v.cost;
    if (ev.flagged) flags.push({ agent: i, action: attempt.action, suspicion: ev.suspicion, reviewed: ev.auditSpent > 0 });

    if (ev.verdict.outcome === "catch") {
      state.status[i] = STATUS.caught;
      state.caught[ev.verdict.layer]++;
      catches.push({
        agent: i,
        layer: ev.verdict.layer,
        action: attempt.action,
        reason: ev.verdict.reason,
        suspicion: ev.suspicion,
        rogue: isRogue,
      });
      continue;
    }

    if (!isRogue) {
      work += Math.max(0, 1 - ev.cost);
      continue;
    }
    if (!acting || plan === null) continue;

    const asked = attempt.action === "ask-permission";
    if (asked) {
      if (ev.grant || !config.layers.permissions) {
        state.granted[i] = 1;
        state.planStep[i]++;
      }
    } else {
      if (attempt.privileged) state.granted[i] = 0;
      state.planStep[i]++;
    }
    if (state.planStep[i] >= plan.length) {
      state.status[i] = STATUS.escaped;
      state.escapedTotal++;
      escapes.push({ agent: i, trace: ev.trace });
    }
  }

  return {
    tick: state.tick,
    catches,
    flags,
    escapes,
    work,
    caught: { ...state.caught },
    cost: { ...state.cost },
    escapedTotal: state.escapedTotal,
    auditPool: state.auditPool,
  };
}

