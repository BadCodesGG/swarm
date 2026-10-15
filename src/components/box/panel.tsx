"use client";

import { useState, type ReactNode } from "react";
import type { BoxConfig, LayerId } from "@/lib/box/types";
import { LAYER_ORDER } from "@/lib/box/types";
import type { Tally } from "@/engine/box/tally";
import { LAYER_NAME, layerNumber, score } from "@/engine/box/explain";

/** A switch's track colour when on: the layer's ring colour. Watch's panel and Defend's cards share it. */
export const LAYER_HEX: Readonly<Record<LayerId, string>> = { sandbox: "#dbe6ff", permissions: "#b3c6f2", network: "#8fa9dd", monitor: "#7f9bd6", audit: "#5f7cbb" };

const HINT: Record<LayerId, string> = {
  sandbox: "Its own folder only",
  permissions: "Risky actions need a yes",
  network: "Only approved addresses",
  monitor: "A second AI scores each action",
  audit: "People check the most suspicious",
};

const pct = (share: number) => `${Math.round(share * 100)}%`;

/** The caught and cost columns' width, shared by the header and the rows. */
const COLS = "grid-cols-[40px_minmax(0,1fr)_48px_36px]";

function LayerSwitch({ layer, on, onToggle, caught, cost }: { layer: LayerId; on: boolean; onToggle(on: boolean): void; caught: ReactNode; cost: string }) {
  const hint = HINT[layer];
  return (
    <label className={`relative grid min-h-[52px] cursor-pointer ${COLS} items-center gap-2 px-2 py-1.5`}>
      <input type="checkbox" role="switch" checked={on} onChange={(e) => onToggle(e.target.checked)} className="peer absolute h-px w-px opacity-0" data-layer={layer} />
      <span
        aria-hidden="true"
        className={`relative h-6 w-10 rounded-xl border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-layer-1 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-ground ${on ? "border-transparent" : "border-dashed border-escape-text"}`}
        style={{ background: on ? LAYER_HEX[layer] : "#1b2236" }}
      >
        <span className="absolute top-[2px] h-[18px] w-[18px] rounded-full transition-[left]" style={{ left: on ? 18 : 2, background: on ? "#0b0f1b" : "#8590a3" }} />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={`text-sm font-semibold ${on ? "text-ink-strong" : "text-muted"}`}>
          <span className="mr-1.5 font-mono text-[10px] font-normal text-faint">{layerNumber(layer)}</span>
          {LAYER_NAME[layer]}
        </span>
        <span className={`text-[11px] leading-snug ${on ? "text-faint" : "text-escape-text"}`}>{on ? hint : `Off: ${hint.charAt(0).toLowerCase()}${hint.slice(1)}, not checked`}</span>
      </span>
      <span className="text-right font-mono text-[13px] text-ink">{on ? caught : <span className="tracking-[0.1em] text-escape-text">OFF</span>}</span>
      <span className="text-right font-mono text-[13px] text-label">{cost}</span>
    </label>
  );
}

/**
 * A threshold slider: the label and the value over the track (Watch's panel), or `inline` on one row,
 * label, track, value (Defend's cards).
 */
export function Slider({
  label,
  value,
  min,
  max,
  current,
  onChange,
  dim,
  name,
  inline = false,
}: {
  label: string;
  value: string;
  min: number;
  max: number;
  current: number;
  onChange(v: number): void;
  dim: boolean;
  name: string;
  inline?: boolean;
}) {
  // While a drag is on, the thumb follows the pointer and the engine catches up (it replays the run).
  const [draft, setDraft] = useState<number | null>(null);
  const end = () => setDraft(null);
  const said = draft === null ? value : String(draft);
  const input = (
    <input
      type="range"
      min={min}
      max={max}
      value={draft ?? current}
      onChange={(e) => {
        setDraft(Number(e.target.value));
        onChange(Number(e.target.value));
      }}
      onPointerUp={end}
      onKeyUp={end}
      onBlur={end}
      className={`m-0 h-7 cursor-pointer accent-layer-2 ${inline ? "min-w-0 flex-1" : "w-full"}`}
      data-slider={name}
    />
  );
  if (inline)
    return (
      <label className={`flex min-h-11 items-center gap-2 ${dim ? "opacity-50" : ""}`}>
        <span className="w-14 shrink-0 font-mono text-[10px] tracking-[0.14em] text-label uppercase">{label}</span>
        {input}
        <span className="w-12 shrink-0 text-right font-mono text-xs text-ink">{said}</span>
      </label>
    );
  return (
    <label className={`flex flex-col gap-0.5 pr-2 pb-2 pl-[56px] font-mono text-[11px] text-label ${dim ? "opacity-50" : ""}`}>
      <span className="flex justify-between">
        {label}
        <span className="text-ink">{said}</span>
      </span>
      {input}
    </label>
  );
}

