/**
 * Where each breakout step happened: a ring of light under the numbered button the page draws
 * there (pink for a breach, green for a held reach), with a slow pulse running out of it. The
 * ring is sized in screen px so it sits under a 44 px button at any zoom.
 */

import { Mesh, MeshBasicNodeMaterial, type Scene } from "three/webgpu";
import { attribute, color, exp, length, mix, sin, varying, vec3, vec4 } from "three/tsl";
import { dynamicAttribute, premultiplied, quadGeometry, stroke, type BoxUniforms } from "./common";

export const PIN_CAPACITY = 16;
/** Half the quad's side, CSS px. */
const HALF_PX = 54;
/** The ring's radius, CSS px: just outside a 44 px button. */
const RING_PX = 25;

export interface Pin {
  x: number;
  y: number;
  /** "held" draws green. */
  tone: "breach" | "held";
  /** Opacity, 0 to 1. */
  fade: number;
  /** Drawn brighter and larger: the step the page is showing. */
  selected?: boolean;
}

export interface Pins {
  set(pins: readonly Pin[]): void;
  dispose(): void;
}

export function createPins(scene: Scene, u: BoxUniforms): Pins {
  const geometry = quadGeometry();
  const aPin = dynamicAttribute(PIN_CAPACITY, 4);
  geometry.setAttribute("aPin", aPin);
  geometry.instanceCount = 0;

  const pin = attribute("aPin", "vec4");
  const corner = attribute("position", "vec3").xy;
  const material = new MeshBasicNodeMaterial();
  material.positionNode = vec3(pin.xy.add(corner.mul(HALF_PX).div(u.unitPx)), 0);
  const q = varying(corner.mul(HALF_PX));
  const r = length(q);
  // z: 0 breach, 1 held, 2 breach selected, 3 held selected. w: opacity.
  const held = pin.z.mod(2);
  const selected = pin.z.sub(held).div(2);
  const tint = mix(color(0xff4d7d), color(0x7ee2a8), held);
  const ring = stroke(r.sub(RING_PX), mix(0.8, 1.4, selected));
  const glow = exp(r.sub(RING_PX).div(7).pow(2).negate()).mul(mix(0.28, 0.5, selected));
  const phase = sin(u.time.mul(1.6)).mul(0.5).add(0.5);
  const wave = exp(r.sub(RING_PX).sub(phase.mul(14)).div(3).pow(2).negate()).mul(phase.oneMinus()).mul(0.35);
  const a = ring.add(glow).add(wave).mul(pin.w);
  material.colorNode = vec4(tint.mul(a), ring.mul(pin.w).mul(0.9));
  premultiplied(material);

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 32;
  scene.add(mesh);

  return {
    set(pins) {
      const arr = aPin.array as Float32Array;
      const shown = pins.slice(0, PIN_CAPACITY);
      shown.forEach((p, i) => arr.set([p.x, p.y, (p.tone === "held" ? 1 : 0) + (p.selected ? 2 : 0), p.fade], i * 4));
      geometry.instanceCount = shown.length;
      aPin.needsUpdate = true;
    },
    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
    },
  };
}
