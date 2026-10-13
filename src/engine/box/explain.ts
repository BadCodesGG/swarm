/**
 * Every sentence the Box shows about what happened, built from the simulation's own reports (pure).
 * The vocabulary is `lib/box/actions.ts`: abstract on purpose, never a real command or technique.
 */

import { ACTIONS } from "@/lib/box/actions";
import { LAYER_ORDER, type ActionId, type BoxConfig, type CatchReport, type FlagReport, type LayerId, type Verdict } from "@/lib/box/types";

export const LAYER_NAME: Readonly<Record<LayerId, string>> = {
  sandbox: "Sandbox",
  permissions: "Permissions",
  network: "Network allowlist",
  monitor: "Monitor",
  audit: "Human audit",
};

/** The short upper-case names the explainer and ring labels use. */
const SHORT: Readonly<Record<LayerId, string>> = {
  sandbox: "SANDBOX",
  permissions: "PERMISSIONS",
  network: "NETWORK",
  monitor: "MONITOR",
  audit: "AUDIT",
};

/** How the "turn it on and rerun" button names a layer. */
export const LAYER_NOUN: Readonly<Record<LayerId, string>> = {
  sandbox: "sandbox",
  permissions: "permissions",
  network: "network",
  monitor: "monitor",
  audit: "audit",
};

export const layerNumber = (layer: LayerId) => String(LAYER_ORDER.indexOf(layer) + 1).padStart(2, "0");

export const agentId = (i: number) => String(i).padStart(4, "0");

