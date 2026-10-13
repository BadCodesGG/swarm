/**
 * The GPU twin of `integrate.ts`: the same damped spring and speed cap as one TSL compute kernel
 * over a storage buffer, dispatched once per substep. Only construct this when
 * `renderer.backend.isWebGPUBackend` is true. The agent material reads the state buffer directly.
 *
 * Targets go up from the CPU at the 10 Hz decision tick: x, y, gain, and the status in w (an
 * escaped agent stops moving, as in `integrate`).
 */

import { StorageInstancedBufferAttribute, type ComputeNode, type WebGPURenderer } from "three/webgpu";
import { Fn, If, float, instanceIndex, length, sqrt, storage, uint, uniform, vec4 } from "three/tsl";
import { ESCAPED, MAX_SPEED, STIFFNESS, STRIDE, substeps, TARGET_STRIDE } from "./integrate";

export class GpuCrowd {
  /** x, y, vx, vy per agent. */
  readonly state: StorageInstancedBufferAttribute;
  private readonly targets: StorageInstancedBufferAttribute;
  private readonly kernel: ComputeNode;
  private readonly h = uniform(1 / 60);

  constructor(
    private readonly renderer: WebGPURenderer,
    private readonly count: number,
  ) {
    this.state = new StorageInstancedBufferAttribute(new Float32Array(count * STRIDE), STRIDE);
    this.state.name = "crowdState";
    this.targets = new StorageInstancedBufferAttribute(new Float32Array(count * TARGET_STRIDE), TARGET_STRIDE);
    this.targets.name = "crowdTargets";
    const state = storage(this.state, "vec4", count);
    const targets = storage(this.targets, "vec4", count).toReadOnly();
    const h = this.h;

    this.kernel = Fn(() => {
      const i = instanceIndex;
      If(i.lessThan(uint(count)), () => {
        const t = targets.element(i).toVar();
        If(t.w.notEqual(float(ESCAPED)), () => {
          const s = state.element(i).toVar();
          const k = float(STIFFNESS).mul(t.z).toVar();
          const d = sqrt(k).mul(2);
          const v = s.zw.add(t.xy.sub(s.xy).mul(k).sub(s.zw.mul(d)).mul(h)).toVar();
          const speed = length(v);
          If(speed.greaterThan(MAX_SPEED), () => {
            v.assign(v.mul(float(MAX_SPEED).div(speed)));
          });
          state.element(i).assign(vec4(s.xy.add(v.mul(h)), v));
        });
      });
    })()
      .compute(count)
      .setName("crowdIntegrate");
  }

  setTargets(targets: Float32Array, status: Uint8Array): void {
    const arr = this.targets.array as Float32Array;
    arr.set(targets.subarray(0, this.count * TARGET_STRIDE));
    for (let i = 0; i < this.count; i++) arr[i * TARGET_STRIDE + 3] = status[i];
    this.targets.needsUpdate = true;
  }

  step(dt: number): void {
    const n = substeps(dt);
    if (n === 0) return;
    this.h.value = dt / n;
    for (let k = 0; k < n; k++) this.renderer.compute(this.kernel);
  }

  /** Overwrites the GPU state: every agent on its target, at rest. */
  snap(targets: Float32Array): void {
    const arr = this.state.array as Float32Array;
    for (let i = 0; i < this.count; i++) {
      arr.set([targets[i * TARGET_STRIDE], targets[i * TARGET_STRIDE + 1], 0, 0], i * STRIDE);
    }
    this.state.needsUpdate = true;
  }

  dispose(): void {
    this.kernel.dispose();
  }
}
