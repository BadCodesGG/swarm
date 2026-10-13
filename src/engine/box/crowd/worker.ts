/**
 * Runs `integrate.ts` off the main thread for the CPU crowd (the WebGL2 fallback, or `?sim=cpu`).
 *
 * In:  `init` once, `targets` at each decision tick, `step` with the time to cover, `snap`.
 * Out: one `stepped` reply per `step` or `snap`, with a fresh copy of the state (transferred).
 */

import { createCrowdState, integrate, snap } from "./integrate";

export type CrowdIn =
  | { type: "init"; count: number }
  | { type: "targets"; targets: Float32Array; status: Uint8Array }
  | { type: "step"; dt: number }
  | { type: "snap" };

export interface CrowdOut {
  type: "stepped";
  state: Float32Array;
}

let count = 0;
let state: Float32Array = createCrowdState(0);
let targets: Float32Array = new Float32Array(0);
let status: Uint8Array = new Uint8Array(0);

// Typed structurally: the project compiles against the DOM lib, not the worker one.
const scope = self as unknown as {
  onmessage: ((e: { data: CrowdIn }) => void) | null;
  postMessage(m: CrowdOut, o: { transfer: Transferable[] }): void;
};

const reply = () => {
  const copy = state.slice();
  scope.postMessage({ type: "stepped", state: copy }, { transfer: [copy.buffer] });
};

scope.onmessage = (e) => {
  const msg = e.data;
  switch (msg.type) {
    case "init":
      count = msg.count;
      state = createCrowdState(count);
      targets = new Float32Array(count * 4);
      status = new Uint8Array(count);
      return;
    case "targets":
      targets = msg.targets;
      status = msg.status;
      return;
    case "step":
      integrate(state, targets, status, count, msg.dt);
      return reply();
    case "snap":
      snap(state, targets, count);
      return reply();
  }
};
