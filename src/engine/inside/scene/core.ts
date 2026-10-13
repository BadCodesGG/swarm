/**
 * The orchestrator: a warm white disc (#fff6e8, 26 px) inside a wide amber bloom that fades out by
 * about 150 px. Bright enough to cross the bloom threshold; the halo itself is drawn, not left to
 * the bloom, so the WebGL2 lite path keeps the same shape.
 */

import { InstancedBufferAttribute, Mesh, type Object3D } from "three/webgpu";
import { attribute, color, exp, float, max, mix, pow, smoothstep, vec4 } from "three/tsl";
import { spriteGeometry, spriteMaterial } from "./common";

export const CORE_RADIUS_PX = 26;
const HALO_PX = 160;

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
    const disc = smoothstep(CORE_RADIUS_PX + 1.2, CORE_RADIUS_PX - 1.2, rPx);
    const edge = max(float(1).sub(rPx.div(150)), 0);
    const halo = mix(color(0xffb54d), color(0xffd59a), exp(rPx.div(-45)))
      .mul(pow(edge, 2.4).mul(0.55).add(exp(rPx.sub(CORE_RADIUS_PX).max(0).div(-14)).mul(0.6)));
    const rgb = color(0xfff6e8).mul(disc.mul(1.35)).add(halo.mul(float(1).sub(disc)));
    return vec4(rgb, disc);
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
