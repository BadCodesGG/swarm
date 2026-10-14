/**
 * Shared pieces of the Act 1 scene: the uniforms every material reads, the Deep Field colours, and
 * the two instanced shapes everything is drawn with.
 *
 * - Sprites: a camera-facing quad per instance, sized in design px (the 1440x900 hero framing, 100
 *   px per world unit), so a glow scales with the scene and still shrinks a little with depth.
 * - Ribbons: a strip of `RIBBON_SEGMENTS` pieces per instance whose centre line is a curve the
 *   material computes in the vertex stage, a constant number of CSS px wide at any depth.
 *
 * Both blend premultiplied: rgb beyond alpha adds light (glows), alpha hides what is behind (the
 * dark station discs). Nothing writes depth; `renderOrder` sets the stacking.
 */

import {
  Color,
  CustomBlending,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  MeshBasicNodeMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
} from "three/webgpu";
import { cameraProjectionMatrix, cross, float, length, max, modelViewMatrix, positionLocal, pow, select, uniform, varying, vec3, vec4 } from "three/tsl";
import type { Node } from "three/webgpu";
import type { ModelFamily } from "@/lib/trace/types";

export type FloatNode = Node<"float">;
export type Vec3Node = Node<"vec3">;
export type Vec4Node = Node<"vec4">;

export function createUniforms() {
  return {
    /** Playback seconds (trace time with idle stretches cut), written by the app each frame. */
    playTime: uniform(0),
    /** CSS px per world unit at view depth 1: projection[1][1] * half the canvas height. */
    pixelScale: uniform(450),
    /** Screen px per design px: 1 at the 1440x900 hero framing (100 px per world unit), less on a phone. */
    sizeScale: uniform(1),
    /** Distance from the eye to what the camera looks at, world units: the nebula fades what is far past it. */
    focus: uniform(10),
  };
}
export type InsideUniforms = ReturnType<typeof createUniforms>;

/** sRGB hex to the linear colour a material works in. */
export const hex = (h: number) => new Color(h);

export const MODEL_HEX: Record<ModelFamily, number> = {
  opus: 0xffb54d,
  fable: 0xa78bff,
  sonnet: 0x4fd8eb,
  haiku: 0x7ee2a8,
  other: 0xc3cad6,
};

/** Model family colours in `MODEL_FAMILIES` order, linear. */
export function modelColor(model: ModelFamily, out = new Color()): Color {
  return out.setHex(MODEL_HEX[model]);
}

export function premultiplied(material: MeshBasicNodeMaterial): MeshBasicNodeMaterial {
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = false;
  material.blending = CustomBlending;
  material.blendSrc = OneFactor;
  material.blendDst = OneMinusSrcAlphaFactor;
  material.blendSrcAlpha = OneFactor;
  material.blendDstAlpha = OneMinusSrcAlphaFactor;
  return material;
}

/** An instanced attribute the CPU rewrites. */
export function dynamicAttribute(count: number, size: number): InstancedBufferAttribute {
  const attr = new InstancedBufferAttribute(new Float32Array(count * size), size);
  attr.setUsage(DynamicDrawUsage);
  return attr;
}

export function spriteGeometry(): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/**
 * A camera-facing sprite of `radiusPx` design px around `centre`. `shade` gets the distance from the
 * centre in design px and returns premultiplied colour.
 */
export function spriteMaterial(
  centre: Vec3Node,
  radiusPx: FloatNode,
  shade: (rPx: FloatNode) => Vec4Node,
): MeshBasicNodeMaterial {
  const corner = positionLocal.xy;
  const centreView = modelViewMatrix.mul(vec4(centre, 1)).xyz;
  // Seen from further than the design's 9 units a sprite grows a little (to the 0.7 power), so a
  // far cluster stays a visible haze instead of shrinking to nothing as the camera pulls back.
  const boost = pow(max(centreView.z.negate().div(DESIGN_DEPTH), 1), 0.7);
  const worldRadius = radiusPx.div(DESIGN_PX_PER_UNIT).mul(boost);
  const material = new MeshBasicNodeMaterial();
  material.vertexNode = cameraProjectionMatrix.mul(vec4(centreView.add(vec3(corner.mul(worldRadius), 0)), 1));
  const rPx = length(varying(corner.mul(radiusPx)));
  material.colorNode = shade(rPx);
  return premultiplied(material);
}

/** Design px per world unit at the hero framing. */
export const DESIGN_PX_PER_UNIT = 100;
/** Eye to subject distance at the hero framing, world units. */
export const DESIGN_DEPTH = 9;

export const RIBBON_SEGMENTS = 32;

/** x is the side (-1 or 1), y runs 0 to 1 along the ribbon. */
export function ribbonGeometry(segments = RIBBON_SEGMENTS): InstancedBufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const s = i / segments;
    pos.push(-1, s, 0, 1, s, 0);
    if (i < segments) {
      const a = i * 2;
      idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }
  const g = new InstancedBufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export interface RibbonVertex {
  /** World position of the centre line, as a function of `s` in [0, 1]. */
  at: Vec3Node;
  /** World tangent there (any length). */
  tangent: Vec3Node;
  /** Line width, CSS px; 0 hides the instance. */
  widthPx: FloatNode;
}

/**
 * Builds a ribbon material. `vertex(s)` returns the centre line; `shade(s, acrossPx, halfPx)` gets
 * the position along it, the signed distance from the centre line in px and the half width, and
 * returns premultiplied colour (`coverage` below gives a 1 px anti-aliased edge).
 */
export function ribbonMaterial(
  u: InsideUniforms,
  vertex: (s: FloatNode) => RibbonVertex,
  shade: (s: FloatNode, acrossPx: FloatNode, halfPx: FloatNode) => Vec4Node,
): MeshBasicNodeMaterial {
  const s = positionLocal.y;
  const side = positionLocal.x;
  const { at, tangent, widthPx } = vertex(s);
  const pView = modelViewMatrix.mul(vec4(at, 1)).xyz;
  const tView = modelViewMatrix.mul(vec4(tangent, 0)).xyz;
  const n0 = cross(tView, pView.negate());
  const nLen = length(n0);
  const normal = select(nLen.greaterThan(1e-6), n0.div(nLen), vec3(1, 0, 0));
  const depth = max(pView.z.negate(), 0.1);
  // Lines thin with the scene on a small screen, but not below 60%. One extra px each side for the
  // anti-aliased edge.
  const halfPx = widthPx.mul(0.5).mul(max(u.sizeScale, 0.6));
  const drawnPx = select(widthPx.greaterThan(0), halfPx.add(1), float(0));
  const world = drawnPx.mul(depth).div(u.pixelScale);
  const material = new MeshBasicNodeMaterial();
  material.vertexNode = cameraProjectionMatrix.mul(vec4(pView.add(normal.mul(side).mul(world)), 1));
  material.colorNode = shade(varying(s), varying(side.mul(drawnPx)), varying(halfPx));
  return premultiplied(material);
}

/** Coverage of a line of half width `halfPx` at `acrossPx` from its centre, with a 1 px soft edge. */
export function coverage(acrossPx: FloatNode, halfPx: FloatNode): FloatNode {
  return max(halfPx.add(0.5).sub(acrossPx.abs()), 0).min(1).mul(max(halfPx.mul(2), 1).min(1));
}
