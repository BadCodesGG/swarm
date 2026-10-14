/**
 * Subagents: one instanced point each, the hub of its cloud: a small bright centre inside a short
 * halo in the model family's colour, sized by family (Opus largest, Haiku smallest). Kept small and
 * under the bloom threshold so the cloud's grains stay the body of the agent. The selected agent
 * carries a thin white ring.
 *
 * Positions are written from `agentPose` each frame (a few hundred agents at most on screen).
 */

import { Color, Mesh, type Object3D } from "three/webgpu";
import { attribute, exp, float, mix, smoothstep, vec3, vec4 } from "three/tsl";
import type { ModelFamily, SessionTrace } from "@/lib/trace/types";
import { agentPose, newPose } from "../layout";
import { dynamicAttribute, modelColor, spriteGeometry, spriteMaterial } from "./common";

/** Halo and centre radius, design px, by family. */
const SIZE: Record<ModelFamily, [number, number]> = {
  opus: [12, 3.5],
  fable: [11, 3.2],
  sonnet: [10, 3],
  haiku: [9, 2.6],
  other: [10, 3],
};
const RING_GAP = 8;

export interface Agents {
  mesh: Mesh;
  setTrace(trace: SessionTrace): void;
  /** Writes every agent's pose at trace time `t`; `selected` is an agent id or -1. */
  update(t: number, selected: number): void;
  dispose(): void;
}

export function createAgents(parent: Object3D, capacity: number): Agents {
  let cap = Math.max(capacity, 1);
  const geometry = spriteGeometry();
  let aPos = dynamicAttribute(cap, 4);
  let aStyle = dynamicAttribute(cap, 4);
  let aSize = dynamicAttribute(cap, 2);
  geometry.setAttribute("aPos", aPos);
  geometry.setAttribute("aStyle", aStyle);
  geometry.setAttribute("aSize", aSize);
  geometry.instanceCount = 0;

  const pos = attribute("aPos", "vec4");
  const style = attribute("aStyle", "vec4");
  const size = attribute("aSize", "vec2");
  const halo = size.x;
  const centre = size.y;
  const selected = style.w;
  const quad = halo.mul(1.3).add(selected.mul(RING_GAP + 4)).mul(pos.w.greaterThan(0.001).select(float(1), float(0)));
  const material = spriteMaterial(pos.xyz, quad, (rPx) => {
    const col = style.rgb;
    const presence = pos.w;
    const core = smoothstep(centre.add(1), centre.sub(1), rPx);
    const q = rPx.div(centre);
    const inner = mix(vec3(1, 1, 1), col, smoothstep(0.6, 2.2, q)).mul(exp(q.mul(q).mul(-0.35)).mul(0.7));
    const h = rPx.div(halo);
    const glow = col.mul(exp(h.mul(h).mul(-3.4)).mul(0.6).mul(smoothstep(1.28, 0.8, h)));
    const ringR = centre.add(RING_GAP);
    const ring = smoothstep(1.4, 0.4, rPx.sub(ringR).abs()).mul(selected).mul(0.95);
    const rgb = vec3(1.0, 0.99, 0.97).mul(core.mul(1.1)).add(inner.add(glow).mul(float(1).sub(core))).add(vec3(ring));
    return vec4(rgb.mul(presence), core.add(ring).min(1).mul(presence).mul(0.4));
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 70;
  parent.add(mesh);

  let trace: SessionTrace | null = null;
  const p = newPose();
  const c = new Color();

  return {
    mesh,
    setTrace(next) {
      trace = next;
      const n = next.agents.length;
      if (n > cap) {
        cap = n;
        aPos = dynamicAttribute(cap, 4);
        aStyle = dynamicAttribute(cap, 4);
        aSize = dynamicAttribute(cap, 2);
        geometry.setAttribute("aPos", aPos);
        geometry.setAttribute("aStyle", aStyle);
        geometry.setAttribute("aSize", aSize);
      }
      const style = aStyle.array as Float32Array;
      const sizes = aSize.array as Float32Array;
      for (let i = 0; i < n; i++) {
        modelColor(next.agents[i].model, c);
        style.set([c.r, c.g, c.b, 0], i * 4);
        sizes.set(SIZE[next.agents[i].model], i * 2);
      }
      // The orchestrator is the core, not a point.
      sizes.set([0, 0], 0);
      aStyle.needsUpdate = true;
      aSize.needsUpdate = true;
      geometry.instanceCount = n;
    },
    update(t, sel) {
      if (!trace) return;
      const posArr = aPos.array as Float32Array;
      const styleArr = aStyle.array as Float32Array;
      for (let i = 1; i < trace.agents.length; i++) {
        agentPose(trace, i, t, p);
        posArr[i * 4] = p.x;
        posArr[i * 4 + 1] = p.y;
        posArr[i * 4 + 2] = p.z;
        posArr[i * 4 + 3] = p.presence;
        styleArr[i * 4 + 3] = i === sel ? 1 : 0;
      }
      aPos.needsUpdate = true;
      aStyle.needsUpdate = true;
    },
    dispose() {
      parent.remove(mesh);
      geometry.dispose();
      material.dispose();
    },
  };
}
