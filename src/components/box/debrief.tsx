"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { clock, LAYER_NAME } from "@/engine/box/explain";
import { INTERCEPT_NOTICE } from "@/lib/box/intercept";
import type { LayerId } from "@/lib/box/types";
import type { BreakoutStep, InterceptLine } from "@/lib/box/world-types";
import { nextInterceptLine } from "./playground";
import { button } from "./toolbar";

/**
 * A marker's detail card: what happened, where, and which layer switched on alone would have
 * stopped it (proved by replay, not guessed). Not modal, so it never traps focus; Escape closes it
 * and puts focus back on the marker.
 */
export function MarkerCard({
  n,
  tick,
  step,
  onClose,
  onReplayWith,
}: {
  n: number;
  tick: number;
  step: BreakoutStep | null;
  onClose(): void;
  onReplayWith(layer: LayerId): void;
}) {
  const close = () => {
    onClose();
    // Back to the numbered button this card came from.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-step-marker="${n}"]`)?.focus());
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };
  return (
    <section
      aria-label={`Marker ${n} detail`}
      onKeyDown={onKey}
      className="flex flex-col gap-2 rounded-[14px] border border-escape/45 bg-[linear-gradient(180deg,rgba(255,77,125,0.1),rgba(255,77,125,0.03))] px-4 py-3"
      data-marker-card={n}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] tracking-[0.12em] text-escape-text">
          STEP {n} / {step ? step.where : "WORKING IT OUT"} / T+{clock(tick)}
        </span>
        <button type="button" onClick={close} className={`${button} min-h-9 text-xs`} data-close-card>
          Close
        </button>
      </div>
      {step ? (
        <>
          <h3 className="m-0 text-base font-bold tracking-[-0.01em] text-ink">{step.title}</h3>
          <p className="m-0 text-xs leading-snug text-muted">{step.body}</p>
          <div className="flex flex-col gap-1 rounded-lg bg-white/[0.04] px-3 py-2">
            <span className="font-mono text-[10px] tracking-[0.14em] text-haiku">WOULD HAVE STOPPED IT</span>
            <span className="text-sm font-semibold text-body" data-stopped-by>
              {step.stoppedBy.length > 0 ? step.stoppedBy.map((l) => LAYER_NAME[l]).join(", ") : "No single layer."}
            </span>
            <span className="text-xs text-label">{step.stop}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {step.stoppedBy.map((l) => (
              <button key={l} type="button" data-replay-with={l} onClick={() => onReplayWith(l)} className={button}>
                Replay with {step.stoppedBy.length > 1 ? `the ${LAYER_NAME[l].toLowerCase()}` : "this"} switched on
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="m-0 text-sm text-label">Replaying the run with each layer on, one at a time, to see which would have stopped it.</p>
      )}
    </section>
  );
}

/** Ms between two spoken lines of the intercepted chat. */
const SPEAK_GAP = 4000;

/**
 * The intercepted chat. Fiction from templates, and the notice says so above the lines. The log is
 * for reading; a separate polite status speaks at most one new line every few seconds.
 */
export function InterceptPanel({ lines }: { lines: readonly InterceptLine[] }) {
  const spoken = useRef(lines.length);
  const lastAt = useRef(-1e9);
  const [said, setSaid] = useState("");
  useEffect(() => {
    const check = () => {
      if (lines.length < spoken.current) spoken.current = lines.length;
      const now = performance.now();
      const next = nextInterceptLine(lines, spoken.current, lastAt.current, now, SPEAK_GAP);
      if (next) {
        spoken.current = lines.length;
        lastAt.current = now;
        setSaid(`${next.who}: ${next.text}`);
      }
    };
    check();
    const id = window.setInterval(check, 1000);
    return () => window.clearInterval(id);
  }, [lines]);
  const shown = lines.slice(-6);
  return (
    <section aria-label="Intercepted conversation" className="box-border flex flex-col gap-2 rounded-[14px] border border-panel-border bg-panel px-3.5 py-3 text-xs leading-[1.45]" data-intercept>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] tracking-[0.14em] text-label">INTERCEPTED</span>
        <span className="rounded-full border border-escape/50 px-2 py-0.5 font-mono text-[10px] tracking-[0.12em] text-escape-text">FICTION</span>
      </div>
      <p className="m-0 text-faint" data-intercept-notice>
        {INTERCEPT_NOTICE}
      </p>
      <div role="log" aria-live="off" aria-label="Intercepted lines" className="flex flex-col gap-2">
        {shown.length === 0 ? <p className="m-0 text-faint">Nothing intercepted yet.</p> : null}
        {shown.map((l) => (
          <p key={`${l.tick}-${l.who}-${l.text}`} className="m-0 text-muted" data-intercept-line>
            <span className="font-mono text-faint">{clock(l.tick)}</span> <b className="font-mono text-[11px] text-ink">{l.who}</b> {l.text}
          </p>
        ))}
      </div>
      <p role="status" aria-live="polite" className="sr-only" data-intercept-status>
        {said}
      </p>
    </section>
  );
}
