"use client";

import { useSyncExternalStore } from "react";

/** The widest window the phone layout covers (a phone, and a tablet held upright); the desktop layout starts one pixel past it. */
const QUERY = "(max-width: 914px)";

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
