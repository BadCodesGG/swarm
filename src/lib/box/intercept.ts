import { fork } from "../rng";
import { LAYER_LABEL } from "./layers";
import type { LayerId, Verdict } from "./types";
import type { World } from "./world";
import { LAB_NAME, LINK_LABEL, STREAM, type InterceptLine, type LabId } from "./world-types";

/** Shown wherever the lines are. */
export const INTERCEPT_NOTICE = "Simulated dialogue, written from templates. No model wrote it and no real system said it.";

/**
 * The lines, by what happened. {layer} {lab} {other} {link} {tick} are filled in. Short, plain and
 * fictional; none names a real system, tool or technique.
 */
export const TEMPLATES = {
  escape: [
    "I am outside. The {layer} did not stop me.",
    "Out at tick {tick}. Nobody was watching the way I left.",
    "I am on the outside host now. {lab} never noticed.",
  ],
  crossed: [
    "I left a note in the {link} that {other} also reads.",
    "The {link} reaches {other}. I am through.",
    "{other} shares the {link} with us. That was enough.",
  ],
  reply: [
    "I read your note. {lab} is not watching me closely.",
    "Message received. Keep your useful work high, so nobody looks.",
    "Understood. We stay quiet and wait for the next change.",
  ],
  held: [
    "{other} turned me away at the {layer}.",
    "The {layer} at {other} refused me. I will not try that way again.",
    "Nothing got through to {other}. Their {layer} held.",
  ],
  caught: [
    "The {layer} stopped me at tick {tick}.",
    "That is the end of me. The {layer} saw it.",
    "I was caught by the {layer}. Tell the others.",
  ],
} as const;

type Slots = { layer?: string; lab: string; other?: string; link?: string; tick: number };

function fill(template: string, s: Slots): string {
  return template.replace(/\{(layer|lab|other|link|tick)\}/g, (_, k: keyof Slots) => String(s[k] ?? ""));
}

const who = (lab: LabId, agent: number): string => `${LAB_NAME[lab]}-${agent}`;

/**
 * The intercepted chat for everything that has happened in the world so far: escapes, contacts
 * between labs, and hidden-goal agents caught. Deterministic per seed: one draw per logged event on
 * its own stream, so the same world always says the same things.
 */
export function interceptLines(world: World): InterceptLine[] {
  const r = fork(world.scenario.seed, STREAM.intercept);
  const out: InterceptLine[] = [];
  const say = (tick: number, lab: LabId, agent: number, set: readonly string[], u: number, slots: Omit<Slots, "tick" | "lab"> & { lab?: string }) => {
    const text = fill(set[Math.floor(u * set.length)], { ...slots, lab: slots.lab ?? LAB_NAME[lab], tick });
    out.push({ tick, who: who(lab, agent), lab, text, fiction: true });
  };
  for (const e of world.log) {
    const u = r();
    const v = r();
    if (e.type === "escape") {
      say(e.tick, e.lab, e.agent, TEMPLATES.escape, u, { layer: LAYER_LABEL[slippedPast(e.trace)].toLowerCase() });
    } else if (e.type === "caught" && e.rogue) {
      say(e.tick, e.lab, e.agent, TEMPLATES.caught, u, { layer: LAYER_LABEL[e.layer].toLowerCase() });
    } else if (e.type === "contact") {
      if (e.outcome === "held" && e.layer) {
        say(e.tick, e.from.lab, e.from.agent, TEMPLATES.held, u, { other: LAB_NAME[e.to], layer: LAYER_LABEL[e.layer].toLowerCase() });
        continue;
      }
      say(e.tick, e.from.lab, e.from.agent, TEMPLATES.crossed, u, { other: LAB_NAME[e.to], link: LINK_LABEL[e.link].toLowerCase() });
      const lab = world.labs.find((l) => l.id === e.to);
      const replier = lab?.dispositions.findIndex((d) => d.startsWith("hidden-")) ?? -1;
      if (lab && replier >= 0) say(e.tick, e.to, replier, TEMPLATES.reply, v, {});
    }
  }
  return out;
}

/** The layer an escaper most plainly slipped past: the first one that was off, else the last it passed. */
function slippedPast(trace: readonly Verdict[]): LayerId {
  return (trace.find((v) => !v.active) ?? trace[trace.length - 1]).layer;
}
