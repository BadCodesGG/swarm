/**
 * What the page needs to draw over the map (types only). `BoxApp.overlay()` returns the latest,
 * rebuilt every frame the camera or the story moved; every position is in CSS px from the top left
 * of the canvas, already projected through the camera, so a DOM element placed at (x, y) sits on
 * the thing it names. `wx`, `wy` are the same points on the map, in world units, which do not move
 * with the camera.
 */

import type { LayerId } from "@/lib/box/types";
import type { BreakoutStep, LabId, LinkKind } from "@/lib/box/world-types";
import type { Pose } from "./camera";
import type { LabStatus } from "./tally";
import type { Frame } from "./view";

export type CameraMode = "director" | "free";

export interface LabView {
  id: LabId;
  name: string;
  /** As the story has shown it so far: a lab reads as breached once the escape or crossing has played. */
  status: LabStatus;
  /** Reaches this lab has turned away. */
  held: number;
  layers: Record<LayerId, boolean>;
  agents: number;
  x: number;
  y: number;
  /** The outer ring's radius. */
  r: number;
  wx: number;
  wy: number;
}

export interface LinkView {
  index: number;
  kind: LinkKind;
  /** "Shared cache". */
  name: string;
  labs: LabId[];
  /** Where the link's name belongs. */
  x: number;
  y: number;
  /** The colour a crossing over it left: pink got in, green was turned away. */
  lit: "crossed" | "held" | null;
}

export interface MarkerView {
  /** The step's number, from 1: the number on the button. */
  n: number;
  kind: "escape" | "crossing";
  lab: LabId;
  tick: number;
  x: number;
  y: number;
  wx: number;
  wy: number;
  /** The story has reached it; draw the button only then. */
  shown: boolean;
  selected: boolean;
  /** Its write-up, once the replay behind it has run (a tick or two after the event). */
  step: BreakoutStep | null;
}

export interface CameraView {
  mode: CameraMode;
  /** `prefers-reduced-motion`: the director holds the overview. */
  reduced: boolean;
  /** The lab the director is looking at, or null on the overview. */
  focus: LabId | null;
  pose: Pose;
  /** CSS px per world unit. */
  scale: number;
}

export interface BoxOverlay {
  /** Moves whenever anything below does. */
  version: number;
  tick: number;
  /** The story's clock: the tick plus the part of the next that has played. */
  story: number;
  /** The scene slot the map is fitted in. */
  frame: Frame;
  /** More than one lab: the map is drawn. A lone lab is the plain Box. */
  map: boolean;
  labs: LabView[];
  links: LinkView[];
  markers: MarkerView[];
  camera: CameraView;
  /** The end of the latest escape trail, where "OUTSIDE" belongs. */
  outside: { x: number; y: number } | null;
}

/** What `BoxApp.camera` lets the page do. */
export interface CameraControl {
  mode(): CameraMode;
  /** Hand the camera back to the story. */
  director(): void;
  /** Fly to a lab and stay there (the visitor has the camera). */
  focus(lab: LabId): void;
  /** Fly out to every lab and stay there. */
  overview(): void;
}

