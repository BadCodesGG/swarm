import type { Quantiles } from "../rng";
import { AGENT_TYPES, agentTypeCategory, MODEL_FAMILIES, TOOL_CATEGORIES, type AgentTypeCategory } from "./categories";
import calibration from "./calibration.json";
import type { ModelFamily, SessionTrace, ToolCategory, Usage } from "./types";

/**
 * Aggregates of real sessions, nothing else: quantiles and probability tables keyed by category.
 * `collectStats` builds it, `scripts/calibrate.mjs` writes it to `calibration.json`, and
 * `generateTrace` draws from it. No tool, server, plugin or agent names, no text, no ids.
 */

/** Every category a plain `call` can carry; subagent launches are `spawn` events. */
export type CallCategory = Exclude<ToolCategory, "agents">;
/** The categories that make up a working agent's own loop; web and advisor are modelled apart. */
export type CoreCategory = Exclude<CallCategory, "web" | "advisor">;
export type DepthKey = "1" | "2" | "3";
export type TypeKey = Exclude<AgentTypeCategory, "main">;

export const CALL_CATEGORIES: readonly CallCategory[] = TOOL_CATEGORIES.filter((c): c is CallCategory => c !== "agents");
export const CORE_CATEGORIES: readonly CoreCategory[] = ["shell", "files", "edit", "plan", "mcp", "other"];
export const TYPE_KEYS: readonly TypeKey[] = AGENT_TYPES.filter((t): t is TypeKey => t !== "main");
export const DEPTH_KEYS: readonly DepthKey[] = ["1", "2", "3"];

/** A gap between two turns of one agent at or above this many seconds is the idle state. */
export const IDLE_GAP = 30;
/** Histogram sizes: index is the count, the last bucket takes everything above. */
export const MAX_CALLS = 6;
export const MAX_SPAWNS = 8;
/** Bins across an agent's life (by event position) for where it calls the advisor. */
export const LIFE_BINS = 5;

export interface CalibrationStats {
  version: 1;
  /** How much was read; provenance only. */
  read: { sessions: number; agents: number; turns: number; calls: number };
  /** Gaps between an agent's consecutive turns: a two-state burst/idle chain. */
  gaps: { continueBurst: number; continueIdle: number; burst: Quantiles; idle: Quantiles };
  /** Seconds a human takes to send the next prompt. */
  humanGap: Quantiles;
  /** Share of turns with 0, 1, 2... calls. */
  callsPerTurn: number[];
  /** Of turns with two or more calls, the share issued before the first result came back. */
  parallelCallProb: number;
  /** Category mix and the category-to-category table of the working loop. */
  core: { mix: Record<CoreCategory, number>; transitions: Record<CoreCategory, Record<CoreCategory, number>> };
  /** Seconds from a call to its result. */
  latency: Record<CallCategory, Quantiles>;
  errorRate: number;
  /** The orchestrator's share of turns that launch 0, 1, 2... subagents. */
  spawnsPerTurn: number[];
  /** Subagents launched together by one turn: index is the group size. */
  groupSize: number[];
  /** Chance a subagent launches subagents of its own. */
  childSpawnProb: number;
  backgroundFraction: number;
  childDuration: Quantiles;
  childToolCalls: Quantiles;
  /** Subagent model mix by depth (3 means 3 or deeper). */
  modelMix: Record<DepthKey, Record<ModelFamily, number>>;
  agentTypeMix: Record<TypeKey, number>;
  /** Advisor calls as a share of all calls, and where in an agent's life they fall. */
  advisor: { rate: number; position: number[] };
  /** Web calls as a share of non-advisor calls, and the share of those that are searches. */
  web: { share: number; search: number };
  /** Tokens per turn, by model family. */
  usage: Record<ModelFamily, Record<keyof Usage, Quantiles>>;
}

const DEFAULT_Q: Quantiles = { p10: 0.1, p25: 0.2, p50: 0.5, p75: 1, p90: 2, p99: 5 };
/** Below this many samples a distribution is not trusted and borrows from its parent pool. */
const MIN_SAMPLES = 12;

function quantiles(xs: readonly number[], fallback: Quantiles, floor: number): Quantiles {
  if (xs.length < MIN_SAMPLES) return fallback;
  const s = Float64Array.from(xs).sort();
  const at = (p: number) => Number(Math.max(s[Math.min(s.length - 1, Math.round(p * (s.length - 1)))], floor).toPrecision(3));
  return { p10: at(0.1), p25: at(0.25), p50: at(0.5), p75: at(0.75), p90: at(0.9), p99: at(0.99) };
}

const round4 = (x: number) => Math.round(x * 10000) / 10000;
const ratio = (a: number, b: number, fallback: number) => (b > 0 ? round4(a / b) : fallback);

