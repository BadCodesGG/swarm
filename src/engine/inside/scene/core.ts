/**
 * The orchestrator's hub: a small warm point (#fff6e8 at the centre, amber by 12 px) at the heart
 * of its cloud, where the tethers and tool calls meet. Additive and under the bloom threshold, so
 * the grains of the cloud stay visible through it: the cloud is the body, this is only its hub.
 */

import { InstancedBufferAttribute, Mesh, type Object3D } from "three/webgpu";
import { attribute, color, exp, float, mix, vec4 } from "three/tsl";
import { spriteGeometry, spriteMaterial } from "./common";

export const CORE_RADIUS_PX = 5;
const HALO_PX = 28;

export interface Core {
  mesh: Mesh;
  dispose(): void;
}

export function createCore(parent: Object3D): Core {
  const geometry = spriteGeometry();
  geometry.setAttribute("aCore", new InstancedBufferAttribute(new Float32Array([0, 0, 0, 1]), 4));
  geometry.instanceCount = 1;
  const aCore = attribute("aCore", "vec4");
  const material = spriteMaterial(aCore.xyz, float(HALO_PX), (rPx) => {
    const q = rPx.div(CORE_RADIUS_PX);
    const point = exp(q.mul(q).mul(-1.6)).mul(0.7);
    const h = rPx.div(HALO_PX * 0.55);
    const halo = exp(h.mul(h).mul(-2)).mul(0.18);
    const rgb = mix(color(0xffb54d), color(0xfff6e8), exp(rPx.div(-7))).mul(point.add(halo));
    return vec4(rgb, 0);
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 60;
  parent.add(mesh);
  return {
    mesh,
    dispose() {
      parent.remove(mesh);
      geometry.dispose();
      material.dispose();
    },
  };
}
