/**
 * The "NOW" panel's plain-English line: one or two sentences about the trace at time `t`. Pure and
 * deterministic. It names live agents by model and says what tool category each is using; it never
 * quotes session text.
 */

import type { Timeline } from "@/lib/trace/timeline";
import type { ModelFamily, ToolCategory, TraceAgent } from "@/lib/trace/types";
import { MODEL_NAMES } from "./format";

/** An agent counts as "using" a tool for this many trace seconds after its call. */
const RECENT = 30;
const MAX_CLAUSES = 3;
/** Up to this many live helpers are named one by one. */
const SMALL = 3;
const MODEL_ORDER: readonly ModelFamily[] = ["opus", "fable", "sonnet", "haiku", "other"];

const ACTIVITY: Record<ToolCategory | "thinking", string> = {
  web: "searching the web",
  shell: "running commands",
  files: "reading and searching files",
  edit: "editing files",
  agents: "launching more helpers",
  advisor: "asking an advisor",
  plan: "updating the plan",
  mcp: "using an outside tool",
  other: "using a tool",
  thinking: "thinking it over",
};

/** The category of the agent's latest call within `RECENT` seconds of `t`, or null. */
export function currentActivity(tl: Timeline, id: number, t: number): ToolCategory | null {
  const { events } = tl.trace;
  for (let i = tl.indexAt(t) - 1; i >= 0; i--) {
    const e = events[i];
    if (e.t < t - RECENT) return null;
    if (e.agent === id && (e.kind === "call" || e.kind === "spawn")) return e.category ?? "other";
  }
  return null;
}

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const count = (n: number) => NUMBER_WORDS[n] ?? String(n);

function join(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function byModel(agents: TraceAgent[]): [ModelFamily, number][] {
  const n = new Map<ModelFamily, number>();
  for (const a of agents) n.set(a.model, (n.get(a.model) ?? 0) + 1);
  return MODEL_ORDER.filter((m) => n.has(m))
    .map((m): [ModelFamily, number] => [m, n.get(m)!])
    .sort((a, b) => b[1] - a[1]);
}

/** `2 Sonnet and 1 Haiku`. */
const modelList = (agents: TraceAgent[]) => join(byModel(agents).map(([m, k]) => `${count(k)} ${MODEL_NAMES[m]}`));

/** `a Fable helper`, `two Sonnet helpers`, `a Fable helper and a Sonnet helper`. */
const subject = (agents: TraceAgent[]) =>
  join(byModel(agents).map(([m, k]) => (k === 1 ? `${aModel(m)} helper` : `${count(k)} ${MODEL_NAMES[m]} helpers`)));

const aModel = (m: ModelFamily) => `${/^[AEIOU]/.test(MODEL_NAMES[m]) ? "an" : "a"} ${MODEL_NAMES[m]}`;
const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function narrate(tl: Timeline, t: number): string {
  const { trace } = tl;
  if (trace.events.length === 0) return "Nothing has happened yet.";
  if (t >= trace.duration && trace.duration > 0) {
    const c = tl.countersAt(trace.duration);
    return `The session is over. ${count(c.agentsSpawned)} helpers worked alongside the orchestrator over ${c.toolCalls} tool calls.`;
  }

  const live = trace.agents.filter((a) => a.parent >= 0 && a.spawnT <= t && (!a.returned || t < a.returnT));

  if (live.length === 0) {
    const own = currentActivity(tl, 0, t);
    if (own) return `The orchestrator is working alone, ${ACTIVITY[own]}.`;
    const start = trace.events[0].t;
    if (t < start + 5) return "The session is just starting. The orchestrator is reading the first prompt.";
    return "Nothing is running right now. The session is waiting for the next prompt.";
  }

  // A crowd gets a head count by model and activity; a few agents are told apart one by one.
  const crowd = live.length > SMALL;
  const near = live.filter((a) => a.depth === 1);
  const deeper = live.filter((a) => a.depth >= 2);
  let first: string;
  if (crowd) {
    first = `${upper(count(live.length))} helpers are running: ${modelList(live)}.`;
  } else if (near.length === 0) {
    first = `Helpers started earlier are still running: ${modelList(deeper)}.`;
  } else {
    const head =
      near.length === 1
        ? `The orchestrator handed work to ${subject(near)}`
        : `The orchestrator is running ${count(near.length)} helpers: ${modelList(near)}`;
    let tail = "";
    if (deeper.length === 1) tail = near.length === 1 ? `, which started its own ${MODEL_NAMES[deeper[0].model]} helper` : `, and one of them started ${aModel(deeper[0].model)} helper`;
    else if (deeper.length > 1) tail = near.length === 1 ? `, which started ${count(deeper.length)} of its own: ${modelList(deeper)}` : `, and they started ${count(deeper.length)} more: ${modelList(deeper)}`;
    first = `${head}${tail}.`;
  }

  const groups = new Map<ToolCategory | "thinking", TraceAgent[]>();
  for (const a of live) {
    const k = currentActivity(tl, a.id, t) ?? "thinking";
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  const ranked = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const shown = ranked.slice(0, MAX_CLAUSES);
  const rest = ranked.slice(MAX_CLAUSES).reduce((n, [, g]) => n + g.length, 0);

  if (ranked.length === 1) {
    const [activity, group] = ranked[0];
    const who = crowd ? `All ${group.length} are` : group.length === 1 ? "It is" : group.length === 2 ? "Both are" : `All ${group.length} are`;
    return `${first} ${who} ${ACTIVITY[activity]}.`;
  }
  const clauses = shown.map(([activity, group]) => `${crowd ? count(group.length) : subject(group)} ${group.length === 1 ? "is" : "are"} ${ACTIVITY[activity]}`);
  if (rest > 0) clauses.push(rest === 1 ? "one more is busy with something else" : `${count(rest)} more are busy with other things`);
  return `${first} ${upper(join(clauses))}.`;
}