/** Counts to shares; an all-zero histogram becomes `fallback`. */
function normalize(counts: readonly number[], fallback: readonly number[]): number[] {
  const total = counts.reduce((a, b) => a + b, 0);
  return total > 0 ? counts.map((c) => round4(c / total)) : [...fallback];
}

function normalizeRecord<K extends string>(keys: readonly K[], counts: Record<K, number>, fallback: Record<K, number>): Record<K, number> {
  const shares = normalize(keys.map((k) => counts[k]), keys.map((k) => fallback[k]));
  return Object.fromEntries(keys.map((k, i) => [k, shares[i]])) as Record<K, number>;
}

function record<K extends string, V>(keys: readonly K[], f: (k: K) => V): Record<K, V> {
  return Object.fromEntries(keys.map((k) => [k, f(k)])) as Record<K, V>;
}

const FALLBACK = {
  continueBurst: 0.9,
  continueIdle: 0.3,
  callsPerTurn: [0.2, 0.4, 0.25, 0.1, 0.03, 0.01, 0.01],
  spawnsPerTurn: [0.9, 0.06, 0.02, 0.01, 0.01, 0, 0, 0, 0],
  groupSize: [0, 0.5, 0.25, 0.12, 0.06, 0.03, 0.02, 0.01, 0.01],
  position: [0.2, 0.2, 0.2, 0.2, 0.2],
  mix: { shell: 0.3, files: 0.4, edit: 0.15, plan: 0.05, mcp: 0.05, other: 0.05 } as Record<CoreCategory, number>,
  models: { opus: 0.25, fable: 0.25, sonnet: 0.25, haiku: 0.25, other: 0 } as Record<ModelFamily, number>,
  types: { general: 0.4, explore: 0.3, plan: 0.1, build: 0.1, review: 0.05, test: 0.03, other: 0.02 } as Record<TypeKey, number>,
};

const bucket = (n: number, max: number) => Math.min(n, max);

interface OpenTurn {
  calls: number[]; // event indexes of this turn's calls
  spawns: number;
}

export interface StatsCollector {
  add(trace: SessionTrace): void;
  finish(): CalibrationStats;
}

