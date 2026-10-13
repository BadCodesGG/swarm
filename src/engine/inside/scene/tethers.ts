/**
 * Tethers: a smooth quadratic curve from each live subagent to its parent, in the child's model
 * colour (1.4 px, 55%); the selected agent's is 2 px at 90%. A returned agent folds back along its
 * tether and leaves a faint dashed trail (18%) that fades out over `TRAIL_TIME`.
 *
 * `createLineBatch` is the shared instanced curve the web probes use too: per instance two ends, a
 * control point, a width, a dash count, how much of it is drawn, and a colour.
 */

import { Color, Mesh, type Object3D } from "three/webgpu";
import { attribute, float, fract, smoothstep, vec4 } from "three/tsl";
import type { SessionTrace } from "@/lib/trace/types";
import { agentPose, FOLD_TIME, newPose, type Pose } from "../layout";
import { coverage, DESIGN_PX_PER_UNIT, dynamicAttribute, modelColor, ribbonGeometry, ribbonMaterial, type InsideUniforms } from "./common";

/** Trace seconds a returned agent's dashed trail stays. */
export const TRAIL_TIME = 40;

export interface LineSpec {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  /** How far the curve bows sideways, as a fraction of its length. */
  bow: number;
  widthPx: number;
  /** Dash period in design px; 0 is solid. */
  dashPx: number;
  /** Fraction drawn from the A end. */
  reveal: number;
  color: Color;
  alpha: number;
}

export interface LineBatch {
  mesh: Mesh;
  /** Starts a frame's list of lines. */
  begin(): void;
  push(line: LineSpec): void;
  end(): void;
  dispose(): void;
}

export function createLineBatch(parent: Object3D, u: InsideUniforms, capacity: number, renderOrder: number): LineBatch {
  let cap = Math.max(capacity, 1);
  const geometry = ribbonGeometry();
  const names = ["aA", "aB", "aC", "aCol"] as const;
  let attrs = names.map(() => dynamicAttribute(cap, 4));
  const bind = () => names.forEach((n, i) => geometry.setAttribute(n, attrs[i]));
  bind();
  geometry.instanceCount = 0;

  const A = attribute("aA", "vec4");
  const B = attribute("aB", "vec4");
  const C = attribute("aC", "vec4");
  const col = attribute("aCol", "vec4");
  const reveal = C.w;
  const material = ribbonMaterial(
    u,
    (s0) => {
      const s = s0.mul(reveal);
      const k = float(1).sub(s);
      const at = A.xyz.mul(k.mul(k)).add(C.xyz.mul(k.mul(s).mul(2))).add(B.xyz.mul(s.mul(s)));
      const tangent = C.xyz.sub(A.xyz).mul(k).add(B.xyz.sub(C.xyz).mul(s));
      return { at, tangent, widthPx: A.w };
    },
    (s0, across, half) => {
      // Dashes: B.w is the number of dash periods along the full curve; 0 means solid.
      const phase = fract(s0.mul(reveal).mul(B.w));
      const dash = B.w.greaterThan(0).select(smoothstep(0.55, 0.45, phase), float(1));
      const a = col.w.mul(coverage(across, half)).mul(dash);
      return vec4(col.rgb.mul(a), 0);
    },
  );
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  parent.add(mesh);

  let n = 0;
  const grow = () => {
    const old = attrs;
    cap *= 2;
    attrs = names.map(() => dynamicAttribute(cap, 4));
    attrs.forEach((a, i) => (a.array as Float32Array).set(old[i].array as Float32Array));
    bind();
  };

  return {
    mesh,
    begin() {
      n = 0;
    },
    push(l) {
      if (n >= cap) grow();
      const dx = l.bx - l.ax;
      const dy = l.by - l.ay;
      const dz = l.bz - l.az;
      const len = Math.hypot(dx, dy, dz);
      // Control point: the midpoint pushed sideways in the scene plane, and a little toward the viewer.
      const cx = (l.ax + l.bx) / 2 - dy * l.bow;
      const cy = (l.ay + l.by) / 2 + dx * l.bow;
      const cz = (l.az + l.bz) / 2 + len * l.bow * 0.3;
      const dashes = l.dashPx > 0 ? (len * DESIGN_PX_PER_UNIT) / l.dashPx : 0;
      const [a, b, c, k] = attrs.map((x) => x.array as Float32Array);
      a.set([l.ax, l.ay, l.az, l.widthPx], n * 4);
      b.set([l.bx, l.by, l.bz, dashes], n * 4);
      c.set([cx, cy, cz, l.reveal], n * 4);
      k.set([l.color.r, l.color.g, l.color.b, l.alpha], n * 4);
      n++;
    },
    end() {
      for (const a of attrs) a.needsUpdate = true;
      geometry.instanceCount = n;
    },
    dispose() {
      parent.remove(mesh);
      geometry.dispose();
      material.dispose();
    },
  };
}

export interface Tethers {
  setTrace(trace: SessionTrace): void;
  update(t: number, selected: number): void;
  dispose(): void;
}

export function createTethers(parent: Object3D, u: InsideUniforms, capacity: number): Tethers {
  const batch = createLineBatch(parent, u, capacity * 2, 40);
  let trace: SessionTrace | null = null;
  let colors: Color[] = [];
  const child = newPose();
  const par = newPose();
  const rest = newPose();
  const spec: LineSpec = {
    ax: 0,
    ay: 0,
    az: 0,
    bx: 0,
    by: 0,
    bz: 0,
    bow: 0.16,
    widthPx: 1.4,
    dashPx: 0,
    reveal: 1,
    color: new Color(),
    alpha: 0.55,
  };
  const from = (p: Pose, q: Pose) => {
    spec.ax = p.x;
    spec.ay = p.y;
    spec.az = p.z;
    spec.bx = q.x;
    spec.by = q.y;
    spec.bz = q.z;
  };

  return {
    setTrace(next) {
      trace = next;
      colors = next.agents.map((a) => modelColor(a.model));
    },
    update(t, selected) {
      batch.begin();
      if (trace) {
        for (let i = 1; i < trace.agents.length; i++) {
          const a = trace.agents[i];
          if (t < a.spawnT) continue;
          const since = a.returned ? t - a.returnT : -1;
          if (since > TRAIL_TIME) continue;
          agentPose(trace, a.parent, t, par);
          spec.color = colors[i];
          spec.reveal = 1;
          if (since >= 0) {
            // The trail: where it orbited, back to the parent, dashed and fading.
            agentPose(trace, i, a.returnT, rest);
            from(par, rest);
            spec.widthPx = 1.1;
            spec.dashPx = 7;
            spec.alpha = 0.18 * (1 - since / TRAIL_TIME);
            spec.bow = 0.16;
            batch.push(spec);
            if (since >= FOLD_TIME) continue;
          }
          agentPose(trace, i, t, child);
          from(par, child);
          const sel = i === selected;
          spec.widthPx = sel ? 2 : 1.4;
          spec.alpha = sel ? 0.9 : 0.55;
          spec.dashPx = 0;
          spec.bow = 0.16;
          batch.push(spec);
        }
      }
      batch.end();
    },
    dispose() {
      batch.dispose();
    },
  };
}
