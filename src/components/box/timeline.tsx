"use client";

import { useState } from "react";
import type { MarkerView } from "@/engine/box/overlay";
import { clock, LAYER_NAME } from "@/engine/box/explain";
import { compareBranch, snapshotWorld, type BranchOutcome } from "@/lib/box/branch";
import { LAYER_ORDER, type LayerId } from "@/lib/box/types";
import type { World } from "@/lib/box/world";
import { LAB_NAME, type LabId, type Scenario } from "@/lib/box/world-types";
import { button } from "./toolbar";

/**
 * The run's ticks as a scrubber, with the numbered markers pinned on it. Dragging it rewinds the
 * debrief (the numbers, the chat and the branch below) to that tick; "Back to live" lets go.
 */
export function Timeline({
  tick,
  cursor,
  markers,
  selected,
  onCursor,
  onPick,
}: {
  tick: number;
  cursor: number | null;
  markers: readonly MarkerView[];
  selected: number | null;
  onCursor(t: number | null): void;
  onPick(n: number): void;
}) {
  const max = Math.max(tick, 1);
  const at = cursor ?? tick;
  const shown = markers.filter((m) => m.shown && m.tick <= max);
  return (
    <section aria-label="Timeline" className="flex flex-col gap-1.5 rounded-[14px] border border-panel-border bg-panel px-3.5 py-2.5" data-timeline>
      <div className="flex items-center justify-between gap-2 font-mono text-[11px] text-label">
        <span>
          {cursor === null ? "LIVE" : "REWOUND"} <span className="text-ink">T+{clock(at)}</span> <span className="text-faint">tick {at}</span>
        </span>
        <button type="button" disabled={cursor === null} onClick={() => onCursor(null)} className={`${button} min-h-9 text-xs`} data-back-to-live>
          Back to live
        </button>
      </div>
      <div className="relative h-7" aria-label="Markers on the timeline" role="group">
        {shown.map((m) => (
          <button
            key={m.n}
            type="button"
            data-timeline-marker={m.n}
            aria-pressed={selected === m.n}
            aria-label={`Marker ${m.n} at tick ${m.tick}`}
            onClick={() => {
              // One tick before the step: a layer switched on at the step's own tick would be too late.
              onCursor(Math.max(0, m.tick - 1));
              onPick(m.n);
            }}
            className={`absolute top-0 flex h-6 min-w-6 -translate-x-1/2 items-center justify-center rounded-full border px-1 font-mono text-[11px] font-bold focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:outline-none ${
              selected === m.n ? "border-ink bg-escape text-ground" : "border-escape bg-ground text-escape-text"
            }`}
            style={{ left: `${(m.tick / max) * 100}%` }}
          >
            {m.n}
          </button>
        ))}
      </div>
      <input
        type="range"
        min={0}
        max={max}
        value={Math.min(at, max)}
        aria-label="Rewind to a tick"
        aria-valuetext={`tick ${at}, ${cursor === null ? "live" : "rewound"}`}
        data-scrubber-box
        onChange={(e) => {
          const v = Number(e.target.value);
          onCursor(v >= max ? null : v);
        }}
        className="m-0 h-7 w-full cursor-pointer accent-layer-2"
      />
    </section>
  );
}

const ROWS: { key: keyof BranchOutcome; label: string; fmt(v: number): string }[] = [
  { key: "escapes", label: "Escapes", fmt: String },
  { key: "crossings", label: "Breaches of another lab", fmt: String },
  { key: "caught", label: "Agents caught", fmt: String },
  { key: "work", label: "Useful work", fmt: (v) => Math.round(v).toLocaleString("en-US") },
];

/** Ticks past the live tick that both branches run, so the difference has room to show. */
const HORIZON_PAD = 60;

/**
 * "Branch here with one switch flipped": rebuild the world at the scrubbed tick, flip one layer on in
 * one lab, run both on to the present (and a little past it) and put the two outcomes side by side.
 */
