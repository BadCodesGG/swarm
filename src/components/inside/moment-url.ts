import { serializeMoment } from "@/engine/inside/params";
import type { SampleSize } from "@/lib/trace/generate";
import type { SessionTrace } from "@/lib/trace/types";

export interface MomentState {
  /** The sample's size, or null when the trace is not a known sample. */
  size: SampleSize | null;
  seed: number;
  /** Trace seconds. */
  t: number;
  /** Agent ids; -1 for none. */
  select: number;
  follow: number;
}

const OWNED = ["source", "seed", "t", "select", "follow"];

/**
 * The query string to put in the address bar for this moment, other parameters kept, or null when the
 * URL must not change. An uploaded session returns null always: it can only be re-created from the
 * visitor's files, so nothing about it goes into a link.
 */
export function momentSearch(current: string, trace: Pick<SessionTrace, "source">, m: MomentState): string | null {
  if (!m.size) return null;
  const built = serializeMoment({ source: m.size, seed: m.seed, t: m.t, select: m.select, follow: m.follow }, trace);
  if (built === null) return null;
  const q = new URLSearchParams(current);
  for (const k of OWNED) q.delete(k);
  for (const [k, v] of new URLSearchParams(built)) q.set(k, v);
  return q.toString();
}

/** The parts of a click that decide whether it leaves the page. */
export interface LinkClick {
  /** The anchor's resolved `href`, or null when the click was not on a link. */
  href: string | null;
  target: string;
  button: number;
  modified: boolean;
}

/**
 * Does this click start a navigation away from the page in this tab? The moment sync then stops,
 * because a `replaceState` while the router is still loading the next page puts it back here.
 */
export function leavesPage(click: LinkClick, here: string): boolean {
  if (click.href === null || click.button !== 0 || click.modified || (click.target !== "" && click.target !== "_self")) return false;
  const from = new URL(here);
  const to = new URL(click.href, here);
  return to.origin === from.origin && to.pathname !== from.pathname;
}
