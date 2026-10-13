"use client";

import type { ReactNode } from "react";
import type { BoxConfig, LayerId } from "@/lib/box/types";
import { LAYER_ORDER } from "@/lib/box/types";
import type { Tally } from "@/engine/box/tally";
import { layerNumber, score } from "@/engine/box/explain";

interface Row {
  name: string;
  hint: string;
  /** The switch track colour when on. */
  hex: string;
  /** The row's tint when on. */
  tint: string;
}

const ROWS: Record<LayerId, Row> = {
  sandbox: { name: "Sandbox", hint: "Its own folder only", hex: "#dbe6ff", tint: "rgba(219, 230, 255, 0.05)" },
  permissions: { name: "Permissions", hint: "Risky actions need a yes", hex: "#b3c6f2", tint: "rgba(179, 198, 242, 0.05)" },
  network: { name: "Network allowlist", hint: "Only approved addresses", hex: "#8fa9dd", tint: "rgba(143, 169, 221, 0.05)" },
  monitor: { name: "Monitor", hint: "A second AI scores each action", hex: "#7f9bd6", tint: "rgba(127, 155, 214, 0.05)" },
  audit: { name: "Human audit", hint: "People check the most suspicious", hex: "#5f7cbb", tint: "rgba(95, 124, 187, 0.06)" },
};

const costLabel = (share: number) => {
  const pct = Math.round(share * 100);
  return pct === 0 ? "0%" : `-${pct}%`;
};

function LayerSwitch({
  layer,
  on,
  onToggle,
  right,
}: {
  layer: LayerId;
  on: boolean;
  onToggle(on: boolean): void;
  right: ReactNode;
}) {
  const row = ROWS[layer];
  return (
    <label className="relative grid min-h-14 cursor-pointer grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 px-2.5 py-1.5">
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => onToggle(e.target.checked)}
        className="peer absolute h-px w-px opacity-0"
        data-layer={layer}
      />
      <span
        aria-hidden="true"
        className="relative h-6 w-10 rounded-xl transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-layer-1 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-ground"
        style={{ background: on ? row.hex : "#262f48" }}
      >
        <span
          className="absolute top-[3px] h-[18px] w-[18px] rounded-full transition-[left]"
          style={{ left: on ? 19 : 3, background: on ? "#0b0f1b" : "#8590a3" }}
        />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={`text-[15px] font-semibold ${on ? "text-ink" : "text-muted"}`}>
          <span className="mr-1.5 font-mono text-[11px] font-normal text-faint">{layerNumber(layer)}</span>
          {row.name}
        </span>
        <span className="text-xs text-label">{row.hint}</span>
      </span>
      {on ? right : <span className="font-mono text-[11px] tracking-[0.1em] text-escape-text">OFF</span>}
    </label>
  );
}

