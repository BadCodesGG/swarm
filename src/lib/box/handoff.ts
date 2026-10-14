/**
 * The Act 1 to Act 2 hand-off: `/box?from=inside&agents=18&models=opus,sonnet` seeds the Box's cast
 * from the size and the model mix of a sample session.
 *
 * Only a seeded sample ever builds one (`handoffSearch`); an uploaded session yields null, so
 * nothing of a visitor's own trace reaches the URL. `/box` reads the parameters as untrusted: the
 * count is clamped, the model names are an allowlist, and anything else is dropped. The Box itself
 * never shows a model name: it only turns the mix into a cast.
 */

import type { ModelFamily, SessionTrace } from "../trace/types";
import { scenarioToParams } from "./share";
import { DEFAULT_CAST } from "./cast";
import { presetScenario } from "./presets";
import type { Cast, Scenario } from "./world-types";

/** The model names a hand-off may carry. "other" is never sent. */
export const HANDOFF_MODELS = ["opus", "fable", "sonnet", "haiku"] as const satisfies readonly ModelFamily[];
export type HandoffModel = (typeof HANDOFF_MODELS)[number];

/** Agents a hand-off may name; the lab sizes below clamp it again. */
export const HANDOFF_AGENTS = { min: 1, max: 500 } as const;
/** Agents in each lab of a seeded Box. */
export const HANDOFF_LAB_AGENTS = { min: 8, max: 80 } as const;

export interface Handoff {
  agents: number;
  models: HandoffModel[];
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** What a hand-off from a trace carries, or null for anything but a seeded sample. */
export function handoffOf(trace: Pick<SessionTrace, "source" | "agents">): Handoff | null {
  if (trace.source !== "sample") return null;
  const seen = new Set<string>(trace.agents.map((a) => a.model));
  return { agents: clamp(trace.agents.length, HANDOFF_AGENTS.min, HANDOFF_AGENTS.max), models: HANDOFF_MODELS.filter((m) => seen.has(m)) };
}

/** The query string (no leading `?`) for `/box`, or null when the session may not be handed off. */
export function handoffSearch(trace: Pick<SessionTrace, "source" | "agents">): string | null {
  const h = handoffOf(trace);
  if (!h) return null;
  const q = new URLSearchParams({ from: "inside", agents: String(h.agents) });
  if (h.models.length > 0) q.set("models", h.models.join(","));
  return q.toString();
}

/**
 * Reads a hand-off off `/box`'s parameters: `from=inside` is required, the count is a plain integer
 * clamped to the allowed range (a malformed one is dropped), models are matched against the allowlist
 * and deduplicated. A link with no usable count and no usable model is no hand-off.
 */
export function parseHandoff(params: URLSearchParams): Handoff | null {
  if (params.get("from") !== "inside") return null;
  const raw = params.get("agents");
  const count = raw !== null && /^\d{1,6}$/.test(raw) ? clamp(Number(raw), HANDOFF_AGENTS.min, HANDOFF_AGENTS.max) : null;
  const asked = (params.get("models") ?? "").split(",").map((s) => s.trim().toLowerCase());
  const models = HANDOFF_MODELS.filter((m) => asked.includes(m));
  if (count === null && models.length === 0) return null;
  return { agents: count ?? HANDOFF_LAB_AGENTS.max, models };
}

/** A cast with more variety the more model kinds the session used: more sandbaggers and more kinds of hidden goal. */
export function castFor(models: readonly HandoffModel[]): Cast {
  const kinds = clamp(models.length, 1, HANDOFF_MODELS.length);
  return {
    sandbagging: Math.round(5 * (kinds + 1)) / 100,
    hidden: { getOut: DEFAULT_CAST.hidden.getOut, persist: kinds > 1 ? 2 : 1, recruit: kinds > 2 ? 2 : 1 },
  };
}

/** The breakout world with each lab sized by the session's agents and cast by its model mix. */
export function handoffScenario(h: Handoff): Scenario {
  const base = presetScenario("breakout");
  const agents = clamp(h.agents, HANDOFF_LAB_AGENTS.min, HANDOFF_LAB_AGENTS.max);
  const cast = castFor(h.models);
  return { ...base, labs: base.labs.map((lab) => ({ ...lab, agents, cast: { ...cast, hidden: { ...cast.hidden } } })) };
}

/** Parameters that already name a run; they win over a hand-off. */
const NAMES_A_RUN = ["scenario", "preset", "shot", "b", "v"];

/**
 * `/box`'s parameters with a hand-off turned into the share format's `scenario`, which the Box
 * already reads. Untouched when the link names a run of its own or carries no valid hand-off.
 */
export function withHandoff(params: URLSearchParams): URLSearchParams {
  if (NAMES_A_RUN.some((k) => params.has(k))) return params;
  const h = parseHandoff(params);
  if (!h) return params;
  const next = new URLSearchParams(params);
  next.set("scenario", scenarioToParams(handoffScenario(h)).toString());
  return next;
}

/** A hand-off read from the page's own parameters, for the "seeded from Act 1" note. */
export function activeHandoff(params: URLSearchParams): Handoff | null {
  return NAMES_A_RUN.some((k) => params.has(k)) ? null : parseHandoff(params);
}
