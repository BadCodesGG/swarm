/**
 * The nebula: every agent a luminous cloud of soft points in its model's colour, the orchestrator
 * the widest and brightest, each tool station a small grey cluster. One instanced sprite mesh draws
 * all of it. A point's place inside its cloud is static (`planNebula`); the cloud's centre, size,
 * colour and how much of it is lit live in a small uniform array the app rewrites each frame, so a
 * frame costs a few dozen CPU writes however many thousand points there are. The look is vertex-stage
 * only, so WebGPU and WebGL2 draw the same scene; nothing here needs compute.
 *
 * Clouds fill from the centre outward as the agent's tokens accumulate, appear when the agent
 * spawns and collapse inward as it returns.
 */

import { Color, InstancedBufferAttribute, Mesh, Vector4, type Object3D } from "three/webgpu";
import { attribute, clamp, cos, dot, exp, float, length, mix, modelViewMatrix, sin, smoothstep, uniform, uniformArray, varying, vec2, vec3, vec4 } from "three/tsl";
import type { SessionTrace } from "@/lib/trace/types";
import { agentPose, FOLD_TIME, newPose, SPAWN_TIME, stationPos } from "../layout";
import { DUST_SLOT, planNebula, RADIUS_SIGMAS, SLOTS, STATION_SLOT0, type NebulaPlan } from "../nebula-plan";
import { modelColor, spriteGeometry, spriteMaterial, type FloatNode, type InsideUniforms, type Vec3Node, type Vec4Node } from "./common";

const STATION_COLOUR = 0xa7b1c2;
const ORCHESTRATOR_GAIN = 0.85;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOut = (u: number) => 1 - (1 - u) ** 3;

export interface Nebula {
  mesh: Mesh;
  /** Points drawn per full cloud set, for the debug read-out. */
  points(): number;
  setTrace(trace: SessionTrace, seed: number): void;
  /**
   * Rewrites every cloud at trace time `t`. `activity` is each station's 0..1 glow, `seconds` the
   * real-time clock that drives the slow swirl (fixed-step under `?shot=`).
   */
  update(t: number, selected: number, activity: ArrayLike<number>, seconds: number): void;
  /** Tokens agent `id`'s cloud has seen by `t`, or 0 when it has no cloud. */
  tokensAt(id: number, t: number): number;
  /** The cloud's radius in world units now (about where it fades out), or 0 when it has no cloud. */
  radiusOf(id: number): number;
  dispose(): void;
}

