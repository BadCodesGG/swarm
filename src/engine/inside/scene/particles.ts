/**
 * Tool calls in flight (Decision 8): an instanced ring of streaks whose every attribute is baked at
 * emission (start, end, t0, t1, colour) and placed in the vertex stage from the `time` uniform, so
 * a seek is a buffer rewrite and WebGPU and WebGL2 draw the same thing. Nothing is simulated.
 *
 * A streak is a 2.4 px ribbon from a short way behind the head to the head: a white head, a tail
 * fading into the caller's model colour. Its easing matches `flightEase` in `layout.ts`.
 */

import { Color, Mesh, type Object3D } from "three/webgpu";
import { attribute, float, max, mix, pow, select, smoothstep, vec3, vec4 } from "three/tsl";
import type { Flight } from "../layout";
import { MODEL_FAMILIES } from "@/lib/trace/categories";
import { coverage, dynamicAttribute, modelColor, ribbonGeometry, ribbonMaterial, type FloatNode, type InsideUniforms } from "./common";

/** Fraction of the flight's progress the tail spans behind the head. */
const TAIL = 0.28;

export interface Particles {
  mesh: Mesh;
  /** Empties the ring. */
  reset(): void;
  emit(f: Flight): void;
  /** Uploads what was emitted since the last call. */
  flush(): void;
  readonly capacity: number;
  /** Streaks written since the last reset (wraps at capacity). */
  readonly count: number;
  dispose(): void;
}

const ease = (u: FloatNode) => {
  const v = u.clamp(0, 1);
  return float(1).sub(float(1).sub(v).mul(float(1).sub(v)));
};

export function createParticles(parent: Object3D, u: InsideUniforms, capacity: number): Particles {
  const cap = Math.max(capacity, 1);
  const geometry = ribbonGeometry(6);
  const aStart = dynamicAttribute(cap, 4);
  const aEnd = dynamicAttribute(cap, 4);
  const aCol = dynamicAttribute(cap, 3);
  geometry.setAttribute("aStart", aStart);
  geometry.setAttribute("aEnd", aEnd);
  geometry.setAttribute("aCol", aCol);
  geometry.instanceCount = 0;

  const start = attribute("aStart", "vec4");
  const end = attribute("aEnd", "vec4");
  const col = attribute("aCol", "vec3");
  const progress = u.time.sub(start.w).div(max(end.w.sub(start.w), 1e-4));
  const alive = progress.greaterThanEqual(0).and(progress.lessThanEqual(1));
  const material = ribbonMaterial(
    u,
    (s) => {
      const head = ease(progress);
      const tail = ease(progress.sub(TAIL));
      const k = mix(tail, head, s);
      return {
        at: mix(start.xyz, end.xyz, k),
        tangent: end.xyz.sub(start.xyz),
        widthPx: select(alive, float(2.4), float(0)),
      };
    },
    (s, across, half) => {
      const toWhite = smoothstep(0.55, 1, s);
      const rgb = mix(col, vec3(1, 1, 1), toWhite).mul(float(1).add(smoothstep(0.85, 1, s).mul(1.4)));
      // Fade the whole streak as it lands in the station.
      const landing = smoothstep(1, 0.9, progress);
      const a = pow(s, 1.5).mul(coverage(across, half)).mul(landing);
      return vec4(rgb.mul(a), 0);
    },
  );
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 50;
  parent.add(mesh);

  const colors = MODEL_FAMILIES.map((m) => modelColor(m));
  const fallback = new Color(0xc3cad6);
  let n = 0;
  let dirty = false;

  return {
    mesh,
    capacity: cap,
    get count() {
      return n;
    },
    reset() {
      n = 0;
      geometry.instanceCount = 0;
      dirty = true;
    },
    emit(f) {
      const i = n % cap;
      (aStart.array as Float32Array).set([f.sx, f.sy, f.sz, f.t0], i * 4);
      (aEnd.array as Float32Array).set([f.ex, f.ey, f.ez, f.t1], i * 4);
      const c = colors[f.model] ?? fallback;
      (aCol.array as Float32Array).set([c.r, c.g, c.b], i * 3);
      n++;
      dirty = true;
    },
    flush() {
      if (!dirty) return;
      dirty = false;
      aStart.needsUpdate = true;
      aEnd.needsUpdate = true;
      aCol.needsUpdate = true;
      geometry.instanceCount = Math.min(n, cap);
    },
    dispose() {
      parent.remove(mesh);
      geometry.dispose();
      material.dispose();
    },
  };
}
