"use client";

import { clock } from "@/engine/box/explain";
import type { BranchOutcome } from "@/lib/box/branch";
import type { LayerId } from "@/lib/box/types";
import type { World } from "@/lib/box/world";
import type { LabId, Scenario } from "@/lib/box/world-types";
import type { PlotPoint } from "./plot";
import { BranchCard } from "./timeline";
import { TrialsPlot } from "./trials-plot";

export interface ResultsProps {
  points: readonly PlotPoint[];
  currentKey: string;
  running: boolean;
  labels: Readonly<Record<string, string>>;
  scenario: Scenario;
  /** The tick the branch starts from (the scrubbed one), the live head, and the world rebuilt there. */
  at: number;
  head: number;
  world: World | null;
  hint: { lab: LabId; layer: LayerId } | null;
  /** While rewound: the outcome so far at the scrubbed tick. */
  rewound: { at: number; outcome: BranchOutcome } | null;
}

/**
 * The results: the trials plot, the outcome at a rewound tick and the branch from it. For now a
 * section under the first screen (`#results`, which "Open results" and "Branch from here" reach);
 * the Results board's in-page view (`?view=results`) is built here.
 */
export function ResultsView({ points, currentKey, running, labels, scenario, at, head, world, hint, rewound }: ResultsProps) {
  return (
    <section id="results" aria-label="Results" className="grid scroll-mt-4 grid-cols-[repeat(auto-fit,minmax(300px,1fr))] items-start gap-4" data-results>
      <TrialsPlot points={points} currentKey={currentKey} running={running} labels={labels} />
      <div className="flex flex-col gap-3">
        {rewound ? (
          <p className="m-0 rounded-[14px] border border-panel-border bg-panel px-[18px] py-3 font-mono text-xs text-muted" data-rewound>
            At T+{clock(rewound.at)}: {rewound.outcome.escapes} escaped, {rewound.outcome.crossings} breaches of another lab, {rewound.outcome.caught} caught.
          </p>
        ) : null}
        <BranchCard scenario={scenario} at={at} live={head} world={world} hint={hint} />
      </div>
    </section>
  );
}
