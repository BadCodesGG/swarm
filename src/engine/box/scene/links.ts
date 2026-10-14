/**
 * The things the labs share, drawn as conduits between them: a faint dashed line in the shell blue
 * from one lab's edge to another's (an arc, or spokes to a hub when three or more share it) with a
 * node at each end. A crossing sends a pulse down the conduit: pink if the reach got in, green if
 * the far lab turned it away, leaving the path it took faintly lit.
 *
 * One quad per conduit. A conduit is a fixed polyline of `SEGMENTS + 1` points (baked into the
 * material when the world is set), so the fragment stage only measures the distance to it and how
 * far along it the nearest point lies.
 */

import { Mesh, MeshBasicNodeMaterial, type Node, type Scene, type UniformNode } from "three/webgpu";
import { color, exp, fract, length, min, mix, positionWorld, select, uniform, varying, vec2, vec4 } from "three/tsl";
import type { LabId } from "@/lib/box/world-types";
import { polylineLength, type LinkShape } from "../world-layout";
import { disc, over, premultiplied, quadGeometry, stroke, type BoxUniforms, type Vec4Node } from "./common";

const MARGIN = 28;
/** Conduit dash: 7 drawn, 6 skipped, world units. */
const DASH = 13;
const BLUE = 0x5f7cbb;
const PINK = 0xff4d7d;
const GREEN = 0x7ee2a8;

/** What a crossing looks like: pink got in, green was turned away. */
export type Tone = "crossed" | "held";

export interface Links {
  /** Replaces the drawn conduits. */
  set(shapes: readonly LinkShape[]): void;
  /** Runs a pulse from one lab to another over link `index`, `progress` 0 to 1; `null` clears it. */
  pulse(index: number, from: LabId, to: LabId, progress: number | null, tone: Tone): void;
  /** Leaves the link faintly lit in the colour of the last crossing over it. */
  light(index: number, tone: Tone | null): void;
  dispose(): void;
}

interface Conduit {
  index: number;
  from: LabId;
  /** Hub links: the conduit runs from its lab to the hub. */
  hub: boolean;
  mesh: Mesh;
  material: MeshBasicNodeMaterial;
  pulseAt: UniformNode<"float", number>;
  pulseTone: UniformNode<"float", number>;
  pulseDir: UniformNode<"float", number>;
  lit: UniformNode<"float", number>;
  litTone: UniformNode<"float", number>;
}

