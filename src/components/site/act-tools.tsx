"use client";

import { useEffect, useState } from "react";
import { activeHandoff } from "@/lib/box/handoff";
import { HelpSheet } from "./help-sheet";
import { Tour } from "./tour";
import { markTourSeen, shouldShowTour, type ActId } from "./tour-state";

/** True when a key press is going to a text field, which must keep its "?". */
function typing(e: KeyboardEvent): boolean {
  const el = e.target instanceof HTMLElement ? e.target : null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

/** What an act tells the tools about how it is drawing. */
export interface ActRender {
  /** False when the scene runs on the WebGL 2 fallback. */
  isWebGPU: boolean;
  /** A still frame under reduced motion: there is no renderer to fall back from. */
  still?: boolean;
  /** `cpu` on the Box when the crowd runs off the GPU. */
  crowdMode?: "gpu" | "cpu";
}

const pill = "m-0 rounded-lg border bg-panel px-2 py-1 font-mono text-[9px] leading-none tracking-[0.08em] sm:text-[10px]";

/** Is the scene on the WebGL 2 fallback? A still frame has no renderer to fall back from. */
export const onFallback = (r: ActRender): boolean => !r.isWebGPU && !r.still;

/** The WebGL 2 badge: shown only when the engine runs without WebGPU. */
export function FallbackBadge({ render, className = "" }: { render: ActRender; className?: string }) {
  if (!onFallback(render)) return null;
  const cpu = render.crowdMode === "cpu";
  return (
    <p
      className={`${pill} border-warn/40 text-warn ${className}`}
      title={`No WebGPU in this browser: drawn with WebGL 2${cpu ? ", and the crowd moves on the CPU" : ""}. A simpler look, the same story.`}
      data-webgl-badge
    >
      WEBGL 2 MODE{cpu ? " / CPU CROWD" : ""}
    </p>
  );
}

/**
 * The page-level furniture of an act: the first-visit tour, the "?" button and sheet, the WebGL 2
 * badge, and on the Box the note that its cast came from Act 1. Mounted by the act's overlay, so
 * it only ever runs on the client, after the engine is up. `className` places the cluster.
 */
export function ActTools({ act, render, badge = true, float = false }: { act: ActId; render: ActRender; badge?: boolean; float?: boolean }) {
  const [touring, setTouring] = useState(() => shouldShowTour(act, { search: window.location.search, automated: navigator.webdriver === true }));
  const [help, setHelp] = useState(false);
  const fallback = onFallback(render);
  const [seeded] = useState(() => (act === "box" ? activeHandoff(new URLSearchParams(window.location.search)) : null));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typing(e)) return;
      e.preventDefault();
      setHelp(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const finishTour = () => {
    markTourSeen(act);
    setTouring(false);
  };

  const note = seeded ? (
    <p className={pill + " border-panel-border text-label"} data-handoff-note>
      ACT 1 CAST: {seeded.agents} AGENTS{seeded.models.length > 0 ? ` / ${seeded.models.length} MODEL${seeded.models.length === 1 ? "" : "S"}` : ""}
    </p>
  ) : null;

  const helpButton = (
    <button
      type="button"
      onClick={() => setHelp(true)}
      aria-label="Keyboard shortcuts"
      aria-keyshortcuts="?"
      aria-haspopup="dialog"
      title="Keyboard shortcuts (?)"
      className="pointer-events-auto flex size-11 shrink-0 items-center justify-center rounded-xl border border-panel-border bg-panel font-mono text-base text-label transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:outline-none"
      data-help-open
    >
      ?
    </button>
  );

  return (
    <>
      {float ? (
        <div className="pointer-events-none fixed inset-x-0 top-0.5 z-10 flex flex-wrap justify-center gap-1.5 px-2" data-act-status>
          {note}
          {badge ? <FallbackBadge render={render} /> : null}
        </div>
      ) : null}
      <div className={float ? "pointer-events-none fixed right-3 bottom-3 z-10" : "pointer-events-none flex items-center gap-2"} data-act-tools>
        {float ? null : note}
        {float || !badge ? null : <FallbackBadge render={render} />}
        {helpButton}
      </div>
      {touring ? <Tour act={act} onDone={finishTour} /> : null}
      {help && !touring ? (
        <HelpSheet
          act={act}
          fallback={fallback}
          onClose={() => setHelp(false)}
          onTour={() => {
            setHelp(false);
            setTouring(true);
          }}
        />
      ) : null}
    </>
  );
}
