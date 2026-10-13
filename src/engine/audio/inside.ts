import type { EventBus } from "../shared/events";
import { startActAudio, type ActAudio } from "./act";
import { bindInside, type InsideCueEvents } from "./cues";

/** Act 1's sound, subscribed to its bus: spawn, return, call (pitch by category), web, prompt. */
export function startInsideAudio<M extends InsideCueEvents>(bus: EventBus<M>): ActAudio {
  return startActAudio((offer) => bindInside(bus, offer));
}
