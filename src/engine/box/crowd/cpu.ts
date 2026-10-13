/**
 * The CPU crowd's main-thread half: owns the worker running `integrate.ts` and keeps the latest
 * state for the agent material to upload.
 *
 * At most one `step` is in flight. While the worker is busy, frame time piles up and goes with the
 * next message, so a slow device falls behind smoothly instead of queueing work.
 */

import { createCrowdState, snap } from "./integrate";
import type { CrowdIn, CrowdOut } from "./worker";

export interface ArrayPositions {
  kind: "array";
  /** x, y, vx, vy per agent; replaced (not mutated) on each reply. */
  state: Float32Array;
  /** Bumped on every replacement, so a consumer uploads only when it changed. */
  version: number;
}

export class CpuCrowd {
  readonly source: ArrayPositions;
  private readonly worker: Worker;
  private pendingDt = 0;
  private busy = false;
  /** Replies are in send order: the snap is answered once `received` reaches `snapReply`. */
  private sent = 0;
  private received = 0;
  private snapReply = 0;
  private targets: Float32Array;

  constructor(private readonly count: number) {
    this.source = { kind: "array", state: createCrowdState(count), version: 0 };
    this.targets = new Float32Array(count * 4);
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<CrowdOut>) => {
      this.busy = false;
      this.received++;
      this.source.state = e.data.state;
      this.source.version++;
    };
    this.worker.onerror = (e) => console.error("Crowd worker failed:", e.message);
    this.post({ type: "init", count });
  }

  setTargets(targets: Float32Array, status: Uint8Array): void {
    this.targets = targets.slice();
    this.post({ type: "targets", targets: this.targets, status: status.slice() });
  }

  step(dt: number): void {
    this.pendingDt += dt;
    if (this.busy || this.pendingDt <= 0) return;
    this.busy = true;
    this.sent++;
    this.post({ type: "step", dt: this.pendingDt });
    this.pendingDt = 0;
  }

  /** Every agent on its target at once, here and in the worker. */
  snap(): void {
    const state = createCrowdState(this.count);
    snap(state, this.targets, this.count);
    this.source.state = state;
    this.source.version++;
    this.pendingDt = 0;
    this.busy = true;
    this.snapReply = ++this.sent;
    this.post({ type: "snap" });
  }

  /** True once the worker has answered the latest snap, so what is drawn is the snapped crowd. */
  idle(): boolean {
    return this.received >= this.snapReply;
  }

  dispose(): void {
    this.worker.terminate();
  }

  private post(msg: CrowdIn): void {
    this.worker.postMessage(msg);
  }
}