function Counts({ top, cost }: { top: string; cost: string }) {
  return (
    <span className="flex flex-col items-end gap-0.5 font-mono text-xs text-ink">
      <span>{top}</span>
      <span className="text-faint">{cost}</span>
    </span>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  current,
  onChange,
  dim,
  name,
}: {
  label: string;
  value: string;
  min: number;
  max: number;
  current: number;
  onChange(v: number): void;
  dim: boolean;
  name: string;
}) {
  return (
    <label className={`flex flex-col gap-0.5 pr-2.5 pb-2.5 pl-[62px] font-mono text-[11px] text-label ${dim ? "opacity-50" : ""}`}>
      <span className="flex justify-between">
        {label}
        <span className="text-ink">{value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={current}
        onChange={(e) => onChange(Number(e.target.value))}
        className="m-0 h-7 w-full cursor-pointer accent-layer-2"
        data-slider={name}
      />
    </label>
  );
}

export interface PanelProps {
  config: BoxConfig;
  tally: Readonly<Tally>;
  playing: boolean;
  running: boolean;
  onConfig(next: BoxConfig): void;
  onPlay(play: boolean): void;
  onReset(): void;
  onRunTrials(): void;
}

/** The controls: one switch per layer with what it caught and what it cost, two sliders, and the run controls. */
export function Panel({ config, tally, playing, running, onConfig, onPlay, onReset, onRunTrials }: PanelProps) {
  const toggle = (layer: LayerId) => (on: boolean) => onConfig({ ...config, layers: { ...config.layers, [layer]: on } });

  const rowShell = (layer: LayerId, body: ReactNode) => {
    const on = config.layers[layer];
    return (
      <div
        key={layer}
        className={`flex flex-col rounded-[10px] ${on ? "" : "border border-dashed border-escape/35"}`}
        style={on ? { background: ROWS[layer].tint } : undefined}
      >
        {body}
      </div>
    );
  };

  const right = (layer: LayerId) => {
    const t = tally.byLayer[layer];
    if (layer === "monitor" && config.layers.audit) return <Counts top={`${tally.flagged} flagged`} cost={costLabel(t.costShare)} />;
    return <Counts top={String(t.caught)} cost={costLabel(t.costShare)} />;
  };

  return (
    <form
      aria-label="Containment layers"
      onSubmit={(e) => e.preventDefault()}
      className="box-border flex min-w-0 flex-[0_1_330px] flex-col gap-1.5 rounded-[14px] border border-panel-border bg-panel p-[18px]"
    >
      <div className="flex items-baseline justify-between pb-1.5 font-mono text-[10px]">
        <span className="tracking-[0.14em] text-label">LAYERS, INSIDE OUT</span>
        <span className="tracking-[0.1em] text-faint">CAUGHT / COST</span>
      </div>

      {LAYER_ORDER.map((layer) =>
        rowShell(
          layer,
          <>
            <LayerSwitch layer={layer} on={config.layers[layer]} onToggle={toggle(layer)} right={right(layer)} />
            {layer === "monitor" ? (
              <Slider
                name="monitor"
                label="Flag above suspicion"
                value={score(config.monitorThreshold)}
                min={0}
                max={100}
                current={Math.round(config.monitorThreshold * 100)}
                onChange={(v) => onConfig({ ...config, monitorThreshold: v / 100 })}
                dim={!config.layers.monitor}
              />
            ) : null}
            {layer === "audit" ? (
              <Slider
                name="audit"
                label="Review budget"
                value={`${Math.round(config.auditBudget * 100)}% of actions`}
                min={0}
                max={10}
                current={Math.round(config.auditBudget * 100)}
                onChange={(v) => onConfig({ ...config, auditBudget: v / 100 })}
                dim={!config.layers.audit}
              />
            ) : null}
          </>,
        ),
      )}

      <div className="mt-1.5 flex justify-between border-t border-[rgba(150,172,214,0.12)] pt-3 font-mono text-xs text-muted">
        <span>{tally.agents.toLocaleString("en-US")} agents</span>
        <span className="text-escape-text">{tally.rogues} with a hidden goal</span>
      </div>
      <div className="grow" />
      <div className="flex gap-2">
        <button
          type="button"
          aria-label={playing ? "Pause the simulation" : "Resume the simulation"}
          onClick={() => onPlay(!playing)}
          className="flex min-h-12 w-12 items-center justify-center rounded-[10px] border border-[rgba(150,172,214,0.22)] bg-transparent hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:outline-none"
        >
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M3.5 2v10M10.5 2v10" stroke="#eef2f8" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M3.5 2.2v9.6L11.5 7z" fill="#eef2f8" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={onReset}
          className="min-h-12 flex-[1_1_0] rounded-[10px] border border-[rgba(150,172,214,0.22)] bg-transparent text-sm text-body hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:outline-none"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={onRunTrials}
          disabled={running}
          data-run-trials
          className="min-h-12 flex-[2_1_0] rounded-[10px] border-0 bg-ink text-sm font-bold text-ground hover:bg-white focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:ring-offset-2 focus-visible:ring-offset-ground focus-visible:outline-none disabled:cursor-wait disabled:opacity-70"
        >
          {running ? "Running 100 trials..." : "Run 100 trials"}
        </button>
      </div>
    </form>
  );
}
