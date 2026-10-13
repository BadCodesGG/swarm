/**
 * The visitor's parsed session, kept in this tab's memory and nowhere else: no storage, no URL, no
 * network. The import screen sets it and navigates to `/inside?source=upload`; Act 1 reads it when it
 * starts. A reload empties it, and Act 1 then says so and plays a sample.
 */

import type { SessionTrace } from "@/lib/trace/types";

let held: SessionTrace | null = null;

export function setImported(trace: SessionTrace): void {
  held = trace;
}

export function getImported(): SessionTrace | null {
  return held;
}

export function clearImported(): void {
  held = null;
}
