/**
 * Shared pieces of the Box scene. The scene is flat and seen face on through an orthographic
 * camera, in scene units (px of the 760x560 design frame, origin at the rings' centre, y up), so
 * every shape is drawn analytically in its fragment stage with a 1 px soft edge at any zoom.
 *
 * Everything blends premultiplied: rgb beyond alpha adds light (glows), alpha hides what is behind.
 * Nothing writes depth; `renderOrder` sets the stacking.
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
  Vector2,
} from "three/webgpu";
import { clamp, dot, length, max, uniform } from "three/tsl";
import type { Node } from "three/webgpu";

export type FloatNode = Node<"float">;
export type Vec2Node = Node<"vec2">;
export type Vec4Node = Node<"vec4">;

export function createUniforms() {
  return {
    /** CSS px per scene unit (1 at the design's 760x560 frame). */
    unitPx: uniform(1),
    /** Seconds since start, on the frame clock. */
    time: uniform(0),
    /** The canvas, CSS px. */
    viewSize: uniform(new Vector2(1, 1)),
    /** Device px per CSS px. */
    dpr: uniform(1),
    /** 1 draws the map's faint dot grid behind the labs. */
    grid: uniform(0),
  };
}
export type BoxUniforms = ReturnType<typeof createUniforms>;

/** sRGB hex to the linear colour a material works in. */
export const hex = (h: number) => new Color(h);

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
  const attr = new InstancedBufferAttribute(new Float32Array(Math.max(count, 1) * size), size);
  attr.setUsage(DynamicDrawUsage);
  return attr;
}

/** A unit quad, corners at -1 and 1, instanced. */
export function quadGeometry(): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/** Coverage of a stroke of half width `halfPx` at `acrossPx` from its centre line; never thinner than 1 px. */
export function stroke(acrossPx: FloatNode, halfPx: FloatNode): FloatNode {
  const h = max(halfPx, 0.5);
  return clamp(h.add(0.5).sub(acrossPx.abs()), 0, 1).mul(halfPx.mul(2).min(1).max(0.35));
}

/** Coverage of a disc of `radiusPx` at `rPx` from its centre. */
export function disc(rPx: FloatNode, radiusPx: FloatNode): FloatNode {
  return clamp(radiusPx.add(0.5).sub(rPx), 0, 1);
}

/** Distance from `p` to the segment `a`-`b`. */
export function segmentDistance(p: Vec2Node, a: Vec2Node, b: Vec2Node): FloatNode {
  const pa = p.sub(a);
  const ba = b.sub(a);
  const h = clamp(dot(pa, ba).div(dot(ba, ba)), 0, 1);
  return length(pa.sub(ba.mul(h)));
}

/** `over` for premultiplied colour: `top` (rgb premultiplied, a) over `under`. */
export function over(top: Vec4Node, under: Vec4Node): Vec4Node {
  return top.add(under.mul(top.a.oneMinus()));
}
