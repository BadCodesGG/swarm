/**
 * Tool stations: small dark discs (#0b0f1b) on a thin #1b2340 ring, each with a 1.4 px rim that is
 * white (#eef2f8) with a soft white glow while a call to it is out, and slate (#5a6680) when idle.
 */

import { Mesh, type Object3D } from "three/webgpu";
import { attribute, color, exp, float, mix, smoothstep, vec4 } from "three/tsl";
import { STATIONS, newPose, stationPos } from "../layout";
import { coverage, dynamicAttribute, spriteGeometry, spriteMaterial } from "./common";

const DISC_PX = 9;

export interface Stations {
  /** Activity per station, 0..1, in `STATIONS` order. */
  update(activity: ArrayLike<number>): void;
  dispose(): void;
}

export function createStations(parent: Object3D): Stations {
  const geometry = spriteGeometry();
  const aSt = dynamicAttribute(STATIONS.length, 4);
  const p = newPose();
  STATIONS.forEach((_, i) => {
    stationPos(i, p);
    (aSt.array as Float32Array).set([p.x, p.y, p.z, 0], i * 4);
  });
  geometry.setAttribute("aSt", aSt);
  geometry.instanceCount = STATIONS.length;
  const st = attribute("aSt", "vec4");
  const material = spriteMaterial(st.xyz, float(30), (rPx) => {
    const active = st.w;
    const fill = smoothstep(DISC_PX + 0.8, DISC_PX - 0.2, rPx);
    const rim = coverage(rPx.sub(DISC_PX), float(0.7));
    const rimColor = mix(color(0x5a6680), color(0xeef2f8).mul(1.25), active);
    const out = rPx.sub(DISC_PX).max(0);
    const glow = color(0xeef2f8).mul(exp(out.mul(out).mul(-1 / 40)).mul(0.32).mul(active).mul(float(1).sub(fill)));
    const inner = color(0xeef2f8).mul(exp(rPx.mul(rPx).mul(-1 / 18)).mul(0.1).mul(active));
    const rgb = color(0x0b0f1b).mul(fill).mul(float(1).sub(rim)).add(rimColor.mul(rim)).add(glow).add(inner.mul(fill));
    return vec4(rgb, fill.max(rim));
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 55;
  parent.add(mesh);

  return {
    update(activity) {
      const arr = aSt.array as Float32Array;
      for (let i = 0; i < STATIONS.length; i++) arr[i * 4 + 3] = activity[i] ?? 0;
      aSt.needsUpdate = true;
    },
    dispose() {
      parent.remove(mesh);
      geometry.dispose();
      material.dispose();
    },
  };
}
