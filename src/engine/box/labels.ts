/**
 * Where the Box's scene text goes (pure), in the 760x560 design frame the SVG label layer draws in.
 * The ring labels are fixed; the escape trail's notes are placed next, then the newest catch
 * markers' notes, each at a candidate spot whose box clears every placed label, the ring labels,
 * the trail, the crack, the escapee, the crowd, other markers' marks and the frame's edge. A few
 * orders for the trail notes are tried and the layout that labels the most markers, nearest what
 * they name, wins. Text is sized as the design's monospace face, so the boxes match what the
 * browser draws closely enough to keep apart (`scripts/shot-box.mjs` checks the drawn boxes).
 */

import { LAYER_ORDER, type BoxConfig, type LayerId } from "@/lib/box/types";
import { ringLabel } from "./explain";
import { CENTRE, CROWD_RADIUS, FRAME, RING_RADIUS, toDesign, type Point } from "./layout";
import type { EscapeRecord, Marker } from "./tally";

export type Anchor = "start" | "middle" | "end";

export interface TextSpec {
  /** The whole label, as one string. */
  text: string;
  /** The label as drawn, one entry per line; a long marker note may take two. */
  lines: readonly string[];
  /** Design px: the baseline's anchor point. */
  x: number;
  y: number;
  anchor: Anchor;
  fontSize: number;
  letterSpacing: number;
}

export interface RingText extends TextSpec {
  layer: LayerId;
  /** The layer is switched off; the label is drawn in the warning colour. */
  off: boolean;
}
export interface MarkerText extends TextSpec {
  marker: Marker;
}
export interface NoteText extends TextSpec {
  layer: "monitor" | "audit";
}

