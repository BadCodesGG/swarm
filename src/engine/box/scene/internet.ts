/**
 * Outside the box: the latest escape. A pink (#ff4d7d) dashed trail from where the agent stood,
 * brightening outward, a small dot at each inner shell it crossed, and the escapee itself, a hot
 * pink glow with a white-pink core, carried past the cracked outer shell toward the OUTSIDE panel.
 *
 * `progress` runs 0 to 1 over the run out; the trail reaches the frame edge just ahead of the
 * escapee, which parks at `path.escapeeAt`.
 */

import { Mesh, MeshBasicNodeMaterial, Vector2, type Scene } from "three/webgpu";
import { color, exp, float, fract, length, mix, positionWorld, sin, step, uniform, varying, vec4 } from "three/tsl";
import type { EscapePath } from "../layout";
import { disc, over, premultiplied, quadGeometry, segmentDistance, stroke, type BoxUniforms, type Vec4Node } from "./common";

/** World units of room kept round a trail's ends, for the escapee's glow and the end dots. */
const MARGIN = 60;
/** Trail dash: 4 drawn, 4 skipped. */
const DASH = 8;
/** How far ahead of the escapee the trail is drawn, as a fraction of its length. */
const LEAD = 0.14;
/** Inner shells marked with a dot where the trail crosses them; the outer one cracks instead. */
const DOTS = 4;

export interface Internet {
  /** Shows `path` at `progress` (0 to 1), or hides everything for null. */
  set(path: EscapePath | null, progress: number): void;
  /** The escapee's current position, scene units, or null. */
  escapee(): { x: number; y: number } | null;
  dispose(): void;
}

/** `unit` is world units per lab-local unit: the escapee's glow shrinks with the labs. */
export function createInternet(scene: Scene, u: BoxUniforms, unit = 1): Internet {
  const start = uniform(new Vector2());
  const end = uniform(new Vector2());
  const at = uniform(new Vector2());
  const reveal = uniform(0);
  const shown = uniform(0);
  const dots = Array.from({ length: DOTS }, () => ({ p: uniform(new Vector2()), on: uniform(0) }));

  const p = varying(positionWorld.xy);
  const px = u.unitPx;
  const pink = color(0xff4d7d);

  const seg = end.sub(start);
  const len = length(seg);
  const s = p.sub(start).dot(seg).div(len.mul(len)).clamp(0, 1);
  const dist = segmentDistance(p, start, end);
  const dash = step(fract(s.mul(len).div(DASH * Math.max(unit, 0.6))), float(0.5));
  const ramp = mix(float(0.15), float(1), s);
  const inReveal = step(s, reveal);
  const trail = stroke(dist.mul(px), px).mul(dash).mul(ramp).mul(inReveal);
  let col: Vec4Node = vec4(pink.mul(trail), trail);

  for (const d of dots) {
    const c = disc(length(p.sub(d.p)).mul(px), px.mul(3)).mul(d.on);
    col = over(vec4(pink.mul(c), c), col);
  }
  const startDot = disc(length(p.sub(start)).mul(px), px.mul(4));
  col = over(vec4(pink.mul(startDot), startDot), col);

  // The escapee: #ffd0dc at the centre, #ff4d7d at 80% by 35% of the radius, nothing at 24 units.
  const r = length(p.sub(at)).div(24 * unit);
  const pulse = sin(u.time.mul(3)).mul(0.08).add(1);
  const inner = mix(color(0xffd0dc), pink, r.div(0.35).clamp(0, 1));
  const glowA = mix(float(1), float(0.8), r.div(0.35).clamp(0, 1)).mul(float(1).sub(r.sub(0.35).div(0.65).clamp(0, 1)));
  const glow = glowA.mul(exp(r.mul(r).mul(-1.2))).mul(pulse);
  col = col.add(vec4(inner.mul(glow).mul(1.2), glow.mul(0.6)));
  const core = disc(length(p.sub(at)).mul(px), px.mul(4.5));
  col = over(vec4(color(0xffe1e9).mul(core.mul(1.6)), core), col);

  const geometry = quadGeometry();
  geometry.instanceCount = 1;
  const material = new MeshBasicNodeMaterial();
  material.colorNode = col.mul(shown);
  premultiplied(material);
  const mesh = new Mesh(geometry, material);
  mesh.visible = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = 40;
  scene.add(mesh);

  let current: { x: number; y: number } | null = null;

  return {
    set(path, progress) {
      if (!path) {
        shown.value = 0;
        mesh.visible = false;
        current = null;
        return;
      }
      shown.value = 1;
      const cx = (path.start.x + path.end.x) / 2;
      const cy = (path.start.y + path.end.y) / 2;
      mesh.position.set(cx, cy, 0);
      mesh.scale.set(Math.abs(path.end.x - path.start.x) / 2 + MARGIN, Math.abs(path.end.y - path.start.y) / 2 + MARGIN, 1);
      mesh.visible = true;
      start.value.set(path.start.x, path.start.y);
      end.value.set(path.end.x, path.end.y);
      const e = Math.min(1, Math.max(0, progress)) * path.escapeeAt;
      reveal.value = Math.min(1, e + LEAD * Math.min(1, progress * 4));
      current = { x: path.start.x + (path.end.x - path.start.x) * e, y: path.start.y + (path.end.y - path.start.y) * e };
      at.value.set(current.x, current.y);
      for (let i = 0; i < DOTS; i++) {
        const c = path.crossings[i];
        dots[i].p.value.set(c.x, c.y);
        dots[i].on.value = e >= c.at ? 1 : 0;
      }
    },
    escapee: () => current,
    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
    },
  };
}
