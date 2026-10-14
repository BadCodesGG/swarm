/**
 * First-visit tours: which act has been toured, remembered in localStorage under `swarm-tour-<act>`.
 * Every read and write is wrapped, so a browser that throws on storage (privacy modes, blocked
 * cookies) still gets a working page: the tour then shows on each load, and skipping it holds for
 * the rest of the visit through an in-memory set.
 */

export type ActId = "inside" | "box";

export const TOUR_PREFIX = "swarm-tour-";

export const tourKey = (act: ActId): string => `${TOUR_PREFIX}${act}`;

type Reader = Pick<Storage, "getItem">;
type Writer = Pick<Storage, "setItem">;

/** Acts skipped this visit, for a browser whose storage will not hold the flag. */
const dismissedThisVisit = new Set<ActId>();

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Has this act's tour been seen (or skipped)? Unreadable storage counts as not seen. */
export function hasSeenTour(act: ActId, storage: Reader | null = defaultStorage()): boolean {
  if (dismissedThisVisit.has(act)) return true;
  try {
    return storage?.getItem(tourKey(act)) === "1";
  } catch {
    return false;
  }
}

/** Remembers that the tour was seen. A failed write is not an error. */
export function markTourSeen(act: ActId, storage: Writer | null = defaultStorage()): void {
  dismissedThisVisit.add(act);
  try {
    storage?.setItem(tourKey(act), "1");
  } catch {
    // Not remembered across visits; the in-memory set covers this one.
  }
}

/** Test seam: forget this visit's dismissals. */
export function resetTourVisit(): void {
  dismissedThisVisit.clear();
}

export interface TourContext {
  /** `window.location.search`, with or without the leading `?`. */
  search: string;
  /** `navigator.webdriver`: scripted browsers skip the tour unless `?tour=1` asks for it. */
  automated: boolean;
  storage?: Reader | null;
}

/**
 * Should the tour open now? Not once it has been seen; not over a scripted frame (`?shot=`), nor
 * in an automated browser, so the checks that drive the acts are not met by a dialog. `?tour=1`
 * overrides both (never the seen flag), `?tour=0` turns it off.
 */
export function shouldShowTour(act: ActId, { search, automated, storage }: TourContext): boolean {
  const params = new URLSearchParams(search);
  const ask = params.get("tour");
  if (ask === "0") return false;
  if (hasSeenTour(act, storage === undefined ? defaultStorage() : storage)) return false;
  if (ask === "1") return true;
  return !automated && !params.has("shot");
}