export interface LabelLayout {
  rings: RingText[];
  markers: MarkerText[];
  /** The escape trail's monitor score and audit outcome, in that order; the HUD shows each once the escapee has crossed its shell. */
  notes: NoteText[];
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Design font sizes at a text scale of 1. */
export const RING_FONT = 10.5;
export const MARKER_FONT = 10.5;
export const NOTE_FONT = 10;
/** The frame less a small margin: no label box may leave it. */
export const FRAME_BOX: Rect = { x0: 2, y0: 2, x1: FRAME.width - 2, y1: FRAME.height - 2 };

/** Markers that carry a text label at once; older ones keep only their mark. */
const LABELLED = 3;
/** Two labelled markers closer than this (design px) would read as one; only the newer keeps its text. */
const LABEL_GAP = 40;
/** Gap between a box and the trail, design px. */
const TRAIL_CLEAR = 3;
/** A marker's text may sit at most this far (design px, at a text scale of 1) from its mark, or it reads as adrift. */
const MARKER_REACH = 22;
/** Clearance round the outer ring's crack and the parked escapee's bright core, design px. */
const CRACK_REACH = 21;
const ESCAPEE_GLOW = 14;
/** Baseline gap above each ring's top, design px. */
const LABEL_LIFT: Record<LayerId, number> = { sandbox: 6, permissions: 5, network: 5, monitor: 5, audit: 5 };
/** JetBrains Mono's advance, in ems. */
const ADVANCE = 0.6;
/** Baseline to baseline for a two-line note, in ems. */
export const LINE_HEIGHT = 1.2;

/** The box a text covers, padded by its 4 px halo (scaled with the text); later lines run down from the first baseline. */
export function rectOf(t: TextSpec): Rect {
  const chars = Math.max(...t.lines.map((l) => l.length));
  const width = chars * (ADVANCE * t.fontSize + t.letterSpacing);
  const x0 = t.anchor === "start" ? t.x : t.anchor === "end" ? t.x - width : t.x - width / 2;
  const halo = t.fontSize / 5;
  const below = (t.lines.length - 1) * LINE_HEIGHT * t.fontSize;
  return { x0: x0 - halo, y0: t.y - 0.78 * t.fontSize - halo, x1: x0 + width + halo, y1: t.y + below + 0.22 * t.fontSize + halo };
}

/** A long note in two lines: after its colon if it has one, else at the space nearest its middle. */
function twoLines(text: string): string[] | null {
  const colon = text.indexOf(": ");
  if (colon > 0) return [text.slice(0, colon + 1), text.slice(colon + 2)];
  let best = -1;
  for (let i = text.indexOf(" "); i >= 0; i = text.indexOf(" ", i + 1)) {
    if (best < 0 || Math.abs(i - text.length / 2) < Math.abs(best - text.length / 2)) best = i;
  }
  return best > 0 ? [text.slice(0, best), text.slice(best + 1)] : null;
}

export const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** Whether segment `p`-`q` passes through the box (Liang-Barsky clipping). */
export function segmentHits(r: Rect, p: Point, q: Point): boolean {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  let lo = 0;
  let hi = 1;
  const edges: [number, number][] = [
    [-dx, p.x - r.x0],
    [dx, r.x1 - p.x],
    [-dy, p.y - r.y0],
    [dy, r.y1 - p.y],
  ];
  for (const [den, num] of edges) {
    if (den === 0) {
      if (num < 0) return false;
    } else {
      const t = num / den;
      if (den < 0) lo = Math.max(lo, t);
      else hi = Math.min(hi, t);
      if (lo > hi) return false;
    }
  }
  return true;
}

const grow = (r: Rect, by: number): Rect => ({ x0: r.x0 - by, y0: r.y0 - by, x1: r.x1 + by, y1: r.y1 + by });
const inside = (r: Rect, outer: Rect) => r.x0 >= outer.x0 && r.y0 >= outer.y0 && r.x1 <= outer.x1 && r.y1 <= outer.y1;
const square = (c: Point, half: number): Rect => ({ x0: c.x - half, y0: c.y - half, x1: c.x + half, y1: c.y + half });

/** How far a box's nearest edge is from a point. */
const gapTo = (r: Rect, p: Point) => Math.hypot(Math.max(r.x0 - p.x, 0, p.x - r.x1), Math.max(r.y0 - p.y, 0, p.y - r.y1));

/** Whether a box reaches into a disc. */
export function touchesDisc(r: Rect, c: Point, radius: number): boolean {
  const dx = c.x - Math.min(Math.max(c.x, r.x0), r.x1);
  const dy = c.y - Math.min(Math.max(c.y, r.y0), r.y1);
  return dx * dx + dy * dy < radius * radius;
}

/** What a candidate box must stay clear of. */
interface Field {
  boxes: Rect[];
  /** Round things text would hide or be lost in: the crowd, the crack, the escapee's glow. */
  discs: { c: Point; r: number }[];
  trail: [Point, Point] | null;
}

/** How many things a box would cover; 0 is clean. */
function conflicts(r: Rect, f: Field): number {
  let n = inside(r, FRAME_BOX) ? 0 : 1;
  for (const b of f.boxes) if (overlaps(r, b)) n++;
  for (const d of f.discs) if (touchesDisc(r, d.c, d.r)) n++;
  if (f.trail && segmentHits(grow(r, TRAIL_CLEAR), f.trail[0], f.trail[1])) n++;
  return n;
}

/**
 * Candidate spots beside a marker: the design's own (outward, on the side away from the centre line),
 * then level with the mark, then the other side of it, then a line or two farther off; the same rows
 * centred over and under it; and last the inward side.
 */
function markerSpots(p: Point, k: number): { dx: number; dy: number; anchor: Anchor }[] {
  const side = p.x < CENTRE.x ? -1 : 1;
  const out: Anchor = side < 0 ? "end" : "start";
  const back: Anchor = side < 0 ? "start" : "end";
  const below = p.y > CENTRE.y;
  const line = 1.3 * MARKER_FONT;
  const near = below ? 20 : -7;
  const far = below ? -7 : 20;
  const away = below ? 1 : -1;
  const rows = [near, 4, far, near + away * line, far - away * line, near + 2 * away * line, far - 2 * away * line].map((dy) => dy * k);
  const h = 14 * k;
  const overUnder = [near + away * 4, far - away * 4].map((dy) => dy * k);
  return [
    ...rows.map((dy) => ({ dx: side * h, dy, anchor: out })),
    ...overUnder.map((dy) => ({ dx: 0, dy, anchor: "middle" as const })),
    // Hung over or under the mark, running outward: clear of the crowd when the side is too short.
    ...overUnder.map((dy) => ({ dx: -side * h, dy, anchor: out })),
    ...rows.map((dy) => ({ dx: -side * h, dy, anchor: back })),
  ];
}

/**
 * The order a trail note tries its rows in: the design's under the trail first, over it first, or
 * nearest first (under and over by turns).
 */
type NoteOrder = "under" | "over" | "nearest";
type NoteOrders = Record<"monitor" | "audit", NoteOrder>;
/** The pairs tried, the design's first. */
const NOTE_ORDERS: readonly NoteOrders[] = [
  { monitor: "under", audit: "under" },
  { monitor: "nearest", audit: "nearest" },
  { monitor: "over", audit: "under" },
  { monitor: "under", audit: "over" },
];
/** What a note over the trail costs on top of its distance, design px: the design puts them under. */
const OVER_COST = 30;

/** Candidate spots for a trail note at its crossing. */
function noteSpots(k: number, first: boolean, order: NoteOrder): { dx: number; dy: number; anchor: Anchor }[] {
  const fs = NOTE_FONT * k;
  const u = [10 + 13 * k, 10 + 13 * k + 1.3 * fs, 10 + 13 * k + 2.6 * fs];
  const o = [-8 * k, -8 * k - 1.3 * fs];
  const rows = order === "under" ? [...u, ...o] : order === "over" ? [...o, ...u] : [u[0], o[0], u[1], o[1], u[2]];
  // The monitor score sits centred under its crossing; the audit note starts just past the crack.
  const along: { dx: number; anchor: Anchor }[] = first
    ? [{ dx: 0, anchor: "middle" }, { dx: -6, anchor: "end" }, { dx: 6, anchor: "start" }]
    : [{ dx: 12, anchor: "start" }, { dx: 0, anchor: "middle" }, { dx: -12, anchor: "end" }];
  const spots: { dx: number; dy: number; anchor: Anchor }[] = [];
  for (const dy of rows) for (const a of along) spots.push({ dx: a.dx * k, dy, anchor: a.anchor });
  return spots;
}

/** The trail notes, each at its first clean spot (or, if none is clean, the least crowded: a note always shows). */
function placeNotes(escape: EscapeRecord, field: Field, k: number, orders: NoteOrders): { notes: NoteText[]; cost: number } {
  const notes: NoteText[] = [];
  let cost = 0;
  const wanted: { layer: "monitor" | "audit"; text: string | undefined }[] = [
    { layer: "monitor", text: escape.trail.monitor },
    { layer: "audit", text: escape.trail.audit },
  ];
  for (const { layer, text } of wanted) {
    if (!text) continue;
    const c = escape.path.crossings[LAYER_ORDER.indexOf(layer)];
    const at = toDesign(c.x, c.y);
    let best: NoteText | null = null;
    let bestN = Infinity;
    for (const s of noteSpots(k, layer === "monitor", orders[layer])) {
      const t: NoteText = { layer, text, lines: [text], x: at.x + s.dx, y: at.y + s.dy, anchor: s.anchor, fontSize: NOTE_FONT * k, letterSpacing: 0 };
      const n = conflicts(rectOf(t), field);
      if (n < bestN) {
        best = t;
        bestN = n;
        if (n === 0) break;
      }
    }
    if (best) {
      notes.push(best);
      field.boxes.push(rectOf(best));
      const dy = best.y - at.y;
      cost += Math.abs(dy) + (dy < 0 ? OVER_COST : 0) + bestN * 1000;
    }
  }
  return { notes, cost };
}

/**
 * The newest markers' notes, newest first, each at the clean spot nearest its mark, in one line or
 * two (raised so the block keeps the single line's side of the mark). A marker with no clean spot
 * within reach keeps only its mark, and an older one may take its place.
 */
function placeMarkers(markers: readonly Marker[], field: Field, k: number): { placed: MarkerText[]; cost: number } {
  // Marker dots stay readable: no text over another marker's mark.
  const dots = markers.map((m) => square(toDesign(m.x, m.y), 5));
  const placed: MarkerText[] = [];
  let cost = 0;
  const fs = MARKER_FONT * k;
  for (let i = markers.length - 1; i >= 0 && placed.length < LABELLED; i--) {
    const m = markers[i];
    if (!placed.every((o) => Math.hypot(o.marker.x - m.x, o.marker.y - m.y) >= LABEL_GAP)) continue;
    const p = toDesign(m.x, m.y);
    const others: Field = { ...field, boxes: [...field.boxes, ...dots.filter((_, j) => j !== i)] };
    const split = twoLines(m.label);
    const spots = markerSpots(p, k);
    const tries = [
      ...spots.map((s) => ({ ...s, lines: [m.label] })),
      ...(split ? spots.map((s) => ({ ...s, dy: s.dy < 0 ? s.dy - LINE_HEIGHT * fs : s.dy < 10 * k ? s.dy - (LINE_HEIGHT * fs) / 2 : s.dy, lines: split })) : []),
    ]
      .map((s): MarkerText => ({ marker: m, text: m.label, lines: s.lines, x: p.x + s.dx, y: p.y + s.dy, anchor: s.anchor, fontSize: fs, letterSpacing: 0 }))
      // Nearest first; a tie keeps the listed order, and one line beats two at the same reach.
      .map((t) => ({ t, gap: gapTo(rectOf(t), p) }))
      .filter((c) => c.gap <= MARKER_REACH * k)
      .map(({ t, gap }) => ({ t, cost: gap + (t.lines.length > 1 ? 3 * k : 0) }))
      .sort((a, b) => a.cost - b.cost);
    const hit = tries.find(({ t }) => conflicts(rectOf(t), others) === 0);
    if (hit) {
      placed.push(hit.t);
      field.boxes.push(rectOf(hit.t));
      cost += hit.cost;
    }
  }
  return { placed, cost };
}

export function layoutLabels({
  config,
  markers,
  escape,
  k,
}: {
  config: BoxConfig;
  markers: readonly Marker[];
  escape: EscapeRecord | null;
  /** Text scale: 1 at the design's size. */
  k: number;
}): LabelLayout {
  const rings = LAYER_ORDER.map(
    (layer): RingText => ({
      layer,
      off: !config.layers[layer],
      text: ringLabel(layer, config),
      lines: [ringLabel(layer, config)],
      x: CENTRE.x,
      y: CENTRE.y - RING_RADIUS[layer] - LABEL_LIFT[layer],
      anchor: "middle",
      fontSize: RING_FONT * k,
      letterSpacing: k,
    }),
  );
  const base = (): Field => {
    const f: Field = { boxes: rings.map(rectOf), discs: [{ c: CENTRE, r: CROWD_RADIUS }], trail: null };
    if (escape) {
      f.trail = [toDesign(escape.path.start.x, escape.path.start.y), toDesign(escape.path.end.x, escape.path.end.y)];
      const crack = escape.path.crossings[4];
      // The crack's zigzag reaches 19 px along the ring either side of the crossing (see `shells.ts`).
      f.discs.push({ c: toDesign(crack.x, crack.y), r: CRACK_REACH }, { c: toDesign(escape.path.escapee.x, escape.path.escapee.y), r: ESCAPEE_GLOW });
    }
    return f;
  };

  // Each pair of note orders, kept if it lets more markers keep their text, or the same ones with
  // every label nearer what it names; on a tie the earlier pair (the design's first) stays.
  let best: { layout: LabelLayout; cost: number } | null = null;
  for (const orders of escape ? NOTE_ORDERS : NOTE_ORDERS.slice(0, 1)) {
    const field = base();
    const placedNotes = escape ? placeNotes(escape, field, k, orders) : { notes: [], cost: 0 };
    const placedMarkers = placeMarkers(markers, field, k);
    const cost = placedNotes.cost + placedMarkers.cost;
    const count = placedMarkers.placed.length;
    if (!best || count > best.layout.markers.length || (count === best.layout.markers.length && cost < best.cost - 0.5)) {
      best = { layout: { rings, markers: placedMarkers.placed, notes: placedNotes.notes }, cost };
    }
  }
  return best!.layout;
}

// --- the world: lab names, link names and the OUTSIDE label, in screen px ---

/** A lab on the screen: its centre and outer ring, CSS px. */
export interface WorldLabInput {
  id: string;
  name: string;
  status: string;
  x: number;
  y: number;
  r: number;
}
export interface WorldLinkInput {
  index: number;
  name: string;
  /** Where the name belongs, on the link. */
  x: number;
  y: number;
}
export interface WorldLabelsInput {
  /** The scene slot, CSS px; no label box may leave it. */
  bounds: Rect;
  labs: readonly WorldLabInput[];
  links: readonly WorldLinkInput[];
  /** Numbered marker buttons, CSS px centre; labels keep clear of them. */
  markers: readonly { n: number; x: number; y: number }[];
  /** Where the OUTSIDE label goes (the end of an escape trail), or null. */
  outside: Point | null;
  /** Escape trails, which text stays off. */
  segments?: readonly [Point, Point][];
  /** The links' conduits as screen polylines: every name stays off them, a link's own name excepted. */
  conduits?: readonly { link: number; points: readonly Point[] }[];
  /** Text scale: 1 at the design's size. */
  k: number;
}
export interface WorldLabText extends TextSpec {
  id: string;
}
export interface WorldLinkText extends TextSpec {
  index: number;
}
export interface WorldLabelLayout {
  labs: WorldLabText[];
  links: WorldLinkText[];
  outside: TextSpec | null;
}

export const LAB_FONT = 12;
export const LINK_FONT = 10;
/** Half the side of a marker button at a text scale of 1: the design's 44 px. */
export const MARKER_BUTTON = 22;

/** Spots for a lab's block (its name, then its state) round its ring. */
function labSpots(l: WorldLabInput, k: number): { x: number; y: number; anchor: Anchor }[] {
  const below = l.y + l.r + 16 * k;
  const above = l.y - l.r - 10 * k - 1.3 * LAB_FONT * k;
  const side = l.r * 0.72;
  return [
    { x: l.x, y: below, anchor: "middle" },
    { x: l.x, y: above, anchor: "middle" },
    { x: l.x + side, y: below + 4 * k, anchor: "start" },
    { x: l.x - side, y: below + 4 * k, anchor: "end" },
    { x: l.x + l.r + 10 * k, y: l.y, anchor: "start" },
    { x: l.x - l.r - 10 * k, y: l.y, anchor: "end" },
    { x: l.x, y: below + 22 * k, anchor: "middle" },
    { x: l.x, y: above - 22 * k, anchor: "middle" },
  ];
}

/**
 * Where the map's text goes: each lab's name and state beside its ring, each link's name by its
 * conduit, and the OUTSIDE label at the end of a trail. Placed in that order, each at the first
 * spot clear of the rings, the marker buttons, the trails and every box already placed (a label
 * with no clear spot takes the least crowded one: a name always shows).
 */
export function layoutWorldLabels({ bounds, labs, links, markers, outside, segments = [], conduits = [], k }: WorldLabelsInput): WorldLabelLayout {
  const chords = conduits.map((c) => ({ link: c.link, pieces: c.points.slice(1).map((q, i): [Point, Point] => [c.points[i], q]) }));
  const rings = labs.map((l) => ({ c: { x: l.x, y: l.y }, r: l.r + 3 }));
  const buttons = markers.map((m) => ({ c: { x: m.x, y: m.y }, r: MARKER_BUTTON * k + 2 }));
  const boxes: Rect[] = [];
  const crowded = (r: Rect, own?: number, link?: number): number => {
    let n = inside(r, bounds) ? 0 : 1;
    for (const b of boxes) if (overlaps(r, b)) n++;
    rings.forEach((d, i) => {
      if (i !== own && touchesDisc(r, d.c, d.r)) n++;
    });
    for (const d of buttons) if (touchesDisc(r, d.c, d.r)) n++;
    for (const [p, q] of segments) if (segmentHits(grow(r, 2), p, q)) n++;
    for (const c of chords) if (c.link !== link && c.pieces.some(([p, q]) => segmentHits(grow(r, 2), p, q))) n++;
    return n;
  };
  const place = <T extends TextSpec>(spots: T[], own?: number, link?: number): T => {
    let best = spots[0];
    let bestN = Infinity;
    for (const s of spots) {
      const n = crowded(rectOf(s), own, link);
      if (n < bestN) {
        best = s;
        bestN = n;
        if (n === 0) break;
      }
    }
    boxes.push(rectOf(best));
    return best;
  };

  const labTexts = labs.map((l, i): WorldLabText => {
    const spots = labSpots(l, k).map(
      (s): WorldLabText => ({ id: l.id, text: l.name, lines: [l.name, l.status], x: s.x, y: s.y, anchor: s.anchor, fontSize: LAB_FONT * k, letterSpacing: 1.8 * k }),
    );
    return place(spots, i);
  });

  const linkTexts = links.map((l): WorldLinkText => {
    const rows: [number, number, Anchor][] = [
      [0, -9, "middle"],
      [0, 17, "middle"],
      [0, -23, "middle"],
      [0, 31, "middle"],
      [46, -9, "middle"],
      [-46, -9, "middle"],
      [46, 17, "middle"],
      [-46, 17, "middle"],
      [14, -4, "start"],
      [-14, -4, "end"],
    ];
    const spots = rows.map(
      ([dx, dy, anchor]): WorldLinkText => ({ index: l.index, text: l.name, lines: [l.name], x: l.x + dx * k, y: l.y + dy * k, anchor, fontSize: LINK_FONT * k, letterSpacing: 0.8 * k }),
    );
    return place(spots, undefined, l.index);
  });

  let outsideText: TextSpec | null = null;
  if (outside) {
    const rows: [number, number, Anchor][] = [
      [10, -8, "start"],
      [10, 16, "start"],
      [-10, -8, "end"],
      [-10, 16, "end"],
      [0, -14, "middle"],
    ];
    const spots = rows.map(
      ([dx, dy, anchor]): TextSpec => ({ text: "OUTSIDE", lines: ["OUTSIDE"], x: outside.x + dx * k, y: outside.y + dy * k, anchor, fontSize: LINK_FONT * k, letterSpacing: 1.6 * k }),
    );
    outsideText = place(spots);
  }
  return { labs: labTexts, links: linkTexts, outside: outsideText };
}
