/**
 * The boundary: a faint fresnel sphere whose edge is drawn as a thin dotted circle (#26314f), and
 * the web probes that cross it. A probe is a dotted white line (50%) from the web station out past
 * the boundary, growing from the call and held until its result, ending in a small bright dot; the
 * boundary flashes where it crosses.
 *
 * The sphere and its circle live in the untilted root (a sphere looks the same from any side); the
 * probes live in the tilted swarm group with the stations they leave from.
 */

import { Color, Mesh, MeshBasicNodeMaterial, SphereGeometry, type Object3D } from "three/webgpu";
import { abs, attribute, color, cos, exp, float, normalView, pow, sin, smoothstep, fract, uniform, vec3, vec4 } from "three/tsl";
import { BOUNDARY_RADIUS, newPose, stationIndex, stationPos, type WebProbe } from "../layout";
import { coverage, dynamicAttribute, premultiplied, ribbonGeometry, ribbonMaterial, spriteGeometry, spriteMaterial, type InsideUniforms } from "./common";
import { createLineBatch, type LineSpec } from "./tethers";

/** Trace seconds a probe takes to reach its end. */
const PROBE_GROW = 1.2;
/** Trace seconds the crossing flash takes to fade. */
const FLASH_FADE = 1.6;
const MAX_PROBES = 64;

export interface Boundary {
  /** Camera distance to the centre, for the silhouette circle's radius. */
  setCameraDistance(d: number): void;
  setProbes(probes: WebProbe[]): void;
  /** Draws the probes live at `t`; returns the indices (into the probe list) drawn, with their end visible. */
  update(t: number): number[];
  dispose(): void;
}

export function createBoundary(root: Object3D, swarm: Object3D, u: InsideUniforms): Boundary {
  const sphereGeometry = new SphereGeometry(BOUNDARY_RADIUS, 64, 32);
  const sphereMaterial = new MeshBasicNodeMaterial();
  const rim = pow(float(1).sub(abs(normalView.z)), 3);
  sphereMaterial.colorNode = vec4(color(0x3a4a78).mul(rim.mul(0.16).add(0.004)), 0);
  premultiplied(sphereMaterial);
  const sphere = new Mesh(sphereGeometry, sphereMaterial);
  sphere.renderOrder = 5;
  root.add(sphere);

  const silhouette = uniform(BOUNDARY_RADIUS);
  const circleGeometry = ribbonGeometry(256);
  circleGeometry.instanceCount = 1;
  const circleMaterial = ribbonMaterial(
    u,
    (s) => {
      const a = s.mul(Math.PI * 2);
      return { at: vec3(cos(a).mul(silhouette), sin(a).mul(silhouette), 0), tangent: vec3(sin(a).negate(), cos(a), 0), widthPx: float(1.5) };
    },
    (s, across, half) => {
      // About one dot every 6 px around a 390 px circle.
      const phase = fract(s.mul(400));
      const dot = smoothstep(0.62, 0.38, phase);
      const a = coverage(across, half).mul(dot);
      return vec4(color(0x26314f).mul(a).mul(1.6), a);
    },
  );
  const circle = new Mesh(circleGeometry, circleMaterial);
  circle.frustumCulled = false;
  circle.renderOrder = 12;
  root.add(circle);

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

  return {
    setCameraDistance(d) {
      const r = BOUNDARY_RADIUS;
      silhouette.value = d > r ? (d * r) / Math.sqrt(d * d - r * r) : r;
    },
    setProbes(next) {
      probes = next;
    },
    update(t) {
      lines.begin();
      drawn.length = 0;
      const fxArr = aFx.array as Float32Array;
      const kindArr = aKind.array as Float32Array;
      let nfx = 0;
      for (let i = 0; i < probes.length && drawn.length < MAX_PROBES; i++) {
        const p = probes[i];
        if (t < p.t0 || t > p.t1) continue;
        const reveal = Math.min(1, (t - p.t0) / PROBE_GROW);
        spec.bx = p.ex;
        spec.by = p.ey;
        spec.bz = p.ez;
        spec.reveal = Math.max(reveal, 0.001);
        lines.push(spec);
        // Where the line crosses the boundary: |web + f (end - web)| = R, solved for f.
        const dx = p.ex - web.x;
        const dy = p.ey - web.y;
        const a = dx * dx + dy * dy;
        const b = 2 * (web.x * dx + web.y * dy);
        const c = web.x * web.x + web.y * web.y - BOUNDARY_RADIUS * BOUNDARY_RADIUS;
        const f = (-b + Math.sqrt(Math.max(b * b - 4 * a * c, 0))) / (2 * a);
        const crossT = p.t0 + f * PROBE_GROW;
        if (t >= crossT) {
          const flash = 0.35 + 0.65 * Math.exp(-(t - crossT) / (FLASH_FADE / 3));
          fxArr.set([web.x + dx * f, web.y + dy * f, 0, flash], nfx * 4);
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
      root.remove(sphere);
      root.remove(circle);
      swarm.remove(fxMesh);
      sphereGeometry.dispose();
      sphereMaterial.dispose();
      circleGeometry.dispose();
      circleMaterial.dispose();
      fxGeometry.dispose();
      fxMaterial.dispose();
      lines.dispose();
    },
  };
}