/** Folds traces in one at a time, so a caller never holds more than one trace. */
export function createCollector(): StatsCollector {
  let sessions = 0;
  let agentCount = 0;
  let turnCount = 0;
  let callCount = 0;

  const burst: number[] = [];
  const idle: number[] = [];
  const human: number[] = [];
  const stay = { burst: 0, burstTotal: 0, idle: 0, idleTotal: 0 };
  const callsPerTurn = new Array<number>(MAX_CALLS + 1).fill(0);
  const par = { eligible: 0, parallel: 0 };
  const mix = record(CORE_CATEGORIES, () => 0);
  const trans = record(CORE_CATEGORIES, () => record(CORE_CATEGORIES, () => 0));
  const latency = record(CALL_CATEGORIES, () => [] as number[]);
  const results = { total: 0, errors: 0 };
  const spawnsPerTurn = new Array<number>(MAX_SPAWNS + 1).fill(0);
  const groupSize = new Array<number>(MAX_SPAWNS + 1).fill(0);
  const kids = { all: 0, agents: 0, withChildren: 0, background: 0 };
  const duration: number[] = [];
  const toolCalls: number[] = [];
  const models = record(DEPTH_KEYS, () => record(MODEL_FAMILIES, () => 0));
  const types = record(TYPE_KEYS, () => 0);
  const advisor = { calls: 0, position: new Array<number>(LIFE_BINS).fill(0) };
  const web = { calls: 0, search: 0, core: 0 };
  const usage = record(MODEL_FAMILIES, () => record(["input", "output", "cacheRead", "cacheWrite"] as const, () => [] as number[]));

  function add(trace: SessionTrace): void {
    sessions++;
    agentCount += trace.agents.length;
    const { events, agents } = trace;

    const resultAt = new Map<number, number>();
    const total = new Array<number>(agents.length).fill(0);
    events.forEach((e) => {
      total[e.agent]++;
      if (e.kind === "result" && e.call !== undefined) resultAt.set(e.call, e.t);
    });

    const parents = new Set(agents.map((a) => a.parent));
    for (const a of agents) {
      if (a.depth < 1) continue;
      models[DEPTH_KEYS[Math.min(a.depth, 3) - 1]][a.model]++;
      const type = agentTypeCategory(a.agentType);
      types[type === "main" ? "other" : type]++;
      kids.all++;
      if (a.background) kids.background++;
      if (a.childMissing) continue;
      kids.agents++;
      if (parents.has(a.id)) kids.withChildren++;
      if (a.returned && a.returnT > a.spawnT) duration.push(a.returnT - a.spawnT);
      if (a.toolCalls >= 1) toolCalls.push(a.toolCalls);
    }

    const lastT = new Array<number | undefined>(agents.length).fill(undefined);
    const seen = new Array<number>(agents.length).fill(0);
    const open = new Array<OpenTurn | undefined>(agents.length).fill(undefined);
    const prevState = new Array<boolean | undefined>(agents.length).fill(undefined); // true is burst
    const prevCore = new Array<CoreCategory | undefined>(agents.length).fill(undefined);

    const close = (a: number) => {
      const t = open[a];
      if (!t) return;
      open[a] = undefined;
      callsPerTurn[bucket(t.calls.length, MAX_CALLS)]++;
      if (a === 0) spawnsPerTurn[bucket(t.spawns, MAX_SPAWNS)]++;
      if (t.spawns >= 1) groupSize[bucket(t.spawns, MAX_SPAWNS)]++;
      if (t.calls.length >= 2) {
        par.eligible++;
        const first = resultAt.get(t.calls[0]);
        if (first !== undefined && events[t.calls[1]].t < first) par.parallel++;
      }
    };

    events.forEach((e, i) => {
      const a = e.agent;
      const before = lastT[a];
      if (e.kind === "turn" || e.kind === "prompt") {
        if (before !== undefined) {
          const gap = Math.max(0, e.t - before);
          if (e.kind === "prompt") human.push(gap);
          else {
            const isBurst = gap < IDLE_GAP;
            (isBurst ? burst : idle).push(gap);
            const prev = prevState[a];
            if (prev !== undefined) {
              if (prev) {
                stay.burstTotal++;
                if (isBurst) stay.burst++;
              } else {
                stay.idleTotal++;
                if (!isBurst) stay.idle++;
              }
            }
            prevState[a] = isBurst;
          }
        }
      }
      lastT[a] = e.t;

      if (e.kind === "turn") {
        close(a);
        open[a] = { calls: [], spawns: 0 };
        turnCount++;
        const model = agents[a].model;
        const u = e.usage;
        if (u && u.input + u.output + u.cacheRead + u.cacheWrite > 0) {
          for (const k of ["input", "output", "cacheRead", "cacheWrite"] as const) usage[model][k].push(u[k]);
        }
      } else if (e.kind === "spawn") {
        open[a] ??= { calls: [], spawns: 0 };
        open[a]!.spawns++;
      } else if (e.kind === "call") {
        open[a] ??= { calls: [], spawns: 0 };
        open[a]!.calls.push(i);
        callCount++;
        const cat: CallCategory = !e.category || e.category === "agents" ? "other" : e.category;
        const res = resultAt.get(i);
        if (res !== undefined) latency[cat].push(Math.max(0, res - e.t));
        if (cat === "advisor") {
          advisor.calls++;
          advisor.position[Math.min(LIFE_BINS - 1, Math.floor((seen[a] / Math.max(1, total[a])) * LIFE_BINS))]++;
        } else if (cat === "web") {
          web.calls++;
          if (/search/i.test(e.tool ?? "")) web.search++;
        } else {
          web.core++;
          const core = cat as CoreCategory;
          mix[core]++;
          const p = prevCore[a];
          if (p) trans[p][core]++;
          prevCore[a] = core;
        }
      } else if (e.kind === "result") {
        results.total++;
        if (e.isError) results.errors++;
      }
      seen[a]++;
    });
    for (let a = 0; a < agents.length; a++) close(a);
  }

  function finish(): CalibrationStats {
    const allLatency = Object.values(latency).flat();
    const latencyPool = quantiles(allLatency, DEFAULT_Q, 0.01);
    const allUsage = record(["input", "output", "cacheRead", "cacheWrite"] as const, (k) => MODEL_FAMILIES.flatMap((m) => usage[m][k]));
    const usagePool = record(["input", "output", "cacheRead", "cacheWrite"] as const, (k) =>
      quantiles(allUsage[k], { p10: 1, p25: 1, p50: 10, p75: 100, p90: 1000, p99: 10000 }, 1),
    );
    const mixShares = normalizeRecord(CORE_CATEGORIES, mix, FALLBACK.mix);

    return {
      version: 1,
      read: { sessions, agents: agentCount, turns: turnCount, calls: callCount },
      gaps: {
        continueBurst: ratio(stay.burst, stay.burstTotal, FALLBACK.continueBurst),
        continueIdle: ratio(stay.idle, stay.idleTotal, FALLBACK.continueIdle),
        burst: quantiles(burst, { p10: 0.3, p25: 0.8, p50: 2, p75: 5, p90: 12, p99: 28 }, 0.01),
        idle: quantiles(idle, { p10: IDLE_GAP, p25: 40, p50: 70, p75: 150, p90: 400, p99: 1500 }, IDLE_GAP),
      },
      humanGap: quantiles(human, { p10: 5, p25: 15, p50: 45, p75: 150, p90: 600, p99: 3600 }, 1),
      callsPerTurn: normalize(callsPerTurn, FALLBACK.callsPerTurn),
      parallelCallProb: ratio(par.parallel, par.eligible, 0.3),
      core: {
        mix: mixShares,
        transitions: record(CORE_CATEGORIES, (from) => {
          const row = trans[from];
          return Object.values(row).reduce((a, b) => a + b, 0) >= MIN_SAMPLES ? normalizeRecord(CORE_CATEGORIES, row, mixShares) : mixShares;
        }),
      },
      latency: record(CALL_CATEGORIES, (c) => quantiles(latency[c], latencyPool, 0.01)),
      errorRate: ratio(results.errors, results.total, 0.05),
      spawnsPerTurn: normalize(spawnsPerTurn, FALLBACK.spawnsPerTurn),
      groupSize: normalize(groupSize, FALLBACK.groupSize),
      childSpawnProb: ratio(kids.withChildren, kids.agents, 0.15),
      backgroundFraction: ratio(kids.background, kids.all, 0.2),
      childDuration: quantiles(duration, { p10: 5, p25: 15, p50: 45, p75: 120, p90: 300, p99: 900 }, 0.1),
      childToolCalls: quantiles(toolCalls, { p10: 1, p25: 3, p50: 8, p75: 20, p90: 40, p99: 120 }, 1),
      modelMix: record(DEPTH_KEYS, (d) => normalizeRecord(MODEL_FAMILIES, models[d], FALLBACK.models)),
      agentTypeMix: normalizeRecord(TYPE_KEYS, types, FALLBACK.types),
      advisor: {
        rate: ratio(advisor.calls, callCount, 0.005),
        position: normalize(advisor.position, FALLBACK.position),
      },
      web: {
        share: ratio(web.calls, web.calls + web.core, 0.05),
        search: ratio(web.search, web.calls, 0.5),
      },
      usage: record(MODEL_FAMILIES, (m) =>
        record(["input", "output", "cacheRead", "cacheWrite"] as const, (k) => quantiles(usage[m][k], usagePool[k], 1)),
      ),
    };
  }

  return { add, finish };
}

