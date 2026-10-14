/**
 * The camera's projection (pure): a pose (the world rectangle in view) fitted to the scene slot, the
 * rectangle of the canvas the page leaves for the scene. This is the one formula the renderer, the
 * markers' screen positions and the drag and wheel controls share, so they always agree.
 */

import type { Pose } from "./camera";
import type { Point } from "./layout";

/** A rectangle of the canvas, CSS px from its top left. */
export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface View {
  /** The slot's centre, CSS px. */
  cx: number;
  cy: number;
  /** CSS px per world unit. */
  scale: number;
  pose: Pose;
}

/** The pose fitted inside the slot, centred: as large as fits, so the slot never crops it. */
export function fitView(frame: Frame, pose: Pose): View {
  const scale = Math.max(0.05, Math.min(frame.width / pose.w, frame.height / pose.h));
  return { cx: frame.x + frame.width / 2, cy: frame.y + frame.height / 2, scale, pose };
}

/** A world point on the canvas, CSS px. */
export const project = (v: View, p: Point): Point => ({ x: v.cx + (p.x - v.pose.x) * v.scale, y: v.cy - (p.y - v.pose.y) * v.scale });

/** A canvas point back in the world. */
export const unproject = (v: View, s: Point): Point => ({ x: v.pose.x + (s.x - v.cx) / v.scale, y: v.pose.y - (s.y - v.cy) / v.scale });

/** The pose moved so the world follows a drag of (dx, dy) CSS px. */
export const pan = (v: View, dx: number, dy: number): Pose => ({ ...v.pose, x: v.pose.x - dx / v.scale, y: v.pose.y + dy / v.scale });

/** Zoom limits for a drag-and-wheel camera: how much of the overview's width may be in view. */
export const ZOOM_IN = 0.3;
export const ZOOM_OUT = 1.6;

/** The pose zoomed by `factor` (above 1 closes in) about a canvas point, which stays under the cursor; clamped against the overview. */
export function zoomAbout(v: View, at: Point, factor: number, overview: Pose): Pose {
  const w = Math.min(overview.w * ZOOM_OUT, Math.max(overview.w * ZOOM_IN, v.pose.w / factor));
  const k = w / v.pose.w;
  const world = unproject(v, at);
  return { x: world.x - (world.x - v.pose.x) * k, y: world.y - (world.y - v.pose.y) * k, w, h: v.pose.h * k };
}
