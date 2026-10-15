"use client";

import { useSyncExternalStore } from "react";

/**
 * The phone layout's windows (a phone, and a tablet held upright): under 915 px, the same range as the components'
 * `max-[915px]` classes (Tailwind's `width < 915px`), so the page and its styles never disagree at the edge. The
 * desktop layout starts at 915.
 */
const QUERY = "(width < 915px)";

const subscribe = (onChange: () => void) => {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
};

/** True at the phone layout's widths; follows the window as it is resized or turned. */
export function usePhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
