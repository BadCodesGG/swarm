/**
 * Catch markers left on a ring for a few seconds: a pink cross (#ff4d7d) where a layer stopped an
 * agent, and an amber ring (#ffd59a) around a pink dot where the monitor flagged one. The mono
 * labels beside them are DOM text in the page's SVG layer.
 */

import { Mesh, MeshBasicNodeMaterial, type Scene } from "three/webgpu";
import { attribute, color, length, min, mix, uniform, varying, vec2, vec3, vec4 } from "three/tsl";
import type { Marker } from "../tally";
import { disc, dynamicAttribute, premultiplied, quadGeometry, segmentDistance, stroke, type BoxUniforms } from "./common";

export const MARKER_CAPACITY = 32;
const HALF = 12;

export interface Markers {
  /** Draws these markers; `fade` gives each one's opacity. */
  set(markers: readonly Marker[], fade: (m: Marker) => number, scale?: number): void;
  dispose(): void;
}

export function createMarkers(scene: Scene, u: BoxUniforms): Markers {
  const geometry = quadGeometry();
  const aMark = dynamicAttribute(MARKER_CAPACITY, 4);
  geometry.setAttribute("aMark", aMark);
  geometry.instanceCount = 0;

  const m = attribute("aMark", "vec4");
  const scale = uniform(1);
  // The raw quad corner: once `positionNode` is set, `positionLocal` reads the moved position.
  const corner = attribute("position", "vec3").xy;
  const material = new MeshBasicNodeMaterial();
  material.positionNode = vec3(m.xy.add(corner.mul(HALF).mul(scale)), 0);
  const q = varying(corner.mul(HALF));
  const px = u.unitPx.mul(scale);
  const isFlag = m.z;

  const cross = min(segmentDistance(q, vec2(-4, -4), vec2(4, 4)), segmentDistance(q, vec2(-4, 4), vec2(4, -4)));
  const crossCov = stroke(cross.mul(px), u.unitPx.mul(0.9));
  const r = length(q);
  const ringCov = stroke(r.sub(9).mul(px), u.unitPx.mul(0.7));
  const dotCov = disc(r.mul(px), u.unitPx.mul(3.5).mul(scale.max(0.7)));

  const pink = color(0xff4d7d);
  const catchCol = vec4(pink.mul(crossCov), crossCov);
  const flagCol = vec4(color(0xffd59a).mul(ringCov), ringCov).add(vec4(pink.mul(dotCov), dotCov).mul(ringCov.oneMinus()));
  material.colorNode = mix(catchCol, flagCol, isFlag).mul(m.w);
  premultiplied(material);

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 30;
  scene.add(mesh);

  return {
    set(markers, fade, size = 1) {
      scale.value = size;
      const arr = aMark.array as Float32Array;
      const shown = markers.slice(-MARKER_CAPACITY);
      shown.forEach((mk, i) => arr.set([mk.x, mk.y, mk.kind === "flag" ? 1 : 0, fade(mk)], i * 4));
      geometry.instanceCount = shown.length;
      aMark.needsUpdate = true;
    },
    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
    },
  };
}
