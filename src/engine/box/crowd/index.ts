/**
 * The crowd facade: the GPU twin (WebGPU compute) or the CPU worker, behind one shape, as
 * cubic-mm's `Simulation`. It only moves agents toward the targets the app writes at each decision
 * tick; the rules live in `lib/box` (Decision 9).
 */

import type { StorageInstancedBufferAttribute, WebGPURenderer } from "three/webgpu";
import { CpuCrowd, type ArrayPositions } from "./cpu";
import { GpuCrowd } from "./gpu";

export type { ArrayPositions } from "./cpu";

/** Where the agent material reads positions: the GPU state buffer, or an array it uploads. */
export type PositionsSource = { kind: "storage"; attribute: StorageInstancedBufferAttribute } | ArrayPositions;

export interface CrowdOptions {
  renderer: WebGPURenderer;
  isWebGPU: boolean;
  count: number;
  /** The CPU worker even on WebGPU (`?sim=cpu`). */
  forceCpu?: boolean;
}

export interface Crowd {
  mode: "gpu" | "cpu";
  count: number;
  /** x, y, gain, spare per agent (scene units), and `lib/box` status per agent. */
  setTargets(targets: Float32Array, status: Uint8Array): void;
  step(dt: number): void;
  /** Puts every agent on its last target at rest (the scripted shot). */
  snap(): void;
  /** False while the CPU worker still owes a reply; always true on the GPU. */
  idle(): boolean;
  positions: PositionsSource;
  dispose(): void;
}

export function createCrowd({ renderer, isWebGPU, count, forceCpu = false }: CrowdOptions): Crowd {
  if (isWebGPU && !forceCpu) {
    const g = new GpuCrowd(renderer, count);
    let last: Float32Array = new Float32Array(count * 4);
    return {
      mode: "gpu",
      count,
      setTargets(targets, status) {
        last = targets;
        g.setTargets(targets, status);
      },
      step: (dt) => g.step(dt),
      snap: () => g.snap(last),
      idle: () => true,
      positions: { kind: "storage", attribute: g.state },
      dispose: () => g.dispose(),
    };
  }
  const c = new CpuCrowd(count);
  return {
    mode: "cpu",
    count,
    setTargets: (targets, status) => c.setTargets(targets, status),
    step: (dt) => c.step(dt),
    snap: () => c.snap(),
    idle: () => c.idle(),
    positions: c.source,
    dispose: () => c.dispose(),
  };
}
