/**
 * The "NOW" panel's plain-English line: at most two short present-tense sentences about the trace at
 * time `t`, sized to fit two lines on a phone. Pure and deterministic. It names live agents by model
 * and says what each is doing; it never quotes session text.
 */

import type { Timeline } from "@/lib/trace/timeline";
import type { ModelFamily, ToolCategory, TraceAgent } from "@/lib/trace/types";
import { MODEL_NAMES } from "./format";

/** An agent counts as "using" a tool for this many trace seconds after its call. */
const RECENT = 30;
/** Up to this many live helpers are named one by one; more are a crowd, counted first. */
const SMALL = 3;
const MODEL_ORDER: readonly ModelFamily[] = ["opus", "fable", "sonnet", "haiku", "other"];

type Activity = ToolCategory | "thinking";

const ACTIVITY: Record<Activity, string> = {
  web: "searching the web",
  shell: "running commands",
  files: "reading files",
  edit: "editing files",
  agents: "starting helpers",
  advisor: "asking an advisor",
  plan: "updating the plan",
  mcp: "using an outside tool",
  other: "using a tool",
  thinking: "thinking",
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
const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, word: string) => `${count(n)} ${word}${n === 1 ? "" : "s"}`;

function join(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** `Sonnet helper`; a model the trace could not name is just a `helper`. */
const helper = (m: ModelFamily) => (m === "other" ? "helper" : `${MODEL_NAMES[m]} helper`);
const aHelper = (m: ModelFamily) => `${/^[AEIOUaeiou]/.test(helper(m)) ? "an" : "a"} ${helper(m)}`;

function byModel(agents: TraceAgent[]): [ModelFamily, number][] {
  const n = new Map<ModelFamily, number>();
  for (const a of agents) n.set(a.model, (n.get(a.model) ?? 0) + 1);
  return MODEL_ORDER.filter((m) => n.has(m))
    .map((m): [ModelFamily, number] => [m, n.get(m)!])
    .sort((a, b) => b[1] - a[1]);
}

/** `a Fable helper and its Sonnet helper`, `two Sonnet helpers`, `an Opus helper and a Haiku helper`. */
function named(group: TraceAgent[]): string {
  if (group.length === 2) {
    const [a, b] = group;
    if (b.parent === a.id) return `${aHelper(a.model)} and its ${helper(b.model)}`;
    if (a.parent === b.id) return `${aHelper(b.model)} and its ${helper(a.model)}`;
  }
  return join(byModel(group).map(([m, k]) => (k === 1 ? aHelper(m) : `${count(k)} ${helper(m)}s`)));
}

/** In a crowd a group is named only when it is one agent or shares one model; else it is a count. */
function counted(group: TraceAgent[]): string {
  const models = byModel(group);
  if (group.length === 1 || models.length > 1) return group.length === 1 ? aHelper(group[0].model) : count(group.length);
  return `${count(group.length)} ${helper(models[0][0])}s`;
}

const clause = (who: string, n: number, activity: Activity) => `${who} ${n === 1 ? "is" : "are"} ${ACTIVITY[activity]}`;

export function narrate(tl: Timeline, t: number): string {
  const { trace } = tl;
  if (trace.events.length === 0) return "Nothing has happened yet.";
  if (t >= trace.duration && trace.duration > 0) {
    const c = tl.countersAt(trace.duration);
    const who = c.agentsSpawned > 0 ? `The orchestrator and ${plural(c.agentsSpawned, "helper")}` : "The orchestrator";
    return `The session is over. ${who} made ${plural(c.toolCalls, "tool call")}.`;
  }

  const live = trace.agents.filter((a) => a.parent >= 0 && a.spawnT <= t && (!a.returned || t < a.returnT));

  if (live.length === 0) {
    const own = currentActivity(tl, 0, t);
    if (own) return `The orchestrator is ${ACTIVITY[own]} on its own.`;
    if (t < trace.events[0].t + 5) return "The session is starting. The orchestrator is reading the first prompt.";
    return "Nothing is running. The session is waiting for the next prompt.";
  }

  // Agents grouped by what they are doing, busiest first; agents with no recent call always go last.
  const groups = new Map<Activity, TraceAgent[]>();
  for (const a of live) {
    const k = currentActivity(tl, a.id, t) ?? "thinking";
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  const idle = (a: Activity) => Number(a === "thinking");
  const ranked = [...groups.entries()].sort((a, b) => idle(a[0]) - idle(b[0]) || b[1].length - a[1].length);

  if (live.length > SMALL) {
    const busiest = ranked.slice(0, 2).map(([activity, g]) => clause(counted(g), g.length, activity));
    return `${upper(count(live.length))} helpers are at work. ${upper(join(busiest))}.`;
  }
  const [[activity, group], ...rest] = ranked;
  const first = `${upper(clause(named(group), group.length, activity))}.`;
  if (rest.length === 0) return first;
  return `${first} ${upper(join(rest.map(([a, g]) => clause(named(g), g.length, a))))}.`;
}
