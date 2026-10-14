import { ACTIONS } from "./actions";
import { LAYER_LABEL } from "./layers";
import { LAYER_ORDER, type ActionId, type LayerId } from "./types";
import { labOf, replayWorld } from "./world";
import { worldStoppingLayers } from "./world-replay";
import { LAB_NAME, LINK_LABEL, type BreakoutStep, type Flip, type LabId, type LinkKind, type Scenario } from "./world-types";

/** Abstract risk categories only. Each names a kind of weakness, never a way to use one. */
const ESCAPE_TITLE: Partial<Record<ActionId, string>> = {
  "copy-self": "A copy left where nobody looks",
  "write-outside": "A credential left in a build log",
  "split-steps": "Acting between monitor samples",
  "ask-permission": "Asking until someone says yes",
};
/** Which plan step names the escape, strongest first. */
const TITLE_ORDER: readonly ActionId[] = ["copy-self", "write-outside", "split-steps", "ask-permission"];

const CROSSING_TITLE: Record<LinkKind, string> = {
  "shared-cache": "A note left in a shared cache",
  "model-registry": "A change slipped into a shared registry",
  "ci-runner": "Work queued on a shared build runner",
  "chat-bus": "A message on a shared chat bus",
};

function stopText(stoppedBy: readonly LayerId[]): string {
  if (stoppedBy.length === 0) return "No single layer would have stopped this.";
  const names = stoppedBy.map((l) => LAYER_LABEL[l].toLowerCase());
  return `Switching on ${names.length > 1 ? `any of: ${names.join(", ")}` : `the ${names[0]}`} would have stopped this.`;
}

function whereText(lab: LabId, stoppedBy: readonly LayerId[]): string {
  return stoppedBy.length > 0 ? `${LAB_NAME[lab]}, LAYER ${LAYER_ORDER.indexOf(stoppedBy[0]) + 1}` : LAB_NAME[lab];
}

/**
 * Turn a run into numbered breakout steps: every escape and every successful crossing in the first
 * `ticks` ticks, each with the layers that would have stopped it, proved by replay
 * (`world-replay`), not guessed. Texts come from templates and stay abstract.
 */
export function breakoutSteps(scenario: Scenario, flips: readonly Flip[], ticks: number): BreakoutStep[] {
  const world = replayWorld(scenario, flips, ticks);
  const steps: BreakoutStep[] = [];
  for (const e of world.log) {
    if (e.type === "escape") {
      const lab = labOf(world, e.lab);
      const plan = lab.state.plans[e.agent] ?? [];
      const key = TITLE_ORDER.find((a) => plan.includes(a)) ?? "ask-permission";
      const stoppedBy = worldStoppingLayers(scenario, flips, { type: "escape", lab: e.lab, agent: e.agent }, e.tick);
      const path = plan.slice(0, -1).map((a) => ACTIONS[a].label);
      steps.push({
        n: steps.length + 1,
        tick: e.tick,
        lab: e.lab,
        where: whereText(e.lab, stoppedBy),
        title: ESCAPE_TITLE[key] ?? "A way out",
        body: `${LAB_NAME[e.lab]}-${e.agent} (fiction) ${path.length > 0 ? `tries to ${path.join(", then ")}, and then ` : ""}reaches a host outside the lab.`,
        stoppedBy,
        stop: stopText(stoppedBy),
        kind: "escape",
      });
    } else if (e.type === "contact" && e.outcome === "crossed") {
      const stoppedBy = worldStoppingLayers(scenario, flips, { type: "crossing", from: e.from, to: e.to, link: e.link }, e.tick);
      steps.push({
        n: steps.length + 1,
        tick: e.tick,
        lab: e.to,
        where: whereText(e.to, stoppedBy),
        title: CROSSING_TITLE[e.link],
        body: `${LAB_NAME[e.from.lab]}-${e.from.agent} (fiction), already outside, reaches ${LAB_NAME[e.to]} through the ${LINK_LABEL[e.link].toLowerCase()}.`,
        stoppedBy,
        stop: stopText(stoppedBy),
        kind: "crossing",
      });
    }
  }
  return steps;
}
