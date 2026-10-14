/**
 * The crowd: one small pale dot per agent (#d6e4ff) with a soft glow, read straight from the crowd's
 * positions (the GPU state buffer, or the CPU worker's array uploaded when it changes). Colour and
 * opacity per agent come from the app at each decision tick: a rogue looks like everyone else until
 * it is caught (#ff4d7d) or gets out (hidden here; `internet.ts` draws the escapee).
 */

import { Mesh, MeshBasicNodeMaterial, type InstancedBufferAttribute, type Scene } from "three/webgpu";
import { attribute, exp, instanceIndex, length, max, storage, uniform, varying, vec3, vec4 } from "three/tsl";
import type { PositionsSource } from "../crowd";
import { STRIDE } from "../crowd/integrate";
import { disc, dynamicAttribute, premultiplied, quadGeometry, type BoxUniforms } from "./common";

export interface Agents {
  /** r, g, b (linear), alpha per agent; write, then `commit()`. */
  readonly style: Float32Array;
  commit(): void;
  /** Dot radius in scene units; `undefined` restores the size for a crowd of this many. */
  setRadius(radius?: number): void;
  /** Uploads the CPU crowd's latest positions when they changed. Call once a frame. */
  sync(): void;
  dispose(): void;
}

/** Dot radius in scene units: the design's 1.3 at its ~300-agent density, smaller as the crowd grows. */
export function dotRadius(count: number): number {
  return Math.min(1.3, Math.max(0.55, 1.25 * Math.sqrt(300 / Math.max(count, 1))));
}

/** `radius` overrides the dot size in scene units (the map draws small labs, so its dots are set by hand). */
export function createAgents(scene: Scene, u: BoxUniforms, count: number, source: PositionsSource, radius?: number): Agents {
  const geometry = quadGeometry();
  geometry.instanceCount = count;
  const aStyle = dynamicAttribute(count, 4);
  geometry.setAttribute("aStyle", aStyle);

  let aPos: InstancedBufferAttribute | null = null;
  let centre;
  if (source.kind === "storage") {
    centre = storage(source.attribute, "vec4", count).toReadOnly().element(instanceIndex).xy;
  } else {
    aPos = dynamicAttribute(count, STRIDE);
    geometry.setAttribute("aPos", aPos);
    centre = attribute("aPos", "vec4").xy;
  }

  const style = attribute("aStyle", "vec4");
  const dotR = uniform(radius ?? dotRadius(count));
  const trueRPx = dotR.mul(u.unitPx);
  const rPx = max(trueRPx, 0.7);
  // Below the 0.7 px floor a dot is drawn larger than it is, so its light is scaled back to keep the
  // crowd's total brightness the same; otherwise a phone-sized crowd blows out to a white disc.
  const thin = trueRPx.div(rPx).pow(2);
  const halfUnits = rPx.mul(4).div(u.unitPx);
  // The raw quad corner: once `positionNode` is set, `positionLocal` reads the moved position.
  const corner = attribute("position", "vec3").xy;
  const material = new MeshBasicNodeMaterial();
  material.positionNode = vec3(centre.add(corner.mul(halfUnits)), 0);
  const distPx = length(varying(corner.mul(rPx.mul(4))));
  const core = disc(distPx, rPx);
  const glow = exp(distPx.div(rPx.mul(2.4)).pow(2).negate()).mul(0.2);
  const a = style.a.mul(thin);
  material.colorNode = vec4(style.rgb.mul(core.add(glow)).mul(a), core.mul(a).mul(0.85));
  premultiplied(material);

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 20;
  scene.add(mesh);

  let seen = -1;
  return {
    style: aStyle.array as Float32Array,
    setRadius(r) {
      dotR.value = r ?? dotRadius(count);
    },
    commit() {
      aStyle.needsUpdate = true;
    },
    sync() {
      if (source.kind !== "array" || !aPos || source.version === seen) return;
      seen = source.version;
      (aPos.array as Float32Array).set(source.state);
      aPos.needsUpdate = true;
    },
    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
    },
  };
}
