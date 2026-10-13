/**
 * A human prompt arrives as a faint ring contracting from the boundary into the core. Minimal for
 * now: one ring for the latest prompt.
 */

import { Mesh, type Object3D } from "three/webgpu";
import { color, cos, float, sin, uniform, vec3, vec4 } from "three/tsl";
import { BOUNDARY_RADIUS } from "../layout";
import { coverage, ribbonGeometry, ribbonMaterial, type InsideUniforms } from "./common";

/** Trace seconds a prompt ring takes to reach the core. */
export const PULSE_TIME = 4;

export interface Pulses {
  /** `since`: trace seconds since the latest prompt (negative or Infinity for none). */
  update(since: number): void;
  dispose(): void;
}

export function createPulses(root: Object3D, u: InsideUniforms): Pulses {
  const radius = uniform(0);
  const alpha = uniform(0);
  const geometry = ribbonGeometry(192);
  geometry.instanceCount = 1;
  const material = ribbonMaterial(
    u,
    (s) => {
      const a = s.mul(Math.PI * 2);
      return { at: vec3(cos(a).mul(radius), sin(a).mul(radius), 0), tangent: vec3(sin(a).negate(), cos(a), 0), widthPx: float(1.6) };
    },
    (_s, across, half) => {
      const a = coverage(across, half).mul(alpha);
      return vec4(color(0xdbe6ff).mul(a), 0);
    },
  );
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 14;
  mesh.visible = false;
  root.add(mesh);
  return {
    update(since) {
      const k = since / PULSE_TIME;
      mesh.visible = k >= 0 && k < 1;
      if (!mesh.visible) return;
      const e = 1 - (1 - k) ** 2;
      radius.value = BOUNDARY_RADIUS * (1 - e) + 0.3 * e;
      alpha.value = 0.45 * Math.sin(Math.PI * k);
    },
    dispose() {
      root.remove(mesh);
      geometry.dispose();
      material.dispose();
    },
  };
}
