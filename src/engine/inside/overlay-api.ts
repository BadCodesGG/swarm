/**
 * What the engine hands the React overlay: screen positions (CSS px, canvas relative) and the text
 * the labels draw. Types only, so the React layer never imports the engine to read them.
 */

import type { ModelFamily } from "@/lib/trace/types";
import type { StationCategory } from "./layout";

export interface StationLabel {
  key: StationCategory;
  x: number;
  y: number;
  /** Text anchor as a fraction of the label box: 0 left/top, 1 right/bottom. */
  ax: number;
  ay: number;
  count: number;
  active: boolean;
}

export interface ProbeLabel {
  id: number;
  x: number;
  y: number;
  tool: string;
  query: string;
}

/** Where one agent's cloud is on screen, for the annotated callouts. */
export interface AgentAnchor {
  id: number;
  /** Centre of the cloud. */
  x: number;
  y: number;
  /** Screen radius of the cloud, where its points fade out. */
  r: number;
  model: ModelFamily;
  /** The agent's label (session text: render as text only). */
  name: string;
  /** Tokens the cloud has seen so far. */
  tokens: number;
  /** Spawned and not yet returned (the orchestrator is always live). */
  live: boolean;
}

/** Screen positions (CSS px) and text the DOM overlay draws over the canvas. */
export interface InsideOverlay {
  /** Bumped when something the overlay shows moved by a pixel or changed; not every frame. */
  version: number;
  /** Screen px per design px (1 at the 1440x900 hero framing). */
  scale: number;
  /** Canvas size, CSS px. */
  width: number;
  height: number;
  /** The part of the canvas the scene is framed in (the whole canvas when unframed). */
  frame: { x: number; y: number; w: number; h: number };
  core: { x: number; y: number };
  boundary: { x: number; y: number };
  stations: StationLabel[];
  probes: ProbeLabel[];
  /** The orchestrator first, then the busiest visible subagents by tokens so far; at most `MAX_ANCHORS`. */
  anchors: AgentAnchor[];
}

/** Most anchors the engine publishes. */
export const MAX_ANCHORS = 12;

/** What a click can land on that is not an agent: a tool station. */
export type StationSelection = StationCategory | null;
