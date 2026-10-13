/**
 * Frame clock. Delta comes from `performance.now()` (never `THREE.Clock`, which three 0.186 warns
 * about). A URL with `?shot=` gets a fixed 1/60 s step per tick, so screenshots and smoke runs
 * render the same frame every time.
 */

export const FIXED_STEP = 1 / 60;
/** A longer gap is a hidden tab or a stall; the simulation does not try to catch up. */
export const MAX_DELTA = 0.25;

export interface Clock {
  /** Seconds since the previous call (the fixed step when scripted); the first call returns 0 unless fixed. */
  tick(): number;
  /** True when the step is fixed. */
  readonly fixed: boolean;
}

/** True when the URL carries `?shot=`. */
export function isScripted(search: string): boolean {
  return new URLSearchParams(search).has("shot");
}

export function createClock({ fixed = false, now = () => performance.now() }: { fixed?: boolean; now?: () => number } = {}): Clock {
  let last: number | null = null;
  return {
    fixed,
    tick() {
      if (fixed) return FIXED_STEP;
      const t = now();
      const dt = last === null ? 0 : Math.min((t - last) / 1000, MAX_DELTA);
      last = t;
      return Math.max(dt, 0);
    },
  };
}
