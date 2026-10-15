/**
 * What the page needs to draw over the map (types only). `BoxApp.overlay()` returns the latest,
 * rebuilt every frame the camera or the story moved; every position is in CSS px from the top left
 * of the page (the canvas, unless the page gave the scene a rect, in which case that rect's own offset is included), already projected through the camera, so a DOM element placed at (x, y) sits on
 * the thing it names. `wx`, `wy` are the same points on the map, in world units, which do not move
 * with the camera.
 */

import type { LayerId } from "@/lib/box/types";
import type { BreakoutStep, Flip, LabId, LinkKind } from "@/lib/box/world-types";
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
  /** The lab's monitor threshold and audit budget (fraction of actions reviewed) at this moment. */
  monitorThreshold: number;
  auditBudget: number;
  agents: number;
  /** Counts for this lab alone, up to this moment. */
  caught: number;
  escaped: number;
  /** Actions its monitor sent on to a human reviewer. */
  flagged: number;
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
  /** Its conduits as polylines (a handful of points each), CSS px. */
  paths: { x: number; y: number }[][];
}

export interface MarkerView {
  /** The step's number, from 1: the number on the button. */
  n: number;
  kind: "escape" | "crossing" | "held";
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

/** A rectangle of the page, CSS px from its top left: where the scene is drawn. */
export interface SceneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where the picture is on the run: the moment it shows, how far the run has got, and whether it is the head. */
export interface TimelineView {
  /** The tick shown. */
  at: number;
  /** The newest tick the run has reached (a rewound view does not advance it). */
  head: number;
  /** True when the picture is the head and moving with the run. */
  live: boolean;
}

export interface BoxOverlay {
  /** Moves whenever anything below does. */
  version: number;
  tick: number;
  /** The story's clock: the tick plus the part of the next that has played. */
  story: number;
  /** The scene slot the map is fitted in, in page CSS px (every x and y here is a page position too). */
  frame: Frame;
  timeline: TimelineView;
  /** The layer switches made so far, in order, up to the moment shown (all of them when live). */
  flips: Flip[];
  /** More than one lab: the map is drawn. A lone lab is the plain Box. */
  map: boolean;
  labs: LabView[];
  links: LinkView[];
  markers: MarkerView[];
  camera: CameraView;
  /** The end of the latest escape trail, where "OUTSIDE" belongs. */
  outside: { x: number; y: number } | null;
  /** Each escape trail on show, start to end, CSS px. */
  trails: [{ x: number; y: number }, { x: number; y: number }][];
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
  /**
   * Keeps every lab in view while the story has the camera: the overview fitted to the slot, with
   * room in px for the names under the labs and the marker buttons at the trails' ends, in place of
   * the story's beats (the phone layout's short slot has no room to zoom in on one lab).
   */
  keepAll(on: boolean): void;
}