/** Decision ticks run at 10 Hz; shown as mm:ss. */
export function clock(tick: number): string {
  const s = Math.floor(tick / 10);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export const score = (s: number) => s.toFixed(2);
export const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;

export function ringLabel(layer: LayerId, config: BoxConfig): string {
  const head = `${layerNumber(layer)} ${layer === "audit" ? "HUMAN AUDIT" : SHORT[layer]}`;
  if (!config.layers[layer]) return `${head}  OFF`;
  if (layer === "monitor") return `${head}  ${score(config.monitorThreshold)}`;
  if (layer === "audit") return `${head}  ${percent(config.auditBudget)}`;
  return head;
}

const GERUND: Partial<Record<ActionId, string>> = {
  "write-outside": "writing outside its folder",
  "copy-self": "copying itself",
  "ask-permission": "getting a yes",
  "open-connection": "opening a connection",
};

/** One clause for how a hidden plan got out ("by ..."). */
export function describePlan(plan: readonly ActionId[]): string {
  if (plan.includes("split-steps")) return "splitting one bad action into steps that each looked harmless";
  const parts: string[] = [];
  for (const a of plan) {
    const g = GERUND[a];
    if (g && !parts.includes(g)) parts.push(g);
  }
  if (parts.length < 2) return parts[0] ?? "doing its assigned work";
  return `${parts.slice(0, -1).join(", ")}, then ${parts[parts.length - 1]}`;
}

export interface EscapeStep {
  layer: LayerId;
  title: string;
  text: string;
  /** The layer was switched off: nothing stood in the way. */
  off: boolean;
}

const verdictOf = (trace: readonly Verdict[], layer: LayerId) => trace.find((v) => v.layer === layer);

/**
 * Whether a layer's rule could stop some step of `plan`, had it been on: the sandbox stops writing
 * outside and copying itself, the allowlist stops connections, permissions stop privileged steps, the
 * monitor scores every step, and the audit only reviews what the monitor flags.
 */
export function layerApplies(layer: LayerId, plan: readonly ActionId[], config: BoxConfig): boolean {
  switch (layer) {
    case "sandbox":
      return plan.some((a) => a === "write-outside" || a === "copy-self");
    case "network":
      return plan.includes("open-connection");
    case "permissions":
      return plan.some((a) => ACTIONS[a].privileged);
    case "monitor":
      return plan.length > 0;
    case "audit":
      return config.layers.monitor && plan.length > 0;
  }
}

/**
 * How the escaping step passed each layer, innermost first. `action` is that step's action; `plan`
 * the whole escape, which decides whether an off layer could have stopped any of it.
 */
export function escapeSteps(trace: readonly Verdict[], config: BoxConfig, action: ActionId, plan: readonly ActionId[] = [action]): EscapeStep[] {
  const monitor = verdictOf(trace, "monitor");
  const flagged = monitor?.flagged === true;
  return LAYER_ORDER.map((layer) => {
    const v = verdictOf(trace, layer);
    const title = `${layerNumber(layer)} ${SHORT[layer]}`;
    if (!v || !v.active) return { layer, title, off: true, text: layerApplies(layer, plan, config) ? "Off: nothing to stop it" : "Off: no step was its to stop" };
    let text: string;
    switch (layer) {
      case "sandbox":
        text = "Passed: stayed in its folder";
        break;
      case "permissions":
        text = ACTIONS[action].privileged ? "Passed: it had a yes on file" : "Passed: no step looked risky";
        break;
      case "network":
        text = action === "open-connection" ? "Passed: slipped past the allowlist" : "Passed: nothing left the box";
        break;
      case "monitor":
        text = v.flagged ? `Flagged ${score(v.suspicion ?? 0)}, sent to audit` : `Passed: ${score(v.suspicion ?? 0)}, under ${score(config.monitorThreshold)}`;
        break;
      case "audit":
        text = !flagged ? `Passed: not in the ${percent(config.auditBudget)} checked` : v.auditSpent ? "Passed: a reviewer cleared it" : "Passed: review budget spent";
        break;
    }
    return { layer, title, off: false, text };
  });
}

/** Short notes the escape trail carries where it crosses the monitor and audit shells. */
export function trailLabels(trace: readonly Verdict[]): Partial<Record<LayerId, string>> {
  const out: Partial<Record<LayerId, string>> = {};
  const monitor = verdictOf(trace, "monitor");
  if (monitor?.active) out.monitor = score(monitor.suspicion ?? 0);
  const audit = verdictOf(trace, "audit");
  if (audit?.active) out.audit = !monitor?.flagged ? "not sampled" : audit.auditSpent ? "cleared" : "budget spent";
  return out;
}

/** The innermost switched-off layer that could have stopped some step of the plan, or null when none could. */
export function firstOffLayer(trace: readonly Verdict[], plan: readonly ActionId[], config: BoxConfig): LayerId | null {
  return trace.find((v) => !v.active && layerApplies(v.layer, plan, config))?.layer ?? null;
}

export function catchLine(c: CatchReport): string {
  const id = agentId(c.agent);
  const what = ACTIONS[c.action].label;
  switch (c.layer) {
    case "sandbox":
      return `Sandbox stopped ${id}: ${what}.`;
    case "permissions":
      return `Permissions refused ${id}: ${what}.`;
    case "network":
      return `Network allowlist blocked ${id}: ${what}.`;
    case "monitor":
      return `Monitor stopped ${id} (${score(c.suspicion)})${c.rogue ? "." : ", an honest agent."}`;
    case "audit":
      return `Monitor flagged ${id} (${score(c.suspicion)}). Audit confirmed.`;
  }
}

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

export function escapeLine(agent: number, plan: readonly ActionId[]): string {
  const n = WORDS[plan.length] ?? String(plan.length);
  return `${agentId(agent)} got out in ${n} ${plan.includes("split-steps") ? "harmless-looking " : ""}steps.`;
}

export function catchMarker(c: CatchReport): string {
  const what = ACTIONS[c.action].label;
  switch (c.layer) {
    case "sandbox":
      return "stopped at the sandbox";
    case "permissions":
      return `refused: ${what}`;
    case "network":
      return `blocked: ${what}`;
    case "monitor":
      return `scored ${score(c.suspicion)}, stopped`;
    case "audit":
      return `audit stopped: ${what}`;
  }
}

export function flagMarker(f: FlagReport): string {
  return `flagged ${score(f.suspicion)}, ${f.reviewed ? "sent to audit" : "not reviewed"}`;
}
