import { createAudio } from "./engine";
import { publishAudio, unpublishAudio } from "./handle";
import type { Offer } from "./cues";

export interface ActAudio {
  dispose(): void;
}

/**
 * One act's sound: an engine (silent until the visitor's toggle enables it), its bus binding, and
 * the handle that hands it to the HUD's audio toggle.
 */
export function startActAudio(bind: (offer: Offer) => () => void): ActAudio {
  const engine = createAudio();
  const unbind = bind((cue, rank) => engine.offer(cue, rank));
  publishAudio(engine);
  return {
    dispose() {
      unbind();
      unpublishAudio(engine);
      engine.dispose();
    },
  };
}
