"use client";

import type { ReactNode } from "react";
import { clock } from "@/engine/box/explain";
import type { LayerId } from "@/lib/box/types";
import { LAB_NAME, type LabId } from "@/lib/box/world-types";
import { NoStepsYet, StepBody, verdictOf } from "./story-rail";
import type { Pin } from "./timeline";
import { iconButton } from "./toolbar";

/**
 * The phone's current step, under the timeline: "Step n of N, lab", the title and what happened, the layer that
 * would have stopped it with the replay, and previous and next (44 px). With no step open it shows the
 * first one (`current` is that pin); with none reached yet, the story rail's "No steps yet" prompt on a
 * map of several labs, else a line on what to watch for. `lead` is the lone Box's escape explainer, which
 * has no steps.
 */
export function StepCard({
  steps,
  current,
  open,
  multi,
  lead,
  onStep,
  onReplayWith,
}: {
  steps: readonly Pin[];
  current: Pin | null;
  /** The step is the open one (its pin is lit on the map), not just the first shown for want of one. */
  open: boolean;
  /** A map of several labs (the prompt for no steps is theirs; a lone Box has its explainer). */
  multi: boolean;
  lead?: ReactNode;
  onStep(dir: 1 | -1): void;
  onReplayWith(lab: LabId, layer: LayerId): void;
}) {
  if (!current) {
    return (
      <section aria-label="Step" className="flex flex-col gap-2.5 rounded-[14px] border border-panel-border bg-panel p-4" data-step-card>
        {lead}
        {steps.length === 0 && multi ? (
          <NoStepsYet />
        ) : (
          <>
            <span className="font-mono text-[10px] tracking-[0.14em] text-label uppercase">What to watch</span>
            <p className="m-0 text-[13px] leading-normal text-muted">
              {steps.length === 0 ? "Numbered steps appear on the map and the timeline as the run reaches them. Tap one to read what happened." : "Tap a numbered step on the map or the timeline."}
            </p>
          </>
        )}
      </section>
    );
  }
  const v = verdictOf(current.step, current.kind);
  const total = steps.length;
  const place = steps.findIndex((s) => s.n === current.n) + 1;
  return (
    <article
      aria-label={`Step ${place} of ${total}`}
      className={`flex flex-col gap-2.5 rounded-[14px] border p-4 ${open ? "border-escape/45 bg-escape/[0.06]" : "border-panel-border bg-panel"}`}
      data-step-card
      data-marker-card={open ? current.n : undefined}
      data-step-card-n={current.n}
    >
      {lead}
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 font-mono text-[10px] tracking-[0.14em] text-label uppercase">
          Step {place} of {total}, {LAB_NAME[current.lab]}
        </span>
        <button type="button" aria-label="Previous step" aria-keyshortcuts="[" onClick={() => onStep(-1)} className={iconButton} data-step-prev>
          <span aria-hidden="true">{"←"}</span>
        </button>
        <button type="button" aria-label="Next step" aria-keyshortcuts="]" onClick={() => onStep(1)} className={iconButton} data-step-next>
          <span aria-hidden="true">{"→"}</span>
        </button>
      </div>
      <h2 className="m-0 text-lg font-bold text-ink-strong">{current.step?.title ?? "Working out what happened"}</h2>
      <p className="m-0 font-mono text-[10px] tracking-[0.1em] text-label">
        {current.step?.where ?? current.lab.toUpperCase()} <span className={v.tone}>{v.text}</span>, T+{clock(current.tick)}
      </p>
      <StepBody pin={current} onReplayWith={onReplayWith} />
    </article>
  );
}
