/** Display formats shared by the HUD and the narration. Pure. */

import type { ModelFamily, ToolCategory } from "@/lib/trace/types";

const pad = (n: number) => String(n).padStart(2, "0");

/** `hh:mm:ss`, as the design's ELAPSED counter and time read-out. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** `mm:ss`, or `h:mm:ss` from an hour on; the phone's compact time. */
export function shortClock(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(s / 3600);
  return h > 0 ? `${h}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

/** `m:ss`, for how long an agent has run. */
export function runClock(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

/** `812`, `96.4k`, `2.41M`. */
export function compact(n: number): string {
  const v = Math.max(0, Math.round(Number.isFinite(n) ? n : 0));
  if (v < 1000) return String(v);
  if (v < 999_500) return `${(v / 1000).toFixed(v < 100_000 ? 1 : 0)}k`;
  return `${(v / 1e6).toFixed(v < 100e6 ? 2 : 0)}M`;
}

/** The scrubber's label for an idle stretch cut from playback: `12 idle min cut`. */
export function idleCutLabel(removedSeconds: number): string {
  const minutes = Math.round(removedSeconds / 60);
  return removedSeconds >= 60 ? `${minutes} idle min cut` : `${Math.round(removedSeconds)} idle s cut`;
}

export const MODEL_NAMES: Record<ModelFamily, string> = {
  opus: "Opus",
  fable: "Fable",
  sonnet: "Sonnet",
  haiku: "Haiku",
  other: "Other",
};

/** Model family colours as the Deep Field tokens (see `globals.css`). */
export const MODEL_VARS: Record<ModelFamily, string> = {
  opus: "var(--opus)",
  fable: "var(--fable)",
  sonnet: "var(--sonnet)",
  haiku: "var(--haiku)",
  other: "var(--label)",
};

export const CATEGORY_LABELS: Record<ToolCategory, string> = {
  web: "WEB",
  shell: "SHELL",
  files: "FILES",
  edit: "EDIT",
  agents: "AGENTS",
  advisor: "ADVISOR",
  plan: "PLAN",
  mcp: "MCP",
  other: "OTHER",
};
