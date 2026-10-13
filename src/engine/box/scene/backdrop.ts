/**
 * The page ground behind the Box: the design's `radial-gradient(820px 640px at 52% 44%, #0f1529 0%,
 * #0a0d18 55%, #070910 100%)` across the whole canvas, in CSS px, drawn as one clip-space quad.
 */

import { Mesh, MeshBasicNodeMaterial, type Scene } from "three/webgpu";
import { color, length, mix, positionLocal, screenUV, vec2, vec4 } from "three/tsl";
import { premultiplied, quadGeometry, type BoxUniforms } from "./common";

export interface Backdrop {
  dispose(): void;
}

export function createBackdrop(scene: Scene, u: BoxUniforms): Backdrop {
  const geometry = quadGeometry();
  geometry.instanceCount = 1;
  const material = new MeshBasicNodeMaterial();
  material.vertexNode = vec4(positionLocal.xy, 0, 1);
  const px = screenUV.mul(u.viewSize);
  const centre = u.viewSize.mul(vec2(0.52, 0.44));
  const t = length(px.sub(centre).div(vec2(820, 640)));
  const inner = mix(color(0x0f1529), color(0x0a0d18), t.div(0.55).clamp(0, 1));
  const rgb = mix(inner, color(0x070910), t.sub(0.55).div(0.45).clamp(0, 1));
  material.colorNode = vec4(rgb, 1);
  premultiplied(material);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 0;
  scene.add(mesh);
  return {
    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
    },
  };
}
