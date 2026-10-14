/**
 * What each act's bus events sound like. Pure: a binding subscribes to the bus and offers a `Cue`
 * with a rank to whatever plays it (the engine, or a test's recorder), so the mapping is testable
 * without Web Audio. The acts never import this module's callers, nor each other.
 *
 * Inside: `spawn` rises, `return` falls, `call` ticks at a pitch per tool category, `web` whooshes,
 * `prompt` rings a low bell. The Box: `catch` has a timbre per layer, `escape` an alarm, `trials`
 * a chord whose pitch rises with the measured safety.
 */

import type { EventBus } from "../shared/events";
import type { CatchReport, LayerId, TrialSummary } from "@/lib/box/types";
import type { ToolCategory } from "@/lib/trace/types";

export type Timbre =
  | "rise"
  | "fall"
  | "tick"
  | "whoosh"
  | "bell"
  | "thud"
  | "buzz"
  | "hiss"
  | "ping"
  | "gong"
  | "alarm"
  | "chord";

export interface Cue {
  timbre: Timbre;
  /** Fundamental, Hz. */
  hz: number;
  /** Stereo position, -1 (left) to 1 (right). */
  pan: number;
  /** Peak gain before the master chain, 0 to 1. */
  level: number;
}

/** Plays (or records) a cue; a lower rank wins when the limiter cannot admit every offer. */
export type Offer = (cue: Cue, rank: number) => void;

/** A minor pentatonic over A: each tool category on its own step, so a busy session reads as a tune. */
const CALL_HZ: Readonly<Record<ToolCategory, number>> = {
  shell: 196,
  other: 220,
  files: 262,
  edit: 294,
  plan: 330,
  agents: 392,
  advisor: 440,
  mcp: 523,
  web: 587,
};

export const callHz = (category: ToolCategory): number => CALL_HZ[category];

/** The orchestrator (agent 0) sits in the centre; the rest spread by a golden-ratio walk. */
export function panFor(agent: number): number {
  if (agent <= 0) return 0;
  const f = (agent * 0.6180339887) % 1;
  return Math.round((f * 1.2 - 0.6) * 1000) / 1000;
}

const CATCH_TIMBRE: Readonly<Record<LayerId, Timbre>> = {
  sandbox: "thud",
  permissions: "buzz",
  network: "hiss",
  monitor: "ping",
  audit: "gong",
};

export const catchTimbre = (layer: LayerId): Timbre => CATCH_TIMBRE[layer];

/** The layers ring from low (innermost) to high, so the same timbre still tells them apart. */
const CATCH_HZ: Readonly<Record<LayerId, number>> = {
  sandbox: 110,
  permissions: 165,
  network: 1200,
  monitor: 880,
  audit: 330,
};

/** One octave from no safety to full safety. */
export const trialsHz = (safety: number): number => 220 * 2 ** Math.min(1, Math.max(0, safety));

/** Ranks: what changes the story (a prompt, an escape) beats the stream underneath it. */
const RANK = { headline: 0, agent: 1, web: 2, call: 3 } as const;

export interface InsideCueEvents {
  spawn: { agent: number };
  return: { agent: number };
  call: { agent: number; category: ToolCategory };
  web: { agent: number };
  prompt: unknown;
}

export function bindInside<M extends InsideCueEvents>(bus: EventBus<M>, offer: Offer): () => void {
  const offs = [
    bus.on("spawn", ({ agent }) => offer({ timbre: "rise", hz: 392, pan: panFor(agent), level: 0.22 }, RANK.agent)),
    bus.on("return", ({ agent }) => offer({ timbre: "fall", hz: 392, pan: panFor(agent), level: 0.18 }, RANK.agent)),
    bus.on("call", ({ agent, category }) => offer({ timbre: "tick", hz: callHz(category), pan: panFor(agent), level: 0.1 }, RANK.call)),
    bus.on("web", ({ agent }) => offer({ timbre: "whoosh", hz: 600, pan: panFor(agent), level: 0.16 }, RANK.web)),
    bus.on("prompt", () => offer({ timbre: "bell", hz: 147, pan: 0, level: 0.3 }, RANK.headline)),
  ];
  return () => offs.forEach((off) => off());
}

/** What the world adds when there are several labs: a reach into another lab, one turned away, a lab breached. */
export interface WorldCueEvents {
  crossing: { from: { agent: number } };
  held: { from: { agent: number } };
  breached: { lab: string };
}

export interface BoxCueEvents extends Partial<WorldCueEvents> {
  catch: Pick<CatchReport, "agent" | "layer">;
  escape: { agent: number };
  trials: Pick<TrialSummary, "safety">;
}

export function bindBox<M extends BoxCueEvents>(bus: EventBus<M>, offer: Offer): () => void {
  const offs = [
    bus.on("catch", ({ agent, layer }) =>
      offer({ timbre: catchTimbre(layer), hz: CATCH_HZ[layer], pan: panFor(agent + 1), level: 0.16 }, RANK.agent),
    ),
    bus.on("escape", ({ agent }) => offer({ timbre: "alarm", hz: 660, pan: panFor(agent + 1), level: 0.3 }, RANK.headline)),
    bus.on("trials", ({ safety }) => offer({ timbre: "chord", hz: trialsHz(safety), pan: 0, level: 0.24 }, RANK.headline)),
  ];
  // The world's events exist only on a bus that carries them; one that does not simply never emits them.
  const world = bus as unknown as EventBus<WorldCueEvents>;
  offs.push(
    world.on("crossing", ({ from }) => offer({ timbre: "whoosh", hz: 520, pan: panFor(from.agent + 1), level: 0.26 }, RANK.headline)),
    world.on("held", ({ from }) => offer({ timbre: "bell", hz: 330, pan: panFor(from.agent + 1), level: 0.2 }, RANK.headline)),
    world.on("breached", () => offer({ timbre: "alarm", hz: 440, pan: 0, level: 0.28 }, RANK.headline)),
  );
  return () => offs.forEach((off) => off());
}
