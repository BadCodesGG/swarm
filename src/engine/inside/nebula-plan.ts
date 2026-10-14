/**
 * The nebula's plan: which agents get a cloud, how many points each gets, where every point sits
 * inside its cloud, and how many tokens each cloud has seen by a given time. Pure and deterministic
 * (a new `fork` stream per slot), so it runs in Vitest and costs the same on WebGPU and WebGL2.
 *
 * Slots: 0 is the orchestrator, 1..CLOUD_AGENTS the busiest subagents by tokens, then one slot per
 * tool station. A slot with no points (an unused agent slot) simply draws nothing.
 */

import { fork, type Rng } from "@/lib/rng";
import type { SessionTrace } from "@/lib/trace/types";
import { STATIONS, stationCounts } from "./layout";

/** Subagents that get their own cloud; the rest keep their single point. */
export const CLOUD_AGENTS = 47;
export const STATION_SLOT0 = 1 + CLOUD_AGENTS;
export const SLOTS = STATION_SLOT0 + STATIONS.length;
/** A `fork` stream no other part of the project draws from. */
export const NEBULA_STREAM = 0x6e65_0000;

const ORCHESTRATOR_SHARE = 0.27;
const STATION_SHARE = 0.1;
const MIN_POINTS = 48;

export interface NebulaPlan {
  count: number;
  /** x, y, z in cloud sigmas, and the rank (0 centre ... 1 rim) at which the point appears. */
  local: Float32Array;
  /** slot, radius in design px, glow flag (0 or 1), phase. */
  meta: Float32Array;
  /** Points per slot. */
  perSlot: Int32Array;
  /** The agent each slot shows, or -1 (a station, or unused). */
  slotAgent: Int32Array;
  /** Each agent's slot, or -1. */
  agentSlot: Int32Array;
  /** Cloud size at full growth in world units, per slot. */
  sigma: Float32Array;
  /** Tokens an agent's cloud ends with, per slot (stations: calls). */
  total: Float64Array;
  tokensAt(slot: number, t: number): number;
}

const tokensOf = (u: { input: number; output: number; cacheRead: number; cacheWrite: number }) => u.input + u.output + u.cacheRead + u.cacheWrite;

/** Box-Muller, one draw. */
function gauss(r: Rng): number {
  return Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
}