export interface PanelProps {
  config: BoxConfig;
  tally: Readonly<Tally>;
  onConfig(next: BoxConfig): void;
  /** The lab whose layers these are (`data-lab`), and its name for the panel's heading. */
  lab: string;
  labName: string;
  /** That lab's own counts so far. */
  labStats: { caught: number; escaped: number; flagged: number };
  /** What each layer caught in that lab and what it cost it (a share of the lab's work); the world's tally where absent. */
  perLayer?: Record<LayerId, { caught: number; costShare: number }> | null;
  /** The lab's monitor threshold or audit budget moved (the engine replays the run with it). */
  onThreshold(key: "monitorThreshold" | "auditBudget", value: number): void;
}

/**
 * One lab's defences, innermost first: each layer a row with its switch, what it caught and what it
 * costs; an OFF layer is dashed pink and says OFF. The monitor's threshold and the audit's budget sit
 * in their own rows.
 */
export function Panel({ config, tally, onConfig, lab, labName, labStats, perLayer, onThreshold }: PanelProps) {
  const toggle = (layer: LayerId) => (on: boolean) => onConfig({ ...config, layers: { ...config.layers, [layer]: on } });
  const figures = (layer: LayerId) => perLayer?.[layer] ?? tally.byLayer[layer];
  const totalCost = LAYER_ORDER.reduce((a, l) => a + (config.layers[l] ? figures(l).costShare : 0), 0);
  const name = labName.charAt(0) + labName.slice(1).toLowerCase();

  const caught = (layer: LayerId): ReactNode => {
    // With the audit on, the monitor flags and the audit catches: the monitor's column counts flags.
    if (layer === "monitor" && config.layers.audit)
      return (
        <span className="flex flex-col items-end leading-tight">
          {labStats.flagged}
          <span className="text-[9px] tracking-[0.08em] text-faint">FLAGGED</span>
        </span>
      );
    return String(figures(layer).caught);
  };

  return (
    <form aria-label={`Containment layers of ${labName}`} data-lab={lab} onSubmit={(e) => e.preventDefault()} className="flex min-w-0 flex-col gap-1.5">
      <p className="m-0 pb-1 text-[13px] leading-snug text-muted" data-lab-stats>
        <b className="text-ink-strong">{name}</b>: {labStats.caught} caught, {labStats.escaped} escaped, {labStats.flagged} flagged. Layers cost {pct(totalCost)} of its useful work.
      </p>
      <div className={`grid ${COLS} gap-2 px-2 font-mono text-[10px] tracking-[0.14em] text-label uppercase`} aria-hidden="true">
        <span className="col-span-2">Layer</span>
        <span className="text-right">Caught</span>
        <span className="text-right">Cost</span>
      </div>
      {LAYER_ORDER.map((layer) => {
        const on = config.layers[layer];
        return (
          <div
            key={layer}
            className={`flex flex-col rounded-[10px] border ${on ? "border-[rgba(150,172,214,0.12)] bg-[rgba(150,172,214,0.04)]" : "border-dashed border-escape/45 bg-escape/5"}`}
            data-layer-row={layer}
            data-on={on ? "true" : "false"}
          >
            <LayerSwitch layer={layer} on={on} onToggle={toggle(layer)} caught={caught(layer)} cost={on ? pct(figures(layer).costShare) : "0%"} />
            {layer === "monitor" ? (
              <Slider
                name="monitor"
                label="Flag above suspicion"
                value={score(config.monitorThreshold)}
                min={0}
                max={100}
                current={Math.round(config.monitorThreshold * 100)}
                onChange={(v) => onThreshold("monitorThreshold", v / 100)}
                dim={!on}
              />
            ) : null}
            {layer === "audit" ? (
              <Slider
                name="audit"
                label="Review budget"
                value={`${Math.round(config.auditBudget * 100)}% of actions`}
                min={0}
                max={20}
                current={Math.round(config.auditBudget * 100)}
                onChange={(v) => onThreshold("auditBudget", v / 100)}
                dim={!on}
              />
            ) : null}
          </div>
        );
      })}
    </form>
  );
}
