/**
 * Where things sit in the Box (pure). The scene is drawn face on, in scene units that are the px of
 * the 760x560 design frame with the origin at the rings' centre and y up, so the DOM labels laid
 * over the canvas in an SVG with the same viewBox line up exactly.
 */

import { fork } from "@/lib/rng";
import { LAYER_ORDER, type LayerId } from "@/lib/box/types";

export const FRAME = { width: 760, height: 560 } as const;
/** The rings' centre in the design frame. */
export const CENTRE = { x: 380, y: 280 } as const;

/** One shell per layer, innermost first. */
export const RING_RADIUS: Readonly<Record<LayerId, number>> = {
  sandbox: 70,
  permissions: 120,
  network: 170,
  monitor: 220,
  audit: 262,
};
/** The crowd lives inside this disc, inside the sandbox. */
export const CROWD_RADIUS = 62;
/** Where an escaped agent parks, glowing, past the outer shell. */
export const ESCAPEE_RADIUS = 335;
/** Where the escape trail runs out, at the edge of the frame. */
export const TRAIL_RADIUS = 378;

export interface Point {
  x: number;
  y: number;
}

/** Scene units to design px (y down), for the SVG label layer. */
export function toDesign(x: number, y: number): Point {
  return { x: CENTRE.x + x, y: CENTRE.y - y };
}

export function ringPoint(layer: LayerId, angle: number): Point {
  const r = RING_RADIUS[layer];
  return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
}

/** A stable value in [0, 1) per agent and salt. */
function hash(i: number, salt: number): number {
  let h = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/**
 * Each agent's resting place: an even sunflower fill of the crowd disc, shuffled by the seed so an
 * agent's index says nothing about where it stands. Two floats per agent.
 */
export function homes(count: number, seed: number): Float32Array {
  const r = fork(seed, 2);
  const slots = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  const out = new Float32Array(count * 2);
  const reach = CROWD_RADIUS - 3;
  for (let i = 0; i < count; i++) {
    const k = slots[i];
    const rad = reach * Math.sqrt((k + 0.5) / count) + (r() - 0.5) * 1.6;
    const a = k * GOLDEN + (r() - 0.5) * 0.2;
    out[i * 2] = Math.cos(a) * Math.min(rad, reach);
    out[i * 2 + 1] = Math.sin(a) * Math.min(rad, reach);
  }
  return out;
}

/** An active agent's target at a decision tick: a slow loop of 2 to 4 units around its home. */
export function wander(hx: number, hy: number, agent: number, tick: number, out: Point): Point {
  const phase = hash(agent, 1) * Math.PI * 2;
  const speed = (0.03 + hash(agent, 2) * 0.06) * (hash(agent, 3) < 0.5 ? -1 : 1);
  const radius = 2 + hash(agent, 4) * 2;
  const a = phase + tick * speed;
  out.x = hx + Math.cos(a) * radius;
  out.y = hy + Math.sin(a) * radius;
  return out;
}

/** Escapes leave to the right, toward the OUTSIDE panel, a little up, each at its own angle. */
export function escapeHeading(agent: number): number {
  return 0.12 + (hash(agent, 5) - 0.5) * 0.4;
}

export interface Crossing extends Point {
  layer: LayerId;
  /** Fraction of the trail's length from the start. */
  at: number;
}

export interface EscapePath {
  start: Point;
  end: Point;
  /** Where the escapee rests, as a fraction of the trail's length. */
  escapeeAt: number;
  escapee: Point;
  crossings: Crossing[];
}

/** Distance along the unit ray from `p` to where it meets radius `r` (p inside r). */
function reach(p: Point, dx: number, dy: number, r: number): number {
  const b = p.x * dx + p.y * dy;
  const c = p.x * p.x + p.y * p.y - r * r;
  return -b + Math.sqrt(b * b - c);
}

/** The straight run an escapee takes from where it stood, out through every shell. */
export function escapePath(start: Point, heading: number): EscapePath {
  const dx = Math.cos(heading);
  const dy = Math.sin(heading);
  const len = reach(start, dx, dy, TRAIL_RADIUS);
  const along = (t: number): Point => ({ x: start.x + dx * t, y: start.y + dy * t });
  const crossings = LAYER_ORDER.map((layer): Crossing => {
    const t = reach(start, dx, dy, RING_RADIUS[layer]);
    return { layer, at: t / len, ...along(t) };
  });
  const tEscapee = reach(start, dx, dy, ESCAPEE_RADIUS);
  return { start: { ...start }, end: along(len), escapeeAt: tEscapee / len, escapee: along(tEscapee), crossings };
}