export function createNebula(parent: Object3D, budget: number, u: InsideUniforms): Nebula {
  // Three vec4 per slot: (x, y, z, sigma), (r, g, b, lit fraction) and the offset to the parent.
  const data = uniformArray(Array.from({ length: SLOTS * 3 }, () => new Vector4()), "vec4");
  const time = uniform(0);

  const aLocal = attribute("aLocal", "vec4");
  const aMeta = attribute("aMeta", "vec4");
  const slot = aMeta.x.toInt().mul(3);
  const where = data.element(slot) as unknown as Vec4Node;
  const look = data.element(slot.add(1)) as unknown as Vec4Node;
  const toParent = data.element(slot.add(2)) as unknown as Vec4Node;
  const rank = aLocal.w;
  const phase = aMeta.w;

  // Appears as the cloud fills past its rank; a hard cut would pop, so it ramps over a tenth.
  const litV = clamp(look.w.sub(rank).mul(10), 0, 1);
  const lit = varying(litV) as unknown as FloatNode;
  // A slow swirl, faster near the centre, plus a breath, so a paused frame is still and a playing one drifts.
  const flat = vec2(aLocal.x, aLocal.y);
  const swirl = time.mul(0.22).div(length(flat).add(0.9));
  const sw = vec2(
    cos(swirl).mul(flat.x).sub(sin(swirl).mul(flat.y)),
    sin(swirl).mul(flat.x).add(cos(swirl).mul(flat.y)),
  );
  const breath = sin(time.mul(0.7).add(phase.mul(6.2832))).mul(0.035).add(1);
  const kind = aMeta.z;
  const isGlow = kind.equal(1).select(float(1), float(0));
  const isFilament = kind.equal(2);
  const dim = kind.greaterThan(1.5).select(float(0.42), float(1));
  const cloud = vec3(sw, aLocal.z).mul(where.w).mul(breath);
  // A filament point lies along the tether to the parent, with a little scatter either side.
  const filament = toParent.xyz.mul(aLocal.x).add(vec3(aLocal.y, aLocal.z, aLocal.z.mul(0.5)).mul(0.03));
  const centre = where.xyz.add(isFilament.select(filament, cloud));

  const radius = aMeta.y;
  const glowing = isGlow;
  const quad = mix(radius.mul(2.2).add(0.8), radius.mul(3.2).add(5), glowing).mul(litV.greaterThan(0.001).select(float(1), float(0)));
  const material = spriteMaterial(centre, quad, (rPx) => {
    const x = rPx.div(radius);
    const point = exp(x.mul(x).mul(-2.8));
    const h = rPx.div(radius.mul(3.4).add(3));
    const halo = exp(h.mul(h).mul(-3)).mul(0.5).mul(glowing);
    // Nearer points burn brighter, so the cloud has depth.
    const depth = mix(float(0.5), float(1.15), smoothstep(-0.9, 0.9, varying(centre.z)));
    const tint = varying(look.rgb.mul(phase.mul(0.3).add(0.85))) as unknown as Vec3Node;
    // The dense centre of a cloud is thinned, so it stays a field of points rather than a disc.
    const thin = mix(float(0.4), float(1), smoothstep(0, 0.4, rank));
    const white = glowing.mul(point).mul(0.45).mul(thin);
    const strength = phase.mul(0.6).add(0.45).mul(lit).mul(depth).mul(thin).mul(dim);
    const rgb = tint.mul(point.mul(strength).add(halo.mul(lit).mul(thin))).add(vec3(1, 0.97, 0.92).mul(white).mul(lit));
    // Distance cue: what lies well past the focus fades and loses its colour, so far clusters are soft nebulae.
    const far = varying(smoothstep(1.7, 4.5, modelViewMatrix.mul(vec4(centre, 1)).z.negate().div(u.focus))) as unknown as FloatNode;
    const luma = dot(rgb, vec3(0.3, 0.59, 0.11));
    const faded = mix(rgb, vec3(luma).mul(0.85), far.mul(0.7)).mul(float(1).sub(far.mul(0.5)));
    return vec4(faded, 0);
  });
  const mesh = new Mesh(spriteGeometry(), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 40;
  mesh.geometry.instanceCount = 0;
  parent.add(mesh);

  let plan: NebulaPlan | null = null;
  let trace: SessionTrace | null = null;
  /** The radius of each slot's cloud this frame, world units. */
  const radii = new Float32Array(SLOTS);
  const pose = newPose();
  const parentPose = newPose();
  const dustColour = new Color(0xb8c6e6).multiplyScalar(0.5);
  const colour = new Color();
  const stationColour = new Color(STATION_COLOUR);

  return {
    mesh,
    points: () => plan?.count ?? 0,
    setTrace(next, seed) {
      trace = next;
      plan = planNebula(next, seed, budget);
      mesh.geometry.dispose();
      const geometry = spriteGeometry();
      geometry.setAttribute("aLocal", new InstancedBufferAttribute(plan.local, 4));
      geometry.setAttribute("aMeta", new InstancedBufferAttribute(plan.meta, 4));
      geometry.instanceCount = plan.count;
      mesh.geometry = geometry;
    },
    update(t, selected, activity, seconds) {
      if (!plan || !trace) return;
      time.value = seconds;
      const arr = data.array as Vector4[];
      for (let s = 0; s < SLOTS; s++) {
        const n = plan.perSlot[s];
        if (!n) {
          arr[s * 3 + 1].set(0, 0, 0, 0);
          radii[s] = 0;
          continue;
        }
        if (s === DUST_SLOT) {
          arr[s * 3].set(0, 0, 0, 1);
          arr[s * 3 + 1].set(dustColour.r, dustColour.g, dustColour.b, 1);
          radii[s] = 0;
          continue;
        }
        const total = plan.total[s];
        const seen = plan.tokensAt(s, t);
        const frac = total > 0 ? clamp01(seen / total) : 1;
        let fill: number;
        let gain: number;
        if (s >= STATION_SLOT0) {
          stationPos(s - STATION_SLOT0, pose);
          fill = 0.14 + 0.86 * frac ** 0.6;
          gain = 0.8 + 1.0 * (activity[s - STATION_SLOT0] ?? 0);
          colour.copy(stationColour);
        } else {
          const id = plan.slotAgent[s];
          const agent = trace.agents[id];
          agentPose(trace, id, t, pose);
          if (s > 0) {
            agentPose(trace, agent.parent, t, parentPose);
            arr[s * 3 + 2].set(parentPose.x - pose.x, parentPose.y - pose.y, parentPose.z - pose.z, 0);
          }
          let life = 1;
          if (s > 0) {
            const fold = agent.returned ? clamp01((t - agent.returnT) / FOLD_TIME) : 0;
            life = easeOut(clamp01((t - agent.spawnT) / SPAWN_TIME)) * (1 - fold) * pose.presence;
          }
          fill = (s === 0 ? 0.3 : 0.4) + (s === 0 ? 0.7 : 0.6) * frac ** 0.6;
          fill *= life;
          gain = (s === 0 ? ORCHESTRATOR_GAIN : 0.85 + 0.4 * frac) * (id === selected ? 1.35 : 1);
          modelColor(agent.model, colour);
        }
        const sigma = plan.sigma[s] * (0.5 + 0.5 * Math.sqrt(fill));
        arr[s * 3].set(pose.x, pose.y, pose.z, sigma);
        arr[s * 3 + 1].set(colour.r * gain, colour.g * gain, colour.b * gain, fill);
        radii[s] = fill > 0 ? sigma * RADIUS_SIGMAS : 0;
      }
    },
    tokensAt: (id, t) => {
      const s = plan && id >= 0 && id < plan.agentSlot.length ? plan.agentSlot[id] : -1;
      return s >= 0 && plan ? plan.tokensAt(s, t) : 0;
    },
    radiusOf: (id) => {
      const s = plan && id >= 0 && id < plan.agentSlot.length ? plan.agentSlot[id] : -1;
      return s >= 0 ? radii[s] : 0;
    },
    dispose() {
      parent.remove(mesh);
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}

