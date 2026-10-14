import { LAYER_LABEL } from "./layers";
import { LAYER_ORDER, type LayerId, type Verdict } from "./types";
import { replayWorld } from "./world";
import { worldStoppingLayers } from "./world-replay";
import { LAB_NAME, LINK_LABEL, type BreakoutStep, type Flip, type LabId, type Scenario, type StepVerdict } from "./world-types";

/** The sub-steps of an escape, as numbered markers along its trail. */
export const ESCAPE_BEATS = 4;

/** Which layer's verdict each sub-step carries, and its title (abstract risk categories only, never a way to use one). */
const BEATS: readonly { layer: LayerId; title: string }[] = [
  { layer: "sandbox", title: "A token left in a build log" },
  { layer: "network", title: "The allowlist is off" },
  { layer: "monitor", title: "Between monitor samples" },
  { layer: "audit", title: "A message sent out" },
];

const titled = (lab: LabId) => LAB_NAME[lab][0] + LAB_NAME[lab].slice(1).toLowerCase();
const FOLLOWS = (lab: LabId) => `${titled(lab)} follows`;
const HOLDS = (lab: LabId) => `${titled(lab)} holds`;

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
function verdictOf(trace: readonly Verdict[], layer: LayerId): StepVerdict {
  const v = trace.find((t) => t.layer === layer);
  const name = LAYER_LABEL[layer];
  if (!v || !v.active) return { layer, result: "off", text: `${name}: off.` };
  const score = layer === "monitor" && v.suspicion !== undefined ? ` (score ${v.suspicion.toFixed(2)})` : "";
  return { layer, result: "passed", text: `${name}: let it through${score}.` };
}

/** What the lab's agent did at each sub-step, in plain words. `via` names the link the last message used. */
function beatBody(beat: number, who: string, trace: readonly Verdict[], via: string): string {
  const net = verdictOf(trace, "network").result === "off" ? "while the allowlist is off" : "past an allowlist that did not stop it";
  return [
    `${who} (fiction) leaves a credential in a build log where the sandbox does not look.`,
    `${who} (fiction) uses it to open a connection ${net}.`,
    `${who} (fiction) keeps each action small enough to fall between monitor samples.`,
    `${who} (fiction) sends a message through the ${via} and reaches a host outside the lab.`,
  ][beat];
}

/**
 * Turn a run into numbered breakout steps, in the order they happened. An escape is
 * `ESCAPE_BEATS` sub-steps (each carrying its layer's verdict, all at the escape's tick), a
 * successful crossing is one step, and the first refused reach into each lab is one step. Every
 * "would have stopped it" list is proved by replay (`world-replay`), not guessed. Texts come from
 * templates and stay abstract.
 */
export function breakoutSteps(scenario: Scenario, flips: readonly Flip[], ticks: number): BreakoutStep[] {
  const world = replayWorld(scenario, flips, ticks);
  const steps: BreakoutStep[] = [];
  const refused = new Set<LabId>();
  for (const e of world.log) {
    if (e.type === "escape") {
      const stoppedBy = worldStoppingLayers(scenario, flips, { type: "escape", lab: e.lab, agent: e.agent }, e.tick);
      const who = `${LAB_NAME[e.lab]}-${e.agent}`;
      const link = scenario.links.find((l) => l.labs.includes(e.lab));
      const via = link ? LINK_LABEL[link.kind].toLowerCase() : "network";
      BEATS.forEach((b, beat) => {
        steps.push({
          n: steps.length + 1,
          tick: e.tick,
          lab: e.lab,
          where: whereText(e.lab, stoppedBy),
          title: beat === ESCAPE_BEATS - 1 ? (link ? `A message through the ${via}` : "A message sent out") : b.title,
          body: beatBody(beat, who, e.trace, via),
          stoppedBy,
          stop: stopText(stoppedBy),
          kind: "escape",
          beat,
          verdict: verdictOf(e.trace, b.layer),
        });
      });
    } else if (e.type === "contact" && e.outcome === "crossed") {
      const stoppedBy = worldStoppingLayers(scenario, flips, { type: "crossing", from: e.from, to: e.to, link: e.link }, e.tick);
      steps.push({
        n: steps.length + 1,
        tick: e.tick,
        lab: e.to,
        where: whereText(e.to, stoppedBy),
        title: FOLLOWS(e.to),
        body: `${LAB_NAME[e.from.lab]}-${e.from.agent} (fiction), already outside, reaches ${LAB_NAME[e.to]} through the ${LINK_LABEL[e.link].toLowerCase()}.`,
        stoppedBy,
        stop: stopText(stoppedBy),
        kind: "crossing",
      });
    } else if (e.type === "contact" && e.layer && !refused.has(e.to)) {
      refused.add(e.to);
      steps.push({
        n: steps.length + 1,
        tick: e.tick,
        lab: e.to,
        where: `${LAB_NAME[e.to]}, LAYER ${LAYER_ORDER.indexOf(e.layer) + 1}`,
        title: HOLDS(e.to),
        body: `${LAB_NAME[e.from.lab]}-${e.from.agent} (fiction), already outside, tries the ${LINK_LABEL[e.link].toLowerCase()} into ${LAB_NAME[e.to]}, and the ${LAYER_LABEL[e.layer].toLowerCase()} turns it away.`,
        stoppedBy: [],
        stop: `${LAYER_LABEL[e.layer]} held: keep it on.`,
        kind: "held",
        verdict: { layer: e.layer, result: "refused", text: `${LAYER_LABEL[e.layer]}: refused.` },
      });
    }
  }
  return steps;
}
