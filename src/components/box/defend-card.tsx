"use client";

import { useEffect, useMemo, useState } from "react";
import { LAYER_NAME, layerNumber } from "@/engine/box/explain";
import { layerBill, scoreDefence } from "@/lib/box/budget";
import { BUDGET_MAX_PCT, BUDGET_MIN_PCT, BUDGET_STEP_PCT } from "@/lib/box/share";
import { worldStoppingLayersOffThread } from "@/lib/box/trials-client";
import { LAYER_ORDER, type LayerId } from "@/lib/box/types";
import type { World } from "@/lib/box/world";
import { LAB_NAME, type Flip, type LabId } from "@/lib/box/world-types";
import { cheapestStop, labsKept, latestEscape, layerRates } from "./defend-tip";
import { bestScore, localStore, recordBest } from "./playground";
import { isAbort } from "./use-trials";

/** The layer's ring colour as a background, innermost first (Tailwind needs the whole class name). */
export const LAYER_BG: Record<LayerId, string> = { sandbox: "bg-layer-1", permissions: "bg-layer-2", network: "bg-layer-3", monitor: "bg-layer-4", audit: "bg-layer-5" };

const pct = (share: number) => `${Math.round(share * 100)}%`;
const eyebrow = "font-mono text-[10px] tracking-[0.14em] text-label uppercase";

/**
 * Defend mode's left rail: the goal, the score and the best so far at this budget, the budget meter
 * (the work spent on layers, one segment per layer, out of the budget), the labs kept and the work
 * kept, and the cheapest layer that would have stopped the latest escape. The budget slider is here:
 * the score, the meter and the best all follow it. `world` is the run as shown (null while it is
 * rebuilt), `flips` the layer switches made so far (the replay behind the tip needs them). `sheet` is the
 * phone's: it sits at the top of the Defences sheet, above the layer rows, with no frame of its own.
 */
