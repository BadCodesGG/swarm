import { RATES } from "@/components/inside/rates";
import type { ActId } from "./tour-state";

export interface Shortcut {
  /** Key caps, one per cap. */
  keys: string[];
  does: string;
}

/**
 * The keys each act really answers, read off its handlers: `useShortcuts` in `inside/hud.tsx`
 * (with the timeline's own Home and End), and `box-hud.tsx` plus the engine's Home key for the Box.
 * Keep this list in step with them.
 */
export const SHORTCUTS: Record<ActId, Shortcut[]> = {
  inside: [
    { keys: ["Space"], does: "Play or pause the replay" },
    { keys: ["Left", "Right"], does: "Step back or forward along the timeline" },
    { keys: RATES.map((_, i) => String(i + 1)), does: `Playback speed: ${RATES.map((r) => `${r}x`).join(", ")}` },
    { keys: ["A"], does: "Select the next agent" },
    { keys: ["Shift", "A"], does: "Select the previous agent" },
    { keys: ["D"], does: "Hand the camera back to the director" },
    { keys: ["Home", "End"], does: "Jump to the start or the end, with the timeline focused" },
    { keys: ["Escape"], does: "Close the open panel or card" },
    { keys: ["?"], does: "Open this sheet" },
  ],
  box: [
    { keys: ["1", "to", "9"], does: "Open that numbered breakout step's card" },
    { keys: ["Escape"], does: "Close the open card" },
    { keys: ["Home"], does: "Hand the camera back to the director" },
    { keys: ["Ctrl", "wheel"], does: "Zoom the map; drag it to pan" },
    { keys: ["Left", "Right"], does: "Rewind or run on, with the timeline slider focused" },
    { keys: ["?"], does: "Open this sheet" },
  ],
};