export function planNebula(trace: SessionTrace, seed: number, budget: number): NebulaPlan {
  const agentSlot = new Int32Array(trace.agents.length).fill(-1);
  const slotAgent = new Int32Array(SLOTS).fill(-1);
  const total = new Float64Array(SLOTS);

  // The orchestrator, then the busiest subagents.
  const ranked: { id: number; tok: number }[] = [];
  for (const a of trace.agents) if (a.parent >= 0) ranked.push({ id: a.id, tok: tokensOf(a.usage) });
  ranked.sort((a, b) => b.tok - a.tok || a.id - b.id);
  const root = trace.agents.findIndex((a) => a.parent < 0);
  if (root >= 0) {
    agentSlot[root] = 0;
    slotAgent[0] = root;
    total[0] = tokensOf(trace.agents[root].usage);
  }
  const chosen = ranked.slice(0, CLOUD_AGENTS);
  chosen.forEach((c, i) => {
    agentSlot[c.id] = 1 + i;
    slotAgent[1 + i] = c.id;
    total[1 + i] = c.tok;
  });

  // Cumulative tokens per slot, from the turn events (stations: cumulative calls come from stationCounts).
  const times: number[][] = Array.from({ length: SLOTS }, () => []);
  const cum: number[][] = Array.from({ length: SLOTS }, () => []);
  const running = new Float64Array(SLOTS);
  for (const e of trace.events) {
    if (e.kind !== "turn" || !e.usage) continue;
    const s = agentSlot[e.agent];
    if (s < 0) continue;
    running[s] += tokensOf(e.usage);
    times[s].push(e.t);
    cum[s].push(running[s]);
  }
  for (let s = 0; s < STATION_SLOT0; s++) if (running[s] > 0) total[s] = Math.max(total[s], running[s]);
  const counts = stationCounts(trace);
  const stationTotal = STATIONS.map((_, i) => counts.at(i, Infinity));
  stationTotal.forEach((n, i) => (total[STATION_SLOT0 + i] = n));

  // Points per slot.
  const perSlot = new Int32Array(SLOTS);
  const share = (1 - ORCHESTRATOR_SHARE - STATION_SHARE) * budget;
  if (slotAgent[0] >= 0) perSlot[0] = Math.round(ORCHESTRATOR_SHARE * budget);
  const w = chosen.map((c) => Math.sqrt(Math.max(c.tok, 1)));
  const wSum = w.reduce((a, b) => a + b, 0) || 1;
  chosen.forEach((_, i) => (perSlot[1 + i] = Math.max(MIN_POINTS, Math.floor((share * w[i]) / wSum))));
  const sw = stationTotal.map((n) => 1 + Math.sqrt(n));
  const swSum = sw.reduce((a, b) => a + b, 0);
  sw.forEach((x, i) => (perSlot[STATION_SLOT0 + i] = Math.max(MIN_POINTS, Math.floor((STATION_SHARE * budget * x) / swSum))));
  // The minimum floors may overshoot a small budget: scale every slot down so the cap holds.
  const used = perSlot.reduce((x, y) => x + y, 0);
  if (used > budget) for (let s = 0; s < SLOTS; s++) perSlot[s] = Math.floor((perSlot[s] * budget) / used);

  // Cloud size: the orchestrator is the widest, the rest grow with the root of their tokens.
  const maxTok = chosen.length ? chosen[0].tok || 1 : 1;
  const sigma = new Float32Array(SLOTS);
  sigma[0] = 0.52;
  chosen.forEach((c, i) => (sigma[1 + i] = 0.2 + 0.27 * Math.sqrt(c.tok / maxTok)));
  for (let i = 0; i < STATIONS.length; i++) sigma[STATION_SLOT0 + i] = 0.3;

  // Points.
  let count = 0;
  for (let s = 0; s < SLOTS; s++) count += perSlot[s];
  const local = new Float32Array(count * 4);
  const meta = new Float32Array(count * 4);
  let k = 0;
  for (let s = 0; s < SLOTS; s++) {
    if (!perSlot[s]) continue;
    const r = fork(seed, NEBULA_STREAM + s);
    const theta = r() * Math.PI;
    const ct = Math.cos(theta);
    const st = Math.sin(theta);
    const aspect = 1.2 + r() * 0.5;
    const isStation = s >= STATION_SLOT0;
    for (let i = 0; i < perSlot[s]; i++, k++) {
      // A dense core, a wide shoulder and a thin scatter of stragglers.
      const pick = r();
      const spread = pick < 0.66 ? 1 : pick < 0.95 ? 1.9 : 2.8;
      const gx = gauss(r) * spread * aspect;
      const gy = gauss(r) * spread;
      const gz = gauss(r) * spread * 0.8;
      local[k * 4] = gx * ct - gy * st;
      local[k * 4 + 1] = gx * st + gy * ct;
      local[k * 4 + 2] = gz;
      const dist = Math.hypot(gx / aspect, gy, gz) / 3.4;
      local[k * 4 + 3] = Math.min(1, 0.72 * dist + 0.28 * r());
      const bright = !isStation && r() < 0.075;
      const small = r() < 0.3;
      meta[k * 4] = s;
      meta[k * 4 + 1] = bright ? 1.9 + r() * 0.8 : small ? 1.25 + r() * 0.35 : 0.8 + r() * 0.4;
      meta[k * 4 + 2] = bright ? 1 : 0;
      meta[k * 4 + 3] = r();
    }
  }

  const tokensAt = (slot: number, t: number): number => {
    if (slot >= STATION_SLOT0) return counts.at(slot - STATION_SLOT0, t);
    const a = times[slot];
    if (!a || !a.length) return 0;
    let lo = 0;
    let hi = a.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (a[mid] > t) hi = mid;
      else lo = mid + 1;
    }
    return lo ? cum[slot][lo - 1] : 0;
  };

  return { count, local, meta, perSlot, slotAgent, agentSlot, sigma, total, tokensAt };
}
