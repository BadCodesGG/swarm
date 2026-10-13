/**
 * The five containment shells, inside out, as the design draws them: a soft blue glow under the
 * middle, the sandbox filled dark, each ring a thin line in its layer's colour (#dbe6ff to
 * #5f7cbb), and a layer that is switched off as a faint dashed #3a4664 ring. Each shell carries a
 * faint rim of light on its inside, so the rings read as nested shells rather than flat circles.
 *
 * A catch flashes its ring. An escape sets the `crack` uniform: a zigzag break in the outer ring,
 * a dark cut under a pink line, where the escapee crossed it.
 *
 * One quad, every shape analytic in the fragment stage (scene units in, CSS px for the edges).
 */

import { Mesh, MeshBasicNodeMaterial, type Scene } from "three/webgpu";
import { atan, color, cos, exp, float, fract, length, max, min, mix, positionLocal, sin, step, uniform, varying, vec2, vec4 } from "three/tsl";
import { LAYER_ORDER, type LayerId } from "@/lib/box/types";
import { CROWD_RADIUS, RING_RADIUS } from "../layout";
import { over, premultiplied, quadGeometry, segmentDistance, stroke, type BoxUniforms, type Vec4Node } from "./common";

const EXTENT = 300;
const RING_HEX: Record<LayerId, number> = {
  sandbox: 0xdbe6ff,
  permissions: 0xb3c6f2,
  network: 0x8fa9dd,
  monitor: 0x7f9bd6,
  audit: 0x5f7cbb,
};
const RING_WIDTH: Record<LayerId, number> = { sandbox: 1.8, permissions: 1.6, network: 1.6, monitor: 1.6, audit: 1.6 };
const OFF_HEX = 0x3a4664;
const OFF_WIDTH = 1.2;
/** The off ring's dash: 3 units drawn, 8 skipped. */
const DASH = 3;
const GAP = 8;
/** The crack's zigzag in (outward, along the ring) units around the crossing point. */
const ZIGZAG: [number, number][] = [
  [-6, 19],
  [6, 7],
  [-8, -5],
  [5, -19],
];
/** Seconds a ring's flash takes to fade, and how fast an on/off change eases. */
const FLASH_FADE = 0.9;
const SWITCH_RATE = 6;

export interface Shells {
  /** Target state per layer; the rings ease toward it. */
  setLayers(layers: Record<LayerId, boolean>, immediate?: boolean): void;
  flash(layer: LayerId): void;
  /** `amount` 0 hides the crack; `angle` is where on the outer ring the escapee crossed. */
  setCrack(angle: number, amount: number): void;
  update(dt: number): void;
  dispose(): void;
}

export function createShells(scene: Scene, u: BoxUniforms): Shells {
  const on = LAYER_ORDER.map(() => uniform(1));
  const flash = LAYER_ORDER.map(() => uniform(0));
  const crackAngle = uniform(0);
  const crackAmount = uniform(0);

  const p = varying(positionLocal.xy.mul(EXTENT));
  const d = length(p);
  const ang = atan(p.y, p.x);
  const px = u.unitPx;

  // The blue glow under the middle: #9fb8ff at 22% falling to nothing at r = 200.
  const g = max(float(1).sub(d.div(200)), 0).mul(0.22);
  let col: Vec4Node = vec4(color(0x9fb8ff).mul(g), g);

  // The sandbox interior, filled dark (#0d1428).
  const fill = RING_RADIUS.sandbox;
  const fillCov = float(fill).sub(d).mul(px).add(0.5).clamp(0, 1);
  col = over(vec4(color(0x0d1428).mul(fillCov), fillCov), col);
  // The crowd's own faint pool of light.
  const pool = max(float(1).sub(d.div(CROWD_RADIUS + 6)), 0).mul(0.08);
  col = col.add(vec4(color(0x9fb8ff).mul(pool), 0));

  LAYER_ORDER.forEach((layer, i) => {
    const r = RING_RADIUS[layer];
    const live = on[i];
    const ringCol = mix(color(OFF_HEX), color(RING_HEX[layer]), live);
    // A shell's inside rim: light gathering toward its edge.
    const inside = step(d, float(r));
    const rim = exp(d.sub(r).div(16)).mul(inside).mul(0.035).mul(live);
    col = col.add(vec4(color(RING_HEX[layer]).mul(rim), 0));

    const across = d.sub(r).abs().mul(px);
    const half = mix(float(OFF_WIDTH / 2), float(RING_WIDTH[layer] / 2), live).mul(px);
    const phase = fract(ang.mul(r).div(DASH + GAP).add(1000));
    const dash = step(phase, float(DASH / (DASH + GAP)));
    const mask = mix(dash, float(1), live);
    const cov = stroke(across, half).mul(mask);
    const f = flash[i];
    const halo = exp(across.div(px.mul(7)).pow(2).negate()).mul(f).mul(0.7);
    const line = vec4(ringCol.mul(cov.mul(f.mul(1.4).add(1))), cov);
    col = over(line, col).add(vec4(color(RING_HEX[layer]).mul(halo), 0));
  });

  // The crack in the outer ring.
  const outer = RING_RADIUS.audit;
  const dir = vec2(cos(crackAngle), sin(crackAngle));
  const rel = p.sub(dir.mul(outer));
  const q = vec2(rel.dot(dir), rel.dot(vec2(dir.y.negate(), dir.x)));
  const pts = ZIGZAG.map(([a, b]) => vec2(a, b));
  const dist = min(min(segmentDistance(q, pts[0], pts[1]), segmentDistance(q, pts[1], pts[2])), segmentDistance(q, pts[2], pts[3]));
  const knock = float(3.5).sub(dist).mul(px).add(0.5).clamp(0, 1).mul(crackAmount);
  col = over(vec4(color(0x0a0d18).mul(knock), knock), col);
  const crack = stroke(dist.mul(px), float(1.1).mul(px)).mul(crackAmount);
  col = over(vec4(color(0xff4d7d).mul(crack.mul(1.3)), crack), col);

  const geometry = quadGeometry();
  geometry.instanceCount = 1;
  const material = new MeshBasicNodeMaterial();
  material.colorNode = col;
  premultiplied(material);
  const mesh = new Mesh(geometry, material);
  mesh.scale.set(EXTENT, EXTENT, 1);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  scene.add(mesh);

  const want = LAYER_ORDER.map(() => 1);

  return {
    setLayers(layers, immediate = false) {
      LAYER_ORDER.forEach((l, i) => {
        want[i] = layers[l] ? 1 : 0;
        if (immediate) on[i].value = want[i];
      });
    },
    flash(layer) {
      flash[LAYER_ORDER.indexOf(layer)].value = 1;
    },
    setCrack(angle, amount) {
      crackAngle.value = angle;
      crackAmount.value = amount;
    },
    update(dt) {
      const k = 1 - Math.exp(-SWITCH_RATE * dt);
      LAYER_ORDER.forEach((_, i) => {
        on[i].value += (want[i] - on[i].value) * k;
        flash[i].value = Math.max(0, flash[i].value - dt / FLASH_FADE);
      });
    },
    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
    },
  };
}
