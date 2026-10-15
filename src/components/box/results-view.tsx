"use client";

import { useMemo } from "react";
import { clock } from "@/engine/box/explain";
import type { BranchOutcome } from "@/lib/box/branch";
import type { LayerId } from "@/lib/box/types";
import type { World } from "@/lib/box/world";
import type { LabId, Scenario } from "@/lib/box/world-types";
import { BranchCard } from "./branch-card";
import type { PlotPoint } from "./plot";
import { setupDiff } from "./setup-diff";
import { button } from "./toolbar";
import { TrialsPlot } from "./trials-plot";

export interface ResultsProps {
  /** Shown as a page over the Watch layout; hidden (but mounted) otherwise, so the plot and the branch card keep their state. */
  open: boolean;
  points: readonly PlotPoint[];
  currentKey: string;
  running: boolean;
  labels: Readonly<Record<string, string>>;
  /** The setup as it stands now (the labs' settings), diffed against Breakout. */
  scenario: Scenario;
  /** The tick the branch starts from (the scrubbed one), the live head, and the world rebuilt there. */
  at: number;
  head: number;
  world: World | null;
  hint: { lab: LabId; layer: LayerId } | null;
  /** While rewound: the outcome so far at the scrubbed tick. */
  rewound: { at: number; outcome: BranchOutcome } | null;
  onBack(): void;
  onRun(): void;
  onWatch(lab: LabId, layer: LayerId, at: number): void;
  onKeep(lab: LabId, layer: LayerId): void;
}

const eyebrow = "font-mono text-[10px] tracking-[0.14em] text-label uppercase";
const panel = "rounded-[14px] border border-panel-border bg-panel";

/** The Results page: the large trials plot with a sentence about the current setup, how it differs from Breakout, and the branch card. In-page (`?view=results`), not a route, so the points and the engine state survive. */
export function ResultsView({ open, points, currentKey, running, labels, scenario, at, head, world, hint, rewound, onBack, onRun, onWatch, onKeep }: ResultsProps) {
  const current = points.find((p) => p.key === currentKey);
  const diff = useMemo(() => setupDiff(scenario), [scenario]);
  return (
    <div hidden={!open} className="min-h-full bg-ground text-ink" data-results-view>
      <header className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-[rgba(150,172,214,0.12)] bg-chrome px-6 py-3 max-[915px]:px-4">
        <button type="button" onClick={onBack} className={`${button} gap-2`} data-back-to-map>
          <span aria-hidden="true">{"←"}</span> Back to the map
        </button>
        <span className="font-mono text-[13px] tracking-[0.14em] whitespace-nowrap text-ink">
          SWARM <span className="text-rule">/</span> <b className="font-semibold text-ink-strong">THE BOX</b> <span className="text-rule">/</span> RESULTS
        </span>
        <span className="rounded-full border border-escape/45 px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] text-escape-text">SIMULATION</span>
        <span className="ml-auto max-w-[360px] text-xs leading-[1.35] text-faint max-[915px]:ml-0 max-[915px]:max-w-none">
          The numbers are tuned for a readable picture, not measured. Use them to compare setups, not to rate a real system.
        </span>
      </header>
      <div id="results" data-results className="flex flex-wrap items-start gap-4 px-6 py-5 max-[915px]:flex-col max-[915px]:items-stretch max-[915px]:px-4">
        <section aria-label="100 trials per setup" className={`${panel} flex min-w-0 flex-[999_1_640px] flex-col gap-3.5 px-[22px] py-5 max-[915px]:flex-none max-[915px]:px-4`}>
          <div className="flex flex-wrap items-end gap-4">
            {/* 260 px, or the card's whole width where that is less (a 320 phone), so the floor never widens the card. */}
            <div className="min-w-[min(260px,100%)] flex-1">
              <div className={eyebrow}>100 trials per setup</div>
              <h1 className="m-0 mt-1.5 text-2xl font-bold text-ink-strong" data-headline>
                {current
                  ? `Your setup stops ${Math.round(current.safety * 100)} of 100 breakouts and keeps ${Math.round(current.usefulness * 100)}% of the work.`
                  : "Run 100 trials to see how many breakouts your setup stops."}
              </h1>
            </div>
            <button
              type="button"
              onClick={onRun}
              disabled={running}
              data-run-more
              className="min-h-11 rounded-[10px] border border-ink bg-ink px-3.5 text-sm font-bold text-ground hover:bg-white focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:ring-offset-2 focus-visible:ring-offset-ground focus-visible:outline-none disabled:cursor-wait disabled:opacity-70"
            >
              {running ? "Running 100 trials..." : "Run 100 more"}
            </button>
          </div>
          <div className="flex flex-wrap items-start gap-5 max-[915px]:flex-col max-[915px]:items-stretch">
            <div className="min-w-0 flex-[999_1_460px] max-[915px]:flex-none">
              <TrialsPlot points={points} currentKey={currentKey} running={running} labels={labels} large />
            </div>
            <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-2.5 max-[915px]:flex-none">
              <h2 className={`${eyebrow} m-0 font-normal`}>How your setup differs from Breakout</h2>
              {diff.length ? (
                <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[13px] text-body" data-setup-diff>
                  {diff.flatMap((d) =>
                    d.changes.map((c) => (
                      <li key={`${d.lab}-${c}`} className="flex gap-2">
                        <span className="font-mono text-layer-2">{d.name}</span>
                        <span>{c}</span>
                      </li>
                    )),
                  )}
                </ul>
              ) : (
                <p className="m-0 text-[13px] text-body" data-setup-diff>
                  No changes from the Breakout preset.
                </p>
              )}
              <p className="m-0 mt-1.5 text-[13px] leading-normal text-muted">Dots on the dashed line are the best trade-offs found so far. Anything below it gives up work for nothing.</p>
            </div>
          </div>
        </section>
        <div className="flex min-w-0 max-w-[460px] flex-[1_1_380px] flex-col gap-3 max-[915px]:max-w-none max-[915px]:flex-none">
          {rewound ? (
            <p className="m-0 rounded-[14px] border border-panel-border bg-panel px-[18px] py-3 font-mono text-xs text-muted" data-rewound>
              At T+{clock(rewound.at)}: {rewound.outcome.escapes} escaped, {rewound.outcome.crossings} breaches of another lab, {rewound.outcome.caught} caught.
            </p>
          ) : null}
          <BranchCard scenario={scenario} at={at} live={head} world={world} hint={hint} onWatch={onWatch} onKeep={onKeep} />
        </div>
      </div>
    </div>
  );
}

/** Over the map after "Watch the branch": when the run was forked, and the way back to the original. */
export function BranchedPill({ at, onBack, inline = false }: { at: number; onBack(): void; /** Above the scene rather than over it (a phone's short scene has no room to spare). */ inline?: boolean }) {
  return (
    <div className={`${inline ? "scroll-mt-3 self-start" : "absolute top-3 left-3 z-10"} flex flex-wrap items-center gap-2 rounded-xl border border-layer-2/50 bg-chrome py-1 pr-1 pl-3`} data-branched-pill>
      <span className="font-mono text-xs tracking-[0.1em] text-ink-strong">
        <span aria-hidden="true">{"⑂ "}</span>Branched at T+{clock(at)}
      </span>
      <button type="button" onClick={onBack} className={`${button} text-xs`} data-unbranch>
        Back to the original
      </button>
    </div>
  );
}
