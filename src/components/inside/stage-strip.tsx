"use client";

import { useCallback, useMemo } from "react";
import type { InsideApp } from "@/engine/inside/app";
import { inferStages, stageAt, type StageId } from "@/engine/inside/stages";
import { useEngineSnapshot, useTimeline } from "./use-engine";

/** Each stage's colour, as the design's strip: lit fills with it, past stages keep it as a rule. */
const TONE: Record<StageId, string> = {
  plan: "var(--opus)",
  explore: "var(--sonnet)",
  build: "var(--haiku)",
  verify: "var(--warn)",
  review: "var(--fable)",
  deliver: "var(--ink-strong)",
};

/**
 * The run's stages across the top. The trace has no stages: they are read off the tool mix, so the
 * strip says INFERRED. The current stage is lit; a click seeks to where it begins.
 */
export function StageStrip({ app, compact = false }: { app: InsideApp; compact?: boolean }) {
  const tl = useTimeline(app);
  const stages = useMemo(() => inferStages(tl.trace), [tl]);
  const read = useCallback(() => stageAt(stages, app.time())?.id ?? null, [app, stages]);
  const current = useEngineSnapshot(read, Object.is, 100);
  if (stages.length === 0) return null;
  const span = tl.duration || 1;
  const order = stages.findIndex((s) => s.id === current);

  return (
    <nav aria-label="Session stages, inferred from tool use" data-stages className={`pointer-events-auto flex min-w-0 items-stretch ${compact ? "flex-wrap gap-x-2 gap-y-0.5" : "gap-3"}`}>
      <span className={`flex items-center font-mono text-[9px] tracking-[0.16em] text-faint ${compact ? "basis-full" : "shrink-0"}`}>
        STAGES <span className="ml-1.5 rounded-sm border border-rule px-1 py-px text-[8px] text-label">INFERRED</span>
      </span>
      <ol className="m-0 flex min-w-0 flex-1 list-none gap-0.5 p-0">
        {stages.map((s, i) => {
          const on = s.id === current;
          const done = order >= 0 && i < order;
          return (
            <li key={s.id} className="min-w-0" style={{ flex: `${Math.max(0.1, (s.end - s.start) / span)} 1 0` }}>
              <button
                type="button"
                data-stage={s.id}
                aria-current={on ? "step" : undefined}
                aria-label={`${s.label}, inferred stage, from ${Math.round(s.start)} seconds: seek here`}
                onClick={() => app.seek(s.start)}
                style={on ? { background: `color-mix(in srgb, ${TONE[s.id]} 16%, transparent)`, borderTopColor: TONE[s.id], color: TONE[s.id] } : { borderTopColor: done ? TONE[s.id] : "var(--control)" }}
                className={`flex w-full min-w-0 items-center truncate border-0 border-t-2 px-2 text-left font-mono tracking-[0.14em] outline-none focus-visible:ring-2 focus-visible:ring-layer-1 ${
                  compact ? "min-h-8 text-[9px]" : "min-h-8 text-[10px]"
                } ${on ? "font-bold" : done ? "bg-transparent text-muted hover:text-ink" : "bg-transparent text-rule hover:text-label"}`}
              >
                <span className="truncate">
                  {compact ? "" : `${String(i + 1).padStart(2, "0")} `}
                  {s.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
