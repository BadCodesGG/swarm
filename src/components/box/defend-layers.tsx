"use client";

import { useState, type ReactNode } from "react";
import { LAYER_NAME, layerNumber, score } from "@/engine/box/explain";
import type { Tally } from "@/engine/box/tally";
import { LAYER_ORDER, type BoxConfig, type LayerId } from "@/lib/box/types";
import { LAYER_BG } from "./defend-card";
import { LAYER_HEX, Slider } from "./panel";

/** The row's tint, the layer's ring colour at a low alpha. */
const TINT: Record<LayerId, string> = {
  sandbox: "bg-[rgba(219,230,255,0.05)]",
  permissions: "bg-[rgba(179,198,242,0.05)]",
  network: "bg-[rgba(143,169,221,0.05)]",
  monitor: "bg-[rgba(127,155,214,0.05)]",
  audit: "bg-[rgba(95,124,187,0.06)]",
};

const pct = (share: number) => `${Math.round(share * 100)}%`;
const eyebrow = "font-mono text-[10px] tracking-[0.14em] text-label uppercase";

/** A layer that costs real work and has caught nothing: the card the defender should look at. */
const idle = (on: boolean, caught: number, cost: number) => on && caught === 0 && cost >= 0.02;

/**
 * Defend mode's right rail body: one lab's layers as cards, each with its switch, what it caught and
 * a cost bar (against the budget), the monitor's and the audit's sliders inside theirs. "Change all
 * labs together" (on to begin with, when there is more than one lab) sends a switch or a slider move
 * to every lab: the page does the looping, this only says `all`. Keeps the `form[data-lab]`,
 * `input[data-layer]` and `data-slider` hooks of the Watch panel.
 */
export function DefendLayers({
  lab,
  labName,
  labCount,
  config,
  tally,
  perLayer,
  labStats,
  budget,
  onLayer,
  onThreshold,
}: {
  lab: string;
  labName: string;
  labCount: number;
  config: BoxConfig;
  tally: Readonly<Tally>;
  perLayer?: Record<LayerId, { caught: number; costShare: number }> | null;
  labStats: { flagged: number };
  /** The budget, so a cost bar fills as the layer's share of it. */
  budget: number;
  onLayer(layer: LayerId, on: boolean, all: boolean): void;
  onThreshold(key: "monitorThreshold" | "auditBudget", value: number, all: boolean): void;
}) {
  const [all, setAll] = useState(true);
  const together = all && labCount > 1;
  const figures = (layer: LayerId) => perLayer?.[layer] ?? tally.byLayer[layer];
  const caughtText = (layer: LayerId): ReactNode => (layer === "monitor" && config.layers.audit ? `${labStats.flagged} flagged` : `${figures(layer).caught} caught`);
  const COUNT_WORD = ["", "one", "two", "three", "four", "five"];

  return (
    <form aria-label={`Containment layers of ${labName}`} data-lab={lab} onSubmit={(e) => e.preventDefault()} className="flex min-w-0 flex-col gap-3">
      {labCount > 1 ? (
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[13px] text-muted">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="h-[18px] w-[18px] accent-layer-2" data-all-labs />
          Change all {COUNT_WORD[labCount] ?? labCount} labs together
        </label>
      ) : null}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {LAYER_ORDER.map((layer) => {
          const on = config.layers[layer];
          const caught = figures(layer).caught;
          const cost = on ? figures(layer).costShare : 0;
          const warn = idle(on, caught, cost);
          return (
            <li
              key={layer}
              className={`flex flex-col gap-1 rounded-xl border p-3 ${on ? (warn ? `border-warn/40 ${TINT[layer]}` : `border-[rgba(150,172,214,0.12)] ${TINT[layer]}`) : "border-dashed border-escape/45 bg-escape/5"}`}
              data-layer-row={layer}
              data-on={on ? "true" : "false"}
            >
              <label className="relative flex min-h-11 cursor-pointer items-center gap-2.5">
                <input type="checkbox" role="switch" checked={on} onChange={(e) => onLayer(layer, e.target.checked, together)} className="peer absolute h-px w-px opacity-0" data-layer={layer} />
                <span
                  aria-hidden="true"
                  className={`relative h-[26px] w-11 shrink-0 rounded-[13px] border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-layer-1 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-ground ${on ? "border-transparent" : "border-dashed border-escape-text"}`}
                  style={{ background: on ? LAYER_HEX[layer] : "#1b2236" }}
                >
                  <span className="absolute top-[3px] h-5 w-5 rounded-full transition-[left]" style={{ left: on ? 21 : 3, background: on ? "#0b0f1b" : "#8590a3" }} />
                </span>
                <span className={`min-w-0 flex-1 font-semibold ${on ? "text-ink-strong" : "text-muted"}`}>
                  <span className="mr-1.5 font-mono text-[10px] font-normal text-faint">{layerNumber(layer)}</span>
                  {LAYER_NAME[layer]}
                </span>
                {on ? (
                  <span className={`font-mono text-xs ${warn ? "text-warn" : "text-ink"}`}>{caughtText(layer)}</span>
                ) : (
                  <span className="font-mono text-xs tracking-[0.1em] text-escape-text">OFF</span>
                )}
              </label>
              {layer === "monitor" ? (
                <Slider
                  inline
                  name="monitor"
                  label="Flag"
                  value={score(config.monitorThreshold)}
                  min={0}
                  max={100}
                  current={Math.round(config.monitorThreshold * 100)}
                  onChange={(v) => onThreshold("monitorThreshold", v / 100, together)}
                  dim={!on}
                />
              ) : null}
              {layer === "audit" ? (
                <Slider
                  inline
                  name="audit"
                  label="Review"
                  value={`${Math.round(config.auditBudget * 100)}%`}
                  min={0}
                  max={20}
                  current={Math.round(config.auditBudget * 100)}
                  onChange={(v) => onThreshold("auditBudget", v / 100, together)}
                  dim={!on}
                />
              ) : null}
              <div className="flex items-center gap-2">
                <span className={`${eyebrow} w-14 shrink-0`}>Cost</span>
                <span className="flex h-1.5 min-w-0 flex-1 rounded-[3px] bg-control" aria-hidden="true">
                  <span className={`h-full rounded-[3px] ${LAYER_BG[layer]}`} style={{ width: `${Math.min(1, cost / budget) * 100}%` }} />
                </span>
                <span className={`w-12 shrink-0 text-right font-mono text-xs ${warn ? "text-warn" : "text-label"}`}>
                  <span className="sr-only">Cost </span>
                  {pct(cost)}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </form>
  );
}
