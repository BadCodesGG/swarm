/**
 * The nebula: every agent a cloud of fine grains in its model's colour, the orchestrator the widest,
 * each tool station a small grey cluster. One instanced sprite mesh draws all of it. A point's place
 * inside its cloud is static (`planNebula`); the cloud's centre, size, colour and how much of it is
 * lit live in a small uniform array the app rewrites each frame, so a frame costs a few dozen CPU
 * writes however many thousand points there are. The look is vertex-stage only, so WebGPU and WebGL2
 * draw the same scene; nothing here needs compute.
 *
 * Clouds fill from the centre outward as the agent's tokens accumulate, appear when the agent
 * spawns, and once it has returned stay where it reported back, dimmed and part desaturated.
 *
 * Grain, not glow: most points are a pixel or two with a tight falloff and a few carry a soft halo.
 * The additive build-up where thousands of points overlap is capped per point from the expected
 * local density (how many of its cloud's points land on the same pixel at this distance), so the
 * centre of a cloud and the orchestrator's core stay fields of grains at any zoom instead of
 * burning out to a disc.
 */

import { Color, InstancedBufferAttribute, Mesh, Vector4, type Object3D } from "three/webgpu";
import { attribute, clamp, cos, dot, exp, float, length, max, mix, modelViewMatrix, sin, smoothstep, step, uniform, uniformArray, varying, vec2, vec3, vec4 } from "three/tsl";
import type { SessionTrace } from "@/lib/trace/types";
import { agentPose, newPose, stationPos } from "../layout";
import { cloudAt, DUST_SLOT, newCloudState, planNebula, RADIUS_SIGMAS, RETURNED_DIM, SLOTS, STATION_SLOT0, type NebulaPlan } from "../nebula-plan";
import { DESIGN_DEPTH, DESIGN_PX_PER_UNIT, modelColor, spriteGeometry, spriteMaterial, type FloatNode, type InsideUniforms, type Vec3Node, type Vec4Node } from "./common";

const STATION_COLOUR = 0xa7b1c2;
const ORCHESTRATOR_GAIN = 0.85;
/** How far a returned cloud's colour moves toward grey. */
const RETURNED_DESATURATION = 0.45;
/**
 * The brightest a pixel is expected to reach from one cloud's points adding up, in units of a point's
 * peak: below the bloom threshold, so grains stay distinct and only the odd stacked pair glows.
 */
