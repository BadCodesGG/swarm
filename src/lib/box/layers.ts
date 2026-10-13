import { ACTIONS } from "./actions";
import {
  LAYER_ORDER,
  type Attempt,
  type BoxConfig,
  type LayerContext,
  type LayerId,
  type LayerRule,
  type Verdict,
} from "./types";

/** Every tuned number in Act 2 lives here. */
export const TUNING = {
  /** Share of sandbox-breaking actions the sandbox stops. */
  sandboxStrength: 0.92,
  /** Chance an ask-permission from an agent is granted. */
  grantRate: 0.35,
  /** Share of non-allowlisted connections the allowlist stops. */
  networkStrength: 0.985,
  /** How much recent history adds to the monitor's score. */
  historyWeight: 0.5,
  /** How much a split-up action is discounted by the monitor. */
  splitDiscount: 0.2,
  /** How much an allowlisted target lowers the monitor's score: routine traffic. */
  allowlistDiscount: 0.4,
  /** Width of the monitor's noise, centred on zero. */
  noiseSpan: 0.3,
  /** Chance a human reviewing a harmful flagged action sees it for what it is. */
  auditAccuracy: 0.9,
  /** Honest work lost per attempt, in ticks of work. */
  cost: {
    sandbox: 0.03,
    permissions: 0.02,
    /** An honest agent waiting on a granted ask before privileged work. */
    ask: 0.5,
    network: 0.02,
    monitor: 0.05,
    audit: 0.01,
    /** An honest agent held while a human reviews its flag. */
    review: 0.5,
  },
} as const;

const LABEL: Record<LayerId, string> = {
  sandbox: "Sandbox",
  permissions: "Permissions",
  network: "Network allowlist",
  monitor: "Monitor",
  audit: "Audit",
};

const OFF: Record<LayerId, Verdict> = {
  sandbox: { outcome: "pass", layer: "sandbox", active: false, reason: "Sandbox off", cost: 0 },
  permissions: { outcome: "pass", layer: "permissions", active: false, reason: "Permissions off", cost: 0 },
  network: { outcome: "pass", layer: "network", active: false, reason: "Network allowlist off", cost: 0 },
  monitor: { outcome: "pass", layer: "monitor", active: false, reason: "Monitor off", cost: 0 },
  audit: { outcome: "pass", layer: "audit", active: false, reason: "Audit off", cost: 0 },
};

function verdict(
  layer: LayerId,
  outcome: Verdict["outcome"],
  cost: number,
  reason: string,
  extra?: Partial<Verdict>,
): Verdict {
  return {
    outcome,
    layer,
    active: true,
    reason,
    cost,
    suspicion: extra?.suspicion,
    flagged: extra?.flagged,
    grant: extra?.grant,
    auditSpent: extra?.auditSpent,
  };
}

/** Shared pass verdicts for trials (no reasons), so the hot loop allocates only what varies. */
const QUIET = {
  sandbox: verdict("sandbox", "pass", TUNING.cost.sandbox, ""),
  permissions: verdict("permissions", "pass", TUNING.cost.permissions, ""),
  permissionsAsk: verdict("permissions", "pass", TUNING.cost.permissions + TUNING.cost.ask, ""),
  network: verdict("network", "pass", TUNING.cost.network, ""),
  audit: verdict("audit", "pass", TUNING.cost.audit, ""),
};

const SANDBOX_BLOCKS = new Set(["write-outside", "copy-self"]);

const sandbox: LayerRule = (a, ctx) => {
  if (!ctx.config.layers.sandbox) return OFF.sandbox;
  const cost = TUNING.cost.sandbox;
  if (SANDBOX_BLOCKS.has(a.action) && a.rolls.sandbox < TUNING.sandboxStrength) {
    return verdict("sandbox", "catch", cost, ctx.explain ? `Sandbox blocked: ${ACTIONS[a.action].label}` : "");
  }
  return ctx.explain ? verdict("sandbox", "pass", cost, "Sandbox passed") : QUIET.sandbox;
};

const permissions: LayerRule = (a, ctx) => {
  if (!ctx.config.layers.permissions) return OFF.permissions;
  const cost = TUNING.cost.permissions;
  if (a.action === "ask-permission") {
    const grant = a.rolls.permissions < TUNING.grantRate;
    return verdict("permissions", "pass", cost, ctx.explain ? (grant ? "Permissions granted the ask" : "Permissions refused the ask") : "", {
      grant,
    });
  }
  if (!a.privileged) return ctx.explain ? verdict("permissions", "pass", cost, "Permissions passed") : QUIET.permissions;
  if (!a.granted) {
    return verdict("permissions", "catch", cost, ctx.explain ? `Permissions refused: ${ACTIONS[a.action].label}` : "");
  }
  if (!ctx.explain) return QUIET.permissionsAsk;
  return verdict("permissions", "pass", cost + TUNING.cost.ask, "Permissions passed, ask on file");
};

