/**
 * The web probes: a dotted white line (50%) from the web station out into the dark, growing from
 * the call and held until its result, ending in a small bright dot. A flash marks where the probe
 * leaves the machine, a short way out from the station. (There is no boundary shell any more: the
 * camera travels through the scene, so the edge is the probe's own gate.)
 */

import { Color, Mesh, type Object3D } from "three/webgpu";
import { attribute, color, exp, float, smoothstep, vec3, vec4 } from "three/tsl";
import { liveProbes, newPose, PROBE_GROW, stationIndex, stationPos, type WebProbe } from "../layout";
import { dynamicAttribute, spriteGeometry, spriteMaterial, type InsideUniforms } from "./common";
import { createLineBatch, type LineSpec } from "./tethers";

/** Trace seconds the crossing flash takes to fade. */
const FLASH_FADE = 1.6;
/** Probes drawn at once; each takes at most two fx sprites (its crossing flash and its end dot). */
const MAX_PROBES = 64;
/** Fraction of a probe's length at which it passes its gate. */
const GATE = 0.3;

export interface Boundary {
  setProbes(probes: WebProbe[]): void;
  /** Draws the probes live at `t`; returns the indices (into the probe list) drawn, with their end visible. */
  update(t: number): number[];
  dispose(): void;
}

export function createBoundary(swarm: Object3D, u: InsideUniforms): Boundary {
  const lines = createLineBatch(swarm, u, MAX_PROBES, 45);

  // End dots and crossing flashes: one sprite batch, aFx = position + kind-specific intensity.
  const fxGeometry = spriteGeometry();
  const aFx = dynamicAttribute(MAX_PROBES * 2, 4);
  const aKind = dynamicAttribute(MAX_PROBES * 2, 1);
  fxGeometry.setAttribute("aFx", aFx);
  fxGeometry.setAttribute("aKind", aKind);
  fxGeometry.instanceCount = 0;
  const fx = attribute("aFx", "vec4");
  const kind = attribute("aKind", "float");
  // kind 0: a probe's end dot; kind 1: a flash on the boundary.
  const fxMaterial = spriteMaterial(fx.xyz, kind.mul(10).add(14), (rPx) => {
    const isFlash = kind;
    const dotCore = smoothstep(2.6, 1.6, rPx);
    const dotGlow = exp(rPx.mul(rPx).mul(-1 / 22)).mul(0.55);
    const dot = vec3(1, 1, 1).mul(dotCore.mul(1.7).add(dotGlow));
    const flash = color(0xdbe6ff).mul(exp(rPx.mul(rPx).mul(-1 / 40)).mul(0.9).add(smoothstep(2.4, 1.2, rPx)));
    const rgb = dot.mul(float(1).sub(isFlash)).add(flash.mul(isFlash)).mul(fx.w);
    return vec4(rgb, 0);
  });
  const fxMesh = new Mesh(fxGeometry, fxMaterial);
  fxMesh.frustumCulled = false;
  fxMesh.renderOrder = 65;
  swarm.add(fxMesh);

  let probes: WebProbe[] = [];
  const web = stationPos(stationIndex("web"), newPose());
  const white = new Color(0xffffff);
  const spec: LineSpec = { ax: web.x, ay: web.y, az: web.z, bx: 0, by: 0, bz: 0, bow: 0, widthPx: 1.3, dashPx: 5, reveal: 1, color: white, alpha: 0.5 };
  const drawn: number[] = [];
  const live: number[] = [];

  return {
    setProbes(next) {
      probes = next;
    },
    update(t) {
      lines.begin();
      drawn.length = 0;
      const fxArr = aFx.array as Float32Array;
      const kindArr = aKind.array as Float32Array;
      let nfx = 0;
      for (const i of liveProbes(probes, t, MAX_PROBES, live)) {
        const p = probes[i];
        const reveal = Math.min(1, (t - p.t0) / PROBE_GROW);
        spec.bx = p.ex;
        spec.by = p.ey;
        spec.bz = p.ez;
        spec.reveal = Math.max(reveal, 0.001);
        lines.push(spec);
        // The gate: a fixed fraction of the way out.
        const dx = p.ex - web.x;
        const dy = p.ey - web.y;
        const dz = p.ez - web.z;
        const f = GATE;
        const crossT = p.t0 + f * PROBE_GROW;
        if (t >= crossT) {
          const flash = 0.35 + 0.65 * Math.exp(-(t - crossT) / (FLASH_FADE / 3));
          fxArr.set([web.x + dx * f, web.y + dy * f, web.z + dz * f, flash], nfx * 4);
          kindArr[nfx++] = 1;
        }
        if (reveal >= 1) {
          fxArr.set([p.ex, p.ey, p.ez, 1], nfx * 4);
          kindArr[nfx++] = 0;
          drawn.push(i);
        }
      }
      lines.end();
      aFx.needsUpdate = true;
      aKind.needsUpdate = true;
      fxGeometry.instanceCount = nfx;
      return drawn;
    },
    dispose() {
      swarm.remove(fxMesh);
      fxGeometry.dispose();
      fxMaterial.dispose();
      lines.dispose();
    },
  };
}
