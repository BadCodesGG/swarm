/**
 * The crowd's motion: each agent is a critically damped spring pulled toward the target the app
 * writes at each 10 Hz decision tick, with its speed capped. It decides nothing (Decision 9); the
 * GPU twin in `gpu.ts` runs the same arithmetic in a TSL compute kernel.
 *
 * Units are scene units (one per px of the 760x560 design frame) and seconds. A frame longer than
 * `MAX_SUBSTEP` is split into equal substeps, so the result depends on the time covered, not on how
 * the frames fell.
 */

/** Floats per agent in the state buffer: x, y, vx, vy. */
export const STRIDE = 4;
/** Floats per agent in the target buffer: tx, ty, gain (pull multiplier), spare. */
export const TARGET_STRIDE = 4;
/** Spring stiffness at gain 1, 1/s^2. The damping is critical for it. */
export const STIFFNESS = 18;
/** Scene units per second. */
export const MAX_SPEED = 220;
export const MAX_SUBSTEP = 1 / 60;
/** Agent status as `lib/box` numbers it; escaped agents leave the crowd and stop moving here. */
export const ESCAPED = 2;

export function createCrowdState(count: number): Float32Array {
  return new Float32Array(count * STRIDE);
}

/** Number of substeps for a frame of `dt` seconds; the GPU twin dispatches this many. */
export function substeps(dt: number): number {
  return dt > 0 ? Math.max(1, Math.ceil(dt / MAX_SUBSTEP - 1e-6)) : 0;
}

/** One substep of `h` seconds for agent `i`. Shared by `integrate` and the CPU worker. */
function stepAgent(state: Float32Array, targets: Float32Array, i: number, h: number): void {
  const s = i * STRIDE;
  const t = i * TARGET_STRIDE;
  const k = STIFFNESS * targets[t + 2];
  const d = 2 * Math.sqrt(k);
  let vx = state[s + 2] + (k * (targets[t] - state[s]) - d * state[s + 2]) * h;
  let vy = state[s + 3] + (k * (targets[t + 1] - state[s + 1]) - d * state[s + 3]) * h;
  const speed = Math.hypot(vx, vy);
  if (speed > MAX_SPEED) {
    vx *= MAX_SPEED / speed;
    vy *= MAX_SPEED / speed;
  }
  state[s] += vx * h;
  state[s + 1] += vy * h;
  state[s + 2] = vx;
  state[s + 3] = vy;
}

/** Advances `count` agents by `dt` seconds toward their targets. */
export function integrate(state: Float32Array, targets: Float32Array, status: Uint8Array, count: number, dt: number): void {
  const n = substeps(dt);
  if (n === 0) return;
  const h = dt / n;
  for (let step = 0; step < n; step++) {
    for (let i = 0; i < count; i++) if (status[i] !== ESCAPED) stepAgent(state, targets, i, h);
  }
}

/** Puts every agent on its target, at rest. Used by `?shot=` so the frame never depends on timing. */
export function snap(state: Float32Array, targets: Float32Array, count: number): void {
  for (let i = 0; i < count; i++) {
    state[i * STRIDE] = targets[i * TARGET_STRIDE];
    state[i * STRIDE + 1] = targets[i * TARGET_STRIDE + 1];
    state[i * STRIDE + 2] = 0;
    state[i * STRIDE + 3] = 0;
  }
}
