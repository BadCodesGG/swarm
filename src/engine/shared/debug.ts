/**
 * `window.__swarm`: a registry the smoke and screenshot scripts read. Each act registers its own
 * entry under its name and removes it on dispose; nothing in the app reads it back.
 */

export type DebugEntry = Record<string, unknown>;

declare global {
  interface Window {
    __swarm?: Record<string, DebugEntry>;
  }
}

/** Registers `entry` under `name`; returns the function that removes it (only if it is still the one registered). */
export function registerDebug(name: string, entry: DebugEntry): () => void {
  if (typeof window === "undefined") return () => {};
  const registry = (window.__swarm ??= {});
  registry[name] = entry;
  return () => {
    if (window.__swarm?.[name] === entry) delete window.__swarm[name];
  };
}
