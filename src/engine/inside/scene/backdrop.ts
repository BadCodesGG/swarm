/**
 * The space the swarm sits in: a radial light falloff behind everything (#10162b at the centre,
 * #0a0d18 at 55%, #070910 at the edge, centred on the core) and a field of faint dust spread through
 * the whole world, so the camera's travel parallaxes it: near dust slides past faster than far.
 */

import { InstancedBufferAttribute, Mesh, Vector2, type Scene } from "three/webgpu";
import { attribute, color, exp, float, length, mix, screenSize, screenUV, smoothstep, uniform, vec2, vec4 } from "three/tsl";
import { rng } from "@/lib/rng";
import { spriteGeometry, spriteMaterial } from "./common";

const DUST = 900;

export interface Backdrop {
  /** Where the core is on screen, as a 0..1 UV (y down). */
  setCentre(x: number, y: number): void;
  dust: Mesh;
  dispose(): void;
}

export function createBackdrop(scene: Scene): Backdrop {
  const centre = uniform(new Vector2(0.5, 0.48));
  const aspect = screenSize.x.div(screenSize.y);
  // 0 at the core, 1 at the farthest corner (a CSS radial-gradient's farthest-corner).
  const d = length(screenUV.sub(centre).mul(vec2(aspect, 1))).div(length(vec2(aspect.mul(0.5), 0.5)).mul(1.06));
  const inner = mix(color(0x10162b), color(0x0a0d18), smoothstep(0, 0.55, d));
  const bg = mix(inner, color(0x070910), smoothstep(0.55, 1, d));
  scene.backgroundNode = bg;

  const r = rng(77);
  const data = new Float32Array(DUST * 4);
  for (let i = 0; i < DUST; i++) {
    // A ball through the world (flattened a little), denser towards the middle, where the camera spends its time.
    const theta = r() * Math.PI * 2;
    const phi = Math.acos(2 * r() - 1);
    const rad = 3 + 52 * r() ** 1.4;
    data.set([Math.sin(phi) * Math.cos(theta) * rad * 1.2, Math.cos(phi) * rad * 0.7, Math.sin(phi) * Math.sin(theta) * rad, 0.1 + r() ** 3 * 0.4], i * 4);
  }
  const geometry = spriteGeometry();
  geometry.setAttribute("aDust", new InstancedBufferAttribute(data, 4));
  geometry.instanceCount = DUST;
  const aDust = attribute("aDust", "vec4");
  const material = spriteMaterial(aDust.xyz, float(2.2), (rPx) => {
    const light = exp(rPx.mul(rPx).mul(-1.1)).mul(aDust.w);
    return vec4(color(0xb8c6e6).mul(light), 0);
  });
  const dust = new Mesh(geometry, material);
  dust.frustumCulled = false;
  dust.renderOrder = 0;
  scene.add(dust);

  return {
    setCentre(x, y) {
      centre.value.set(x, y);
    },
    dust,
    dispose() {
      scene.remove(dust);
      geometry.dispose();
      material.dispose();
      scene.backgroundNode = null;
    },
  };
}