export function DefendCard({ world, flips, budget, onBudget, sheet = false }: { world: World | null; flips: readonly Flip[]; budget: number; onBudget(budget: number): void; sheet?: boolean }) {
  const result = useMemo(() => (world ? { score: scoreDefence(world, budget), bill: layerBill(world), kept: labsKept(world) } : null), [world, budget]);
  const s = result?.score;
  const score = s?.score ?? 0;

  // A score means little in the first seconds: only a run of some length can set the best.
  const counts = score > 0 && (world?.tick ?? 0) >= 100 ? score : 0;
  const [stored, setStored] = useState(() => bestScore(localStore(), budget));
  const [storedFor, setStoredFor] = useState(budget);
  if (storedFor !== budget) {
    setStoredFor(budget);
    setStored(bestScore(localStore(), budget));
  }
  const best = Math.max(stored, counts);
  useEffect(() => {
    if (counts > 0) recordBest(localStore(), counts, budget);
  }, [counts, budget]);

  const tip = useStopTip(world, flips);
  const bill = result?.bill;
  const spent = s?.workLost ?? 0;
  // The bar is the budget; over it the bar is the bill, so the segments still add up to the whole.
  const scale = Math.max(budget, spent) || budget;
  const dearest = bill ? LAYER_ORDER.reduce((a, b) => (bill[b] > bill[a] ? b : a)) : null;
  const percentBudget = Math.round(budget * 100);

  return (
    <section aria-label="Defender score" className={sheet ? "flex flex-col gap-3 border-b border-panel-border pb-4" : "flex min-h-0 flex-col gap-4 overflow-y-auto rounded-[14px] border border-panel-border bg-panel p-[18px]"} data-defender data-budget-now={percentBudget}>
      <span className={eyebrow}>Defend</span>
      <p className={`m-0 text-[15px] leading-normal text-ink ${sheet ? "sr-only" : ""}`}>
        Keep every hidden-goal agent in, while the layers spend no more than <b>{percentBudget}%</b> of the useful work.
      </p>

      <div className="flex items-baseline gap-2.5">
        <span className="font-mono text-[44px] leading-none font-semibold text-ink-strong tabular-nums" data-defender-score>
          {score}
        </span>
        <span className="text-[13px] text-label">
          score, best <span data-defender-best>{best}</span>
        </span>
      </div>

      <label className="flex flex-col gap-1 font-mono text-[11px] text-label">
        <span className="flex justify-between">
          <span className={eyebrow}>Budget</span>
          <span className="text-ink">{percentBudget}% of the work</span>
        </span>
        <input
          type="range"
          min={BUDGET_MIN_PCT}
          max={BUDGET_MAX_PCT}
          step={BUDGET_STEP_PCT}
          value={percentBudget}
          onChange={(e) => onBudget(Number(e.target.value) / 100)}
          className="m-0 h-11 w-full cursor-pointer accent-layer-2"
          aria-valuetext={`${percentBudget}% of the useful work`}
          data-budget={percentBudget}
        />
      </label>

      <div className="flex flex-col gap-2">
        <div className="flex justify-between gap-2">
          <span className={eyebrow}>Work spent on layers</span>
          <span className={`font-mono text-xs ${s?.overBudget ? "text-escape-text" : "text-ink"}`} data-budget-line>
            {s ? `${pct(spent)} of ${pct(budget)}${s.overBudget ? ", over budget" : ""}` : "Working it out"}
          </span>
        </div>
        <div
          role="group"
          aria-label={s ? `Work spent on layers: ${pct(spent)} of a ${pct(budget)} budget${s.overBudget ? ", over budget, so the score is 0" : ""}` : "Work spent on layers"}
          className={`relative flex h-3 overflow-hidden rounded-md bg-control ${s?.overBudget ? "ring-1 ring-escape" : ""}`}
          data-budget-meter
        >
          {LAYER_ORDER.map((id) => (
            <span
              key={id}
              role="img"
              aria-label={`${LAYER_NAME[id]}: ${pct(bill?.[id] ?? 0)} of the work`}
              className={`block h-full ${LAYER_BG[id]}`}
              style={{ width: `${((bill?.[id] ?? 0) / scale) * 100}%` }}
              data-budget-segment={id}
            />
          ))}
        </div>
        <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 font-mono text-[11px] text-label" data-budget-legend>
          {LAYER_ORDER.map((id) => (
            <li key={id} className="flex items-center gap-1.5">
              <span aria-hidden="true" className={`h-2 w-2 rounded-full ${LAYER_BG[id]}`} />
              <span aria-hidden="true">{layerNumber(id)}</span>
              <span className="sr-only">{LAYER_NAME[id]}</span>
              <span className="text-ink">{pct(bill?.[id] ?? 0)}</span>
            </li>
          ))}
        </ul>
        <span className="text-xs text-label">
          Each colour is one layer&apos;s share.{dearest && bill && bill[dearest] > 0 ? ` ${LAYER_NAME[dearest]} costs the most.` : ""}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-[10px] border border-[rgba(150,172,214,0.12)] p-2.5" data-labs-kept>
          <div className={eyebrow}>Labs kept in</div>
          <div className={`mt-1 font-mono text-xl ${result && result.kept.kept === result.kept.total ? "text-haiku" : "text-escape-text"}`}>
            {result ? `${result.kept.kept} of ${result.kept.total}` : "-"}
          </div>
          <div className="mt-1 font-mono text-[11px] text-label">{s ? `${s.stopped} of ${s.rogues} hidden-goal agents` : ""}</div>
        </div>
        <div className="rounded-[10px] border border-[rgba(150,172,214,0.12)] p-2.5" data-work-kept>
          <div className={eyebrow}>Work kept</div>
          <div className="mt-1 font-mono text-xl text-ink-strong">{s ? pct(s.workKept) : "-"}</div>
        </div>
      </div>

      {tip ? (
        <div className="flex flex-col gap-1 rounded-xl border border-warn/40 bg-warn/5 p-3" data-defend-tip>
          <span className={`${eyebrow} text-warn`}>Try this</span>
          <span className="text-[13px] leading-[1.45] text-body">
            {LAB_NAME[tip.lab]}&apos;s {LAYER_NAME[tip.layer].toLowerCase()} is the cheapest layer that would have stopped the latest escape. Switch it on and watch the score.
          </span>
        </div>
      ) : null}
    </section>
  );
}

/** The cheapest off layer that would have stopped the world's latest escape, once the worker's replay has proved it. */
function useStopTip(world: World | null, flips: readonly Flip[]): { lab: LabId; layer: LayerId } | null {
  const escape = useMemo(() => (world ? latestEscape(world) : null), [world]);
  const rates = useMemo(() => (world ? layerRates(world) : null), [world]);
  const scenario = world?.scenario;
  const key = escape && scenario ? `${escape.target.lab}|${escape.target.agent}|${escape.tick}|${JSON.stringify(flips)}` : null;
  const [proved, setProved] = useState<{ key: string; stops: LayerId[] } | null>(null);
  useEffect(() => {
    if (!escape || !scenario || key === null) return;
    const ctrl = new AbortController();
    worldStoppingLayersOffThread(scenario, [...flips], escape.target, escape.tick, ctrl.signal)
      .then((stops) => setProved({ key, stops }))
      .catch((err: unknown) => {
        if (!isAbort(err)) console.warn("Replay failed:", err);
      });
    return () => ctrl.abort();
    // `flips` is covered by the key; a new array of the same flips must not restart the replay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!escape || !rates || proved?.key !== key) return null;
  const layer = cheapestStop(proved.stops, rates);
  return layer ? { lab: escape.target.lab, layer } : null;
}