export function collectStats(traces: Iterable<SessionTrace>): CalibrationStats {
  const c = createCollector();
  for (const t of traces) c.add(t);
  return c.finish();
}

/** Field names the stats schema uses; any other object key means something leaked in. */
function schemaKeys(): Set<string> {
  const keys = new Set<string>([...TOOL_CATEGORIES, ...MODEL_FAMILIES, ...AGENT_TYPES, ...DEPTH_KEYS]);
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        keys.add(k);
        walk(x);
      }
    }
  };
  walk(createCollector().finish());
  return keys;
}

/**
 * Throws unless every value is a finite non-negative number and every string value or object key
 * is a known category or schema field. The message names the path, never the offending value.
 */
export function assertCleanStats(stats: unknown): void {
  const known = new Set<string>([...TOOL_CATEGORIES, ...MODEL_FAMILIES, ...AGENT_TYPES]);
  const keys = schemaKeys();
  const walk = (v: unknown, path: string) => {
    if (typeof v === "number") {
      if (!Number.isFinite(v) || v < 0) throw new Error(`calibration refused: ${path} is not a finite non-negative number`);
    } else if (typeof v === "string") {
      if (!known.has(v)) throw new Error(`calibration refused: ${path} holds a string that is not a known category key`);
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${path}[${i}]`));
    } else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (!keys.has(k)) throw new Error(`calibration refused: ${path} has a key that is not a known category or field`);
        walk(x, `${path}.${k}`);
      }
    } else {
      throw new Error(`calibration refused: ${path} is not a number, array or object`);
    }
  };
  walk(stats, "stats");
}

/** The JSON to commit; throws, writing nothing, when the stats are not clean. */
export function serializeStats(stats: CalibrationStats): string {
  assertCleanStats(stats);
  const json = JSON.stringify(stats, null, 2);
  // Number arrays on one line keep the committed file readable.
  return json.replace(/\[\s+([-\d.e,\s]+?)\s+\]/g, (_, body: string) => `[${body.replace(/\s+/g, " ")}]`) + "\n";
}

/** What `generateTrace` draws from: the committed output of `scripts/calibrate.mjs`. */
export const CALIBRATION = calibration as unknown as CalibrationStats;
