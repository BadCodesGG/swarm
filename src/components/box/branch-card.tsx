"use client";

import { useState } from "react";
import { clock, LAYER_NAME } from "@/engine/box/explain";
import { compareBranch, snapshotWorld, type BranchOutcome } from "@/lib/box/branch";
import { LAYER_ORDER, type LayerId } from "@/lib/box/types";
import type { World } from "@/lib/box/world";
import { LAB_NAME, type LabId, type Scenario } from "@/lib/box/world-types";
import { button } from "./toolbar";

const ROWS: { key: keyof BranchOutcome; label: string; fmt(v: number): string }[] = [
  { key: "escapes", label: "Escapes", fmt: String },
  { key: "crossings", label: "Breaches of another lab", fmt: String },
  { key: "caught", label: "Agents caught", fmt: String },
  { key: "work", label: "Useful work", fmt: (v) => Math.round(v).toLocaleString("en-US") },
];

/** Ticks past the live tick that both branches run, so the difference has room to show. */
const HORIZON_PAD = 60;

const select =
  "min-h-11 w-full rounded-lg border border-[rgba(150,172,214,0.22)] bg-ground px-2.5 text-sm text-ink focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:outline-none disabled:opacity-50";
const eyebrow = "font-mono text-[10px] tracking-[0.14em] text-label uppercase";

/**
 * "What if, from T+mm:ss": rebuild the world at the chosen tick, flip one layer on in one lab, run
 * both on to the present (and a little past it) and put the two outcomes side by side. "Watch the
 * branch" forks the live run there; "Keep this change" switches the layer on now.
 */
export function BranchCard({
  scenario,
  at,
  live,
  world,
  hint,
  onWatch,
  onKeep,
}: {
  scenario: Scenario;
  at: number;
  live: number;
  world: World | null;
  /** The lab and layer the selected step says would have stopped it: the branch starts there. */
  hint?: { lab: LabId; layer: LayerId } | null;
  onWatch(lab: LabId, layer: LayerId, at: number): void;
  onKeep(lab: LabId, layer: LayerId): void;
}) {
  const [lab, setLab] = useState<LabId | null>(null);
  const [layer, setLayer] = useState<LayerId | "">("");
  const [stored, setResult] = useState<{ from: World | null; at: number; lab: LabId; layer: LayerId; base: BranchOutcome; branch: BranchOutcome } | null>(null);
  const [busy, setBusy] = useState(false);
  // A comparison belongs to the world it was run from; a new tick or world makes it stale.
  const result = stored && stored.from === world ? stored : null;
  // The layers that are off in a lab at the tick: the only ones a flip can change.
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
  const ready = !!chosen && !!world;
  return (
    <section aria-label="Branch from a tick" className="flex min-w-0 flex-col gap-3.5 rounded-[14px] border border-panel-border bg-panel p-5" data-branch-card>
      <span className={eyebrow}>What if, from T+{clock(at)}</span>
      <h2 className="m-0 text-xl font-bold text-ink-strong">One change, same run up to that moment.</h2>
      <div className="flex flex-wrap gap-2">
        <label className="flex min-w-[140px] flex-1 flex-col gap-1">
          <span className={eyebrow}>Lab</span>
          <select aria-label="Lab to change" value={labId} onChange={(e) => setLab(e.target.value as LabId)} className={select}>
            {scenario.labs.map((l) => (
              <option key={l.id} value={l.id}>
                {LAB_NAME[l.id]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[140px] flex-1 flex-col gap-1">
          <span className={eyebrow}>Switch on</span>
          <select aria-label="Layer to switch on" value={chosen ?? ""} disabled={off.length === 0} onChange={(e) => setLayer(e.target.value as LayerId)} className={select}>
            {off.length === 0 ? <option value="">Every layer is on</option> : null}
            {off.map((l) => (
              <option key={l} value={l}>
                {LAYER_NAME[l]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button type="button" disabled={!ready || busy} onClick={run} className={`${button} self-start`} data-branch>
        {busy ? "Running both..." : chosen ? `Compare with the ${LAYER_NAME[chosen].toLowerCase()} on` : "Nothing to flip here"}
      </button>
      {result ? (
        <table className="w-full border-collapse text-left text-sm" data-branch-result>
          <caption className={`${eyebrow} pb-1.5 text-left`}>
            {LAB_NAME[result.lab]} with the {LAYER_NAME[result.layer].toLowerCase()} on from T+
            {clock(result.at)}
          </caption>
          <thead>
            <tr className={eyebrow}>
              <th scope="col" className="border-b border-[rgba(150,172,214,0.12)] px-2 py-2.5 text-left font-normal">
                <span className="sr-only">Measure</span>
              </th>
              <th scope="col" className="border-b border-[rgba(150,172,214,0.12)] px-2 py-2.5 text-right font-normal">
                Original
              </th>
              <th scope="col" className="border-b border-[rgba(150,172,214,0.12)] px-2 py-2.5 text-right font-normal">
                Branch
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => {
              const better = r.key === "caught" || r.key === "work" ? result.branch[r.key] > result.base[r.key] : result.branch[r.key] < result.base[r.key];
              return (
                <tr key={r.key}>
                  <th scope="row" className="border-b border-[rgba(150,172,214,0.12)] px-2 py-2.5 text-left font-medium text-body">
                    {r.label}
                  </th>
                  <td className="border-b border-[rgba(150,172,214,0.12)] px-2 py-2.5 text-right font-mono text-ink" data-original={r.key}>
                    {r.fmt(result.base[r.key])}
                  </td>
                  <td className={`border-b border-[rgba(150,172,214,0.12)] px-2 py-2.5 text-right font-mono ${better ? "text-haiku" : "text-ink"}`} data-branched={r.key}>
                    {r.fmt(result.branch[r.key])}
                    {better ? <span className="ml-1 text-[10px]">better</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="m-0 text-xs leading-[1.45] text-label">Both runs share everything up to the tick, then one lab gets one more layer.</p>
      )}
      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        <button type="button" disabled={!ready} onClick={() => chosen && onWatch(labId, chosen, at)} className={`${button} flex-1`} data-watch-branch>
          Watch the branch
        </button>
        <button type="button" disabled={!ready} onClick={() => chosen && onKeep(labId, chosen)} className={`${button} flex-1`} data-keep-change>
          Keep this change
        </button>
      </div>
    </section>
  );
}