const DENSITY_CAP = 0.85;
/** The cloud's point density at its centre, per sigma squared, for the spread mix in `planNebula`. */
const CORE_DENSITY = 0.079;
/** The effective width of that density falloff, in sigmas. */
const DENSITY_SIGMA = 1.25;
/** The hi tier's point budget: the size and brightness of a grain are tuned to it. */
const FULL_BUDGET = 60_000;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

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
  // Three vec4 per slot: (x, y, z, sigma), (r, g, b, lit fraction) and (offset to the parent, points in the slot).
  const data = uniformArray(Array.from({ length: SLOTS * 3 }, () => new Vector4()), "vec4");
  /** The orchestrator's cloud again, as plain uniforms: (x, y, z, sigma) and its lit point count. */
  const root = uniform(new Vector4(0, 0, 0, 1));
  const rootLit = uniform(0);
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
  const sigma = where.w;
  const cloud = vec3(sw, aLocal.z).mul(sigma).mul(breath);
  // A filament point lies along the tether to the parent, with a little scatter either side.
  const filament = toParent.xyz.mul(aLocal.x).add(vec3(aLocal.y, aLocal.z, aLocal.z.mul(0.5)).mul(0.03));
  const centre = where.xyz.add(isFilament.select(filament, cloud));

  // The point's offset from its cloud's centre in view space, in sigmas: how far across the
  // projected cloud it sits (its local density) and whether it is on the near side (its depth cue).
  const offsetView = modelViewMatrix.mul(vec4(cloud, 0)).xyz.div(sigma);
  const across2 = dot(offsetView.xy, offsetView.xy);
  const depthCue = varying(mix(float(0.55), float(1.1), smoothstep(-1.5, 1.5, offsetView.z))) as unknown as FloatNode;
  const viewDepth = max(modelViewMatrix.mul(vec4(where.xyz, 1)).z.negate(), 0.1);

  // A smaller point budget (the lite tier) draws each grain a little larger and brighter, so a cloud
  // reads as a nebula on every tier; the density cap keeps the sum the same where they pile up.
  const budgetScale = Math.min(2, Math.sqrt(FULL_BUDGET / Math.max(budget, 1)));
  const sizeScale = Math.min(1.5, Math.sqrt(budgetScale));
  // Sprites grow with depth to the 0.7 power (`spriteMaterial`); grains take a little more, so they
  // stay about a pixel from any distance the director stands at instead of thinning into nothing.
  const depthRatio = max(viewDepth.div(DESIGN_DEPTH), 1);
  const radius = aMeta.y.mul(sizeScale).mul(depthRatio.pow(0.2));
  const glowing = isGlow;
  const haloRadius = radius.mul(3).add(2.5);
  const quad = mix(radius.mul(1.7).add(0.6), haloRadius, glowing).mul(litV.greaterThan(0.001).select(float(1), float(0)));

  // Expected overlap at this point's pixel: the lit points of its cloud per screen pixel there, times
  // this point's footprint. Past the cap, each point gives up light so the sum stays under it.
  const sigmaPx = sigma.mul(u.pixelScale).div(viewDepth);
  const litCount = toParent.w.mul(look.w);
  const density = litCount.mul(CORE_DENSITY).mul(exp(across2.div(-2 * DENSITY_SIGMA * DENSITY_SIGMA))).div(sigmaPx.mul(sigmaPx));
  const boost = depthRatio.pow(0.7);
  const radiusScreen = radius.mul(boost).mul(u.pixelScale).div(viewDepth.mul(DESIGN_PX_PER_UNIT));
  const footprint = radiusScreen.mul(radiusScreen).mul(Math.PI / 4);
  // Returned clouds pile up round the orchestrator, so its density counts against every other cloud's
  // points too; its own points already carry it.
  // (A plain 0/1 mask, not a conditional: a branch that first emits a node shared with the main flow
  // leaves it unset for the points that skip the branch.)
  const sigma0Px = root.w.mul(u.pixelScale).div(viewDepth);
  const offset0 = modelViewMatrix.mul(vec4(centre.sub(root.xyz), 0)).xy.div(root.w);
  const density0 = rootLit.mul(CORE_DENSITY).mul(exp(dot(offset0, offset0).div(-2 * DENSITY_SIGMA * DENSITY_SIGMA))).div(sigma0Px.mul(sigma0Px));
  const others = density0.mul(step(0.5, aMeta.x));
  const crowd = density.add(others).mul(footprint).mul(isFilament.select(float(0.3), float(1)));
  const gain = varying(float(DENSITY_CAP).div(max(crowd, DENSITY_CAP))) as unknown as FloatNode;

  const material = spriteMaterial(centre, quad, (rPx) => {
    const x = rPx.div(radius);
    const point = exp(x.mul(x).mul(-4));
    // A windowed gaussian: zero at the quad's edge, so a halo never shows its square.
    const h = rPx.div(haloRadius);
    const window = clamp(float(1).sub(h.mul(h)), 0, 1);
    const halo = exp(h.mul(h).mul(-2)).mul(window).mul(0.22).mul(glowing);
    const tint = varying(look.rgb.mul(phase.mul(0.3).add(0.85))) as unknown as Vec3Node;
    const white = glowing.mul(point).mul(0.3);
    const strength = phase.mul(0.5).add(0.75).mul(budgetScale).mul(lit).mul(depthCue).mul(dim).mul(gain);
    const rgb = tint.mul(point.mul(strength).add(halo.mul(lit).mul(gain))).add(vec3(1, 0.97, 0.92).mul(white).mul(lit).mul(gain));
    // Distance cue: what lies well past the focus softens and loses some colour, so far clusters are hazy nebulae.
    const far = varying(smoothstep(1.7, 4.5, viewDepth.div(u.focus))) as unknown as FloatNode;
    const luma = dot(rgb, vec3(0.3, 0.59, 0.11));
    const faded = mix(rgb, vec3(luma).mul(0.85), far.mul(0.35)).mul(float(1).sub(far.mul(0.4)));
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
  const state = newCloudState();
  const dustColour = new Color(0xb8c6e6).multiplyScalar(0.5);
  const colour = new Color();
  const grey = new Color();
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
          arr[s * 3 + 2].set(0, 0, 0, 0);
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
          arr[s * 3 + 2].set(0, 0, 0, n);
        } else {
          const id = plan.slotAgent[s];
          const agent = trace.agents[id];
          cloudAt(trace, id, t, state);
          pose.x = state.x;
          pose.y = state.y;
          pose.z = state.z;
          if (s > 0) {
            agentPose(trace, agent.parent, t, parentPose);
            arr[s * 3 + 2].set(parentPose.x - pose.x, parentPose.y - pose.y, parentPose.z - pose.z, n);
          } else arr[s * 3 + 2].set(0, 0, 0, n);
          // Grows with its tokens (which stop at the return) and appears over the spawn; a returned
          // cloud keeps its size and gives up light and colour instead.
          fill = (s === 0 ? 0.3 : 0.4) + (s === 0 ? 0.7 : 0.6) * frac ** 0.6;
          fill *= Math.min(1, state.life / RETURNED_DIM);
          gain = (s === 0 ? ORCHESTRATOR_GAIN : 0.85 + 0.4 * frac) * (id === selected ? 1.35 : 1);
          gain *= 1 - (1 - RETURNED_DIM) * state.returned;
          modelColor(agent.model, colour);
          if (state.returned > 0) {
            const l = colour.r * 0.3 + colour.g * 0.59 + colour.b * 0.11;
            colour.lerp(grey.setRGB(l, l, l), RETURNED_DESATURATION * state.returned);
          }
        }
        const sigma = plan.sigma[s] * (0.5 + 0.5 * Math.sqrt(fill));
        arr[s * 3].set(pose.x, pose.y, pose.z, sigma);
        arr[s * 3 + 1].set(colour.r * gain, colour.g * gain, colour.b * gain, fill);
        radii[s] = fill > 0 ? sigma * RADIUS_SIGMAS : 0;
        if (s === 0) {
          root.value.set(pose.x, pose.y, pose.z, Math.max(sigma, 1e-3));
          rootLit.value = n * fill;
        }
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