export function createLinks(scene: Scene, u: BoxUniforms): Links {
  let conduits: Conduit[] = [];

  const clear = () => {
    for (const c of conduits) {
      scene.remove(c.mesh);
      c.mesh.geometry.dispose();
      c.material.dispose();
    }
    conduits = [];
  };

  const build = (shape: LinkShape, from: LabId, points: { x: number; y: number }[]): Conduit => {
    const total = polylineLength(points);
    const pulseAt = uniform(-1);
    const pulseTone = uniform(0);
    const pulseDir = uniform(1);
    const lit = uniform(0);
    const litTone = uniform(0);
    const p = varying(positionWorld.xy);
    const px = u.unitPx;

    // The nearest point on the polyline and how far along it (0 to 1, by length) that point is.
    let bestD: Node<"float"> | null = null;
    let bestS: Node<"float"> | null = null;
    let offset = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const ba = vec2(b.x - a.x, b.y - a.y);
      const pa = p.sub(vec2(a.x, a.y));
      const h = pa.dot(ba).div(Math.max(len * len, 1e-6)).clamp(0, 1);
      const d = length(pa.sub(ba.mul(h)));
      const s = h.mul(len).add(offset).div(total);
      if (bestD === null || bestS === null) {
        bestD = d;
        bestS = s;
      } else {
        bestS = select(d.lessThan(bestD), s, bestS);
        bestD = min(bestD, d);
      }
      offset += len;
    }
    const dist = bestD!;
    const along = bestS!;

    const dashOn = fract(along.mul(total).div(DASH)).lessThan(0.55).select(1, 0.15);
    const base = stroke(dist.mul(px), px.mul(0.9)).mul(dashOn);
    let col: Vec4Node = vec4(color(BLUE).mul(base.mul(0.8)), base.mul(0.8));

    // A path a crossing has used stays faintly lit.
    const litCol = mix(color(PINK), color(GREEN), litTone);
    const solid = stroke(dist.mul(px), px.mul(1.6));
    const aura = exp(dist.mul(px).div(5).pow(2).negate()).mul(lit).mul(0.22);
    col = over(vec4(litCol.mul(solid.mul(lit).mul(0.9).add(aura)), solid.mul(lit).mul(0.9)), col);

    // The pulse: a bright head with the part it has travelled lit behind it.
    const pulseCol = mix(color(PINK), color(GREEN), pulseTone);
    const live = pulseAt.greaterThan(0).select(1, 0);
    const behind = pulseDir.greaterThan(0).select(along.lessThan(pulseAt), along.greaterThan(pulseAt)).select(1, 0).mul(live);
    const trail = solid.mul(behind).mul(0.85);
    col = over(vec4(pulseCol.mul(trail), trail), col);
    const gap = along.sub(pulseAt).mul(total);
    const rr = length(vec2(gap, dist)).div(9);
    const glow = exp(rr.mul(rr).negate()).mul(live);
    const core = disc(length(vec2(gap, dist)).mul(px), px.mul(3.2)).mul(live);
    col = col.add(vec4(pulseCol.mul(glow).mul(1.3), glow.mul(0.5)));
    col = over(vec4(color(0xffe1e9).mul(core), core), col);

    // A node at each end, as a small ring.
    const first = points[0];
    const last = points[points.length - 1];
    for (const e of [first, last]) {
      const r = length(p.sub(vec2(e.x, e.y)));
      const ring = stroke(r.sub(3.2).mul(px), px.mul(0.8));
      const hole = disc(r.mul(px), px.mul(3.2));
      col = over(vec4(color(BLUE).mul(ring.mul(0.9)), ring.mul(0.9)), over(vec4(color(0x0a0d18).mul(hole), hole), col));
    }

    const geometry = quadGeometry();
    geometry.instanceCount = 1;
    const material = new MeshBasicNodeMaterial();
    material.colorNode = col;
    premultiplied(material);
    const mesh = new Mesh(geometry, material);
    const xs = points.map((q) => q.x);
    const ys = points.map((q) => q.y);
    const x0 = Math.min(...xs) - MARGIN;
    const x1 = Math.max(...xs) + MARGIN;
    const y0 = Math.min(...ys) - MARGIN;
    const y1 = Math.max(...ys) + MARGIN;
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
    mesh.scale.set((x1 - x0) / 2, (y1 - y0) / 2, 1);
    mesh.frustumCulled = false;
    mesh.renderOrder = 8;
    scene.add(mesh);
    return { index: shape.index, from, hub: shape.hub !== null, mesh, material, pulseAt, pulseTone, pulseDir, lit, litTone };
  };

  const toneNumber = (t: Tone) => (t === "held" ? 1 : 0);

  return {
    set(shapes) {
      clear();
      for (const shape of shapes) for (const c of shape.conduits) conduits.push(build(shape, c.from, c.points));
    },
    pulse(index, from, to, progress, tone) {
      for (const c of conduits) {
        if (c.index !== index) continue;
        c.pulseTone.value = toneNumber(tone);
        if (progress === null) {
          c.pulseAt.value = -1;
        } else if (!c.hub) {
          // The arc is drawn from its first lab to its second.
          const forward = c.from === from;
          c.pulseDir.value = forward ? 1 : -1;
          c.pulseAt.value = Math.max(0.0001, forward ? progress : 1 - progress);
        } else if (c.from === from) {
          c.pulseDir.value = 1;
          c.pulseAt.value = progress < 0.5 ? Math.max(0.0001, progress * 2) : -1;
        } else if (c.from === to) {
          c.pulseDir.value = -1;
          c.pulseAt.value = progress > 0.5 ? Math.max(0.0001, 1 - (progress - 0.5) * 2) : -1;
        } else {
          c.pulseAt.value = -1;
        }
      }
    },
    light(index, tone) {
      for (const c of conduits) {
        if (c.index !== index) continue;
        c.lit.value = tone === null ? 0 : 1;
        c.litTone.value = tone === null ? 0 : toneNumber(tone);
      }
    },
    dispose: clear,
  };
}