export function BranchCard({
  scenario,
  at,
  live,
  world,
  hint,
}: {
  scenario: Scenario;
  at: number;
  live: number;
  world: World | null;
  /** The lab and layer the selected step says would have stopped it: the branch starts there. */
  hint?: { lab: LabId; layer: LayerId } | null;
}) {
  const [lab, setLab] = useState<LabId | null>(null);
  const [layer, setLayer] = useState<LayerId | "">("");
  const [stored, setResult] = useState<{ from: World | null; at: number; lab: LabId; layer: LayerId; base: BranchOutcome; branch: BranchOutcome } | null>(null);
  const [busy, setBusy] = useState(false);
  // A comparison belongs to the world it was run from; a new tick or world makes it stale.
  const result = stored && stored.from === world ? stored : null;
  // The layers that are off in a lab at the scrubbed tick: the only ones a flip can change.
  // The replayed world can lag the scenario by a render (a lab was just added): such a lab has nothing yet.
  const offIn = (id: LabId): LayerId[] => {
    const rt = world?.labs.find((l) => l.id === id);
    return rt ? LAYER_ORDER.filter((l) => !rt.state.config.layers[l]) : [];
  };
  // Until the visitor picks one, the first lab that has something to switch on.
  const has = (id: LabId | null | undefined): id is LabId => !!id && scenario.labs.some((l) => l.id === id);
  const labId = has(lab) ? lab : has(hint?.lab) ? hint!.lab : (scenario.labs.find((l) => offIn(l.id).length > 0)?.id ?? scenario.labs[0].id);
  const off = offIn(labId);
  const chosen: LayerId | null = layer && off.includes(layer) ? layer : hint && hint.lab === labId && off.includes(hint.layer) ? hint.layer : (off[0] ?? null);
  const run = () => {
    if (!chosen) return;
    setBusy(true);
    window.setTimeout(() => {
      const { base, branch } = compareBranch(snapshotWorld(world!), { lab: labId, layer: chosen, on: true }, Math.max(120, live - at + HORIZON_PAD));
      setResult({ from: world, at: world!.tick, lab: labId, layer: chosen, base, branch });
      setBusy(false);
    }, 0);
  };
  return (
    <section aria-label="Branch" className="flex flex-col gap-3 rounded-[14px] border border-panel-border bg-panel px-[18px] py-4" data-branch-card>
      <span className="font-mono text-[10px] tracking-[0.14em] text-label">BRANCH FROM TICK {at}</span>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Lab to change" value={labId} onChange={(e) => setLab(e.target.value as LabId)} className="min-h-9 rounded-lg border border-[rgba(150,172,214,0.22)] bg-ground px-2 text-sm text-body focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:outline-none">
          {scenario.labs.map((l) => (
            <option key={l.id} value={l.id}>
              {LAB_NAME[l.id]}
            </option>
          ))}
        </select>
        <select
          aria-label="Layer to switch on"
          value={chosen ?? ""}
          disabled={off.length === 0}
          onChange={(e) => setLayer(e.target.value as LayerId)}
          className="min-h-9 rounded-lg border border-[rgba(150,172,214,0.22)] bg-ground px-2 text-sm text-body focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:outline-none disabled:opacity-50"
        >
          {off.length === 0 ? <option value="">Every layer is on</option> : null}
          {off.map((l) => (
            <option key={l} value={l}>
              {LAYER_NAME[l]}
            </option>
          ))}
        </select>
        <button type="button" disabled={!chosen || !world || busy} onClick={run} className={button} data-branch>
          {busy ? "Running both..." : chosen ? `Branch here with the ${LAYER_NAME[chosen].toLowerCase()} switched on` : "Nothing to flip here"}
        </button>
      </div>
      {result ? (
        <table className="w-full border-collapse text-left font-mono text-xs" data-branch-result>
          <caption className="pb-1.5 text-left text-label">
            {LAB_NAME[result.lab]} with the {LAYER_NAME[result.layer].toLowerCase()} on from tick {result.at}
          </caption>
          <thead>
            <tr className="text-faint">
              <th scope="col" className="py-1 font-normal">
                &nbsp;
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                Original
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                Branch
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => {
              const better = r.key === "caught" || r.key === "work" ? result.branch[r.key] > result.base[r.key] : result.branch[r.key] < result.base[r.key];
              return (
                <tr key={r.key} className="border-t border-[rgba(150,172,214,0.12)]">
                  <th scope="row" className="py-1.5 font-normal text-muted">
                    {r.label}
                  </th>
                  <td className="py-1.5 text-right text-ink" data-original={r.key}>
                    {r.fmt(result.base[r.key])}
                  </td>
                  <td className={`py-1.5 text-right ${better ? "text-haiku" : "text-ink"}`} data-branched={r.key}>
                    {r.fmt(result.branch[r.key])}
                    {better ? <span className="sr-only"> (better)</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="m-0 text-xs text-label">Both runs share everything up to the tick, then one lab gets one more layer.</p>
      )}
    </section>
  );
}
