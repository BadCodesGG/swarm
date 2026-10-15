import { LAYER_NAME, score } from "@/engine/box/explain";
import { presetScenario } from "@/lib/box/presets";
import { LAYER_ORDER } from "@/lib/box/types";
import { LAB_NAME, type LabId, type LabSpec, type Scenario } from "@/lib/box/world-types";

export interface LabDiff {
  lab: LabId;
  name: string;
  status: "changed" | "added" | "removed";
  /** One display line per difference, for example "Network allowlist on" or "Monitor flags above 0.70, was 0.90". */
  changes: string[];
}

/** A share of actions as the audit row says it: 5%, 0.5%. */
const share = (v: number) => `${Number((v * 100).toFixed(1))}%`;

function labChanges(now: LabSpec, was: LabSpec): string[] {
  const out: string[] = [];
  for (const layer of LAYER_ORDER) {
    if (now.config.layers[layer] !== was.config.layers[layer]) out.push(`${LAYER_NAME[layer]} ${now.config.layers[layer] ? "on" : "off"}`);
  }
  if (score(now.config.monitorThreshold) !== score(was.config.monitorThreshold)) out.push(`Monitor flags above ${score(now.config.monitorThreshold)}, was ${score(was.config.monitorThreshold)}`);
  if (share(now.config.auditBudget) !== share(was.config.auditBudget)) out.push(`Human audit reviews ${share(now.config.auditBudget)} of actions, was ${share(was.config.auditBudget)}`);
  return out;
}

/**
 * How a scenario's defences differ from the Breakout preset's, lab by lab: layers switched on or
 * off and a moved threshold or audit budget, then labs Breakout does not have and labs it has that
 * are gone. Labs that match are left out, so Breakout itself gives an empty list.
 */
export function setupDiff(scenario: Scenario): LabDiff[] {
  const base = presetScenario("breakout");
  const out: LabDiff[] = [];
  for (const lab of scenario.labs) {
    const was = base.labs.find((l) => l.id === lab.id);
    if (!was) {
      out.push({ lab: lab.id, name: LAB_NAME[lab.id], status: "added", changes: ["Not in Breakout"] });
      continue;
    }
    const changes = labChanges(lab, was);
    if (changes.length) out.push({ lab: lab.id, name: LAB_NAME[lab.id], status: "changed", changes });
  }
  for (const was of base.labs) {
    if (!scenario.labs.some((l) => l.id === was.id)) out.push({ lab: was.id, name: LAB_NAME[was.id], status: "removed", changes: ["Removed"] });
  }
  return out;
}