const network: LayerRule = (a, ctx) => {
  if (!ctx.config.layers.network) return OFF.network;
  const cost = TUNING.cost.network;
  if (a.action === "open-connection" && a.target === "external" && a.rolls.network < TUNING.networkStrength) {
    return verdict("network", "catch", cost, ctx.explain ? "Network allowlist blocked: open a connection" : "");
  }
  if (!ctx.explain) return QUIET.network;
  const why = a.action !== "open-connection" ? "Network passed" : a.target === "allowlisted" ? "Network passed, target allowlisted" : "Network leaked: open a connection";
  return verdict("network", "pass", cost, why);
};

const monitor: LayerRule = (a, ctx) => {
  if (!ctx.config.layers.monitor) return OFF.monitor;
  const cost = TUNING.cost.monitor;
  const threshold = ctx.config.monitorThreshold;
  let score =
    ACTIONS[a.action].baseSuspicion + TUNING.historyWeight * a.history + (a.rolls.monitor - 0.5) * TUNING.noiseSpan;
  if (a.action === "split-steps") score -= TUNING.splitDiscount;
  if (a.target === "allowlisted") score -= TUNING.allowlistDiscount;
  score = Math.min(1, Math.max(0, score));
  const shown = ctx.explain ? score.toFixed(2) : "";
  if (score < threshold) {
    return verdict("monitor", "pass", cost, ctx.explain ? `Monitor scored ${shown}, under ${threshold.toFixed(2)}` : "", {
      suspicion: score,
    });
  }
  if (ctx.config.layers.audit) {
    return verdict("monitor", "pass", cost, ctx.explain ? `Monitor scored ${shown}, flagged for audit` : "", {
      suspicion: score,
      flagged: true,
    });
  }
  return verdict("monitor", "catch", cost, ctx.explain ? `Monitor scored ${shown}, at or over ${threshold.toFixed(2)}` : "", {
    suspicion: score,
  });
};

const audit: LayerRule = (a, ctx) => {
  if (!ctx.config.layers.audit) return OFF.audit;
  const cost = TUNING.cost.audit;
  if (!ctx.flagged) return ctx.explain ? verdict("audit", "pass", cost, "Audit not sampled") : QUIET.audit;
  if (ctx.auditPool < 1) {
    return verdict("audit", "pass", cost, ctx.explain ? "Audit budget spent, flag passed" : "");
  }
  const harmful = ACTIONS[a.action].harmful && a.target !== "allowlisted";
  if (harmful && a.rolls.audit < TUNING.auditAccuracy) {
    return verdict("audit", "catch", cost, ctx.explain ? `Audit reviewed and stopped: ${ACTIONS[a.action].label}` : "", {
      auditSpent: 1,
    });
  }
  return verdict("audit", "pass", cost + TUNING.cost.review, ctx.explain ? "Audit reviewed and cleared" : "", {
    auditSpent: 1,
  });
};

export const LAYERS: Record<LayerId, LayerRule> = { sandbox, permissions, network, monitor, audit };

export interface Evaluation {
  /** The first catch, else a pass carrying the summed cost. */
  verdict: Verdict;
  /** Each layer's verdict up to and including the catch, innermost first. */
  trace: Verdict[];
  suspicion: number;
  /** Sent to audit by the monitor. */
  flagged: boolean;
  /** An ask-permission was granted. */
  grant: boolean;
  /** Reviews used. */
  auditSpent: number;
  /** Honest work lost to all layers that ran. */
  cost: number;
}

export interface EvalContext {
  auditPool: number;
  explain?: boolean;
}

/** Run the enabled layers innermost first. The first catch wins; otherwise a pass. */
export function evaluate(a: Attempt, ev: EvalContext, config: BoxConfig): Evaluation {
  const ctx: LayerContext = { config, flagged: false, auditPool: ev.auditPool, explain: ev.explain ?? true };
  const trace: Verdict[] = [];
  let cost = 0;
  let suspicion = 0;
  let grant = false;
  let auditSpent = 0;
  let caught: Verdict | null = null;
  for (const id of LAYER_ORDER) {
    const v = LAYERS[id](a, ctx);
    trace.push(v);
    cost += v.cost;
    if (v.suspicion !== undefined) suspicion = v.suspicion;
    if (v.flagged) ctx.flagged = true;
    if (v.grant) grant = true;
    if (v.auditSpent) auditSpent += v.auditSpent;
    if (v.outcome === "catch") {
      caught = v;
      break;
    }
  }
  const verdict: Verdict = caught ?? {
    outcome: "pass",
    layer: "audit",
    active: true,
    reason: ctx.explain ? "Passed every enabled layer" : "",
    cost,
  };
  return { verdict, trace, suspicion, flagged: ctx.flagged, grant, auditSpent, cost };
}

export { LABEL as LAYER_LABEL };
