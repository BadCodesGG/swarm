import type { EventBus } from "../shared/events";
import { startActAudio, type ActAudio } from "./act";
import { bindBox, type BoxCueEvents } from "./cues";

/** Act 2's sound, subscribed to its bus: catch (timbre per layer), escape, trials. */
export function startBoxAudio<M extends BoxCueEvents>(bus: EventBus<M>): ActAudio {
  return startActAudio((offer) => bindBox(bus, offer));
}
