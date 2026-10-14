"use client";

import { useId } from "react";
import { Modal, dialogButton } from "./modal";
import { SHORTCUTS } from "./shortcuts";
import type { ActId } from "./tour-state";

const ACT_NAME: Record<ActId, string> = { inside: "Act 1, Inside", box: "Act 2, The Box" };

function Cap({ children }: { children: string }) {
  // "to" joins a range of keys ("1 to 9"); it is a word, not a key.
  if (children === "to") return <span className="px-0.5 text-label">to</span>;
  return <kbd className="inline-flex min-w-7 items-center justify-center rounded-md border border-panel-border bg-control px-1.5 py-0.5 font-mono text-xs text-ink">{children}</kbd>;
}

/** The "?" sheet: the keys this act answers. Closes on Escape or on "?" again. */
export function HelpSheet({ act, fallback, onClose, onTour }: { act: ActId; fallback: boolean; onClose(): void; onTour(): void }) {
  const id = useId();
  return (
    <Modal labelledBy={`${id}-title`} onClose={onClose} closeKey="?" data-dialog={`help-${act}`}>
      <div className="flex flex-col gap-4 p-5 sm:p-6">
        <div>
          <p className="m-0 font-mono text-[11px] tracking-[0.16em] text-label">{ACT_NAME[act].toUpperCase()}</p>
          <h2 id={`${id}-title`} className="m-0 mt-1 text-xl font-bold tracking-[-0.01em] text-ink-strong">
            Keyboard shortcuts
          </h2>
        </div>
        <dl className="m-0 flex flex-col gap-2.5" data-shortcuts>
          {SHORTCUTS[act].map((s) => (
            <div key={s.keys.join("+") + s.does} className="grid grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] items-center gap-3">
              <dt className="flex flex-wrap items-center gap-1">
                {s.keys.map((k, i) => (
                  <Cap key={`${k}-${i}`}>{k}</Cap>
                ))}
              </dt>
              <dd className="m-0 text-sm leading-snug text-body">{s.does}</dd>
            </div>
          ))}
        </dl>
        {fallback ? (
          <p className="m-0 text-[13px] leading-snug text-muted" data-fallback-note>
            This browser has no WebGPU, so the scene is drawn with WebGL 2: a simpler look, the same story.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onTour} className={dialogButton} data-help-tour>
            Replay the tour
          </button>
          <span className="grow" />
          <button type="button" data-autofocus onClick={onClose} className={dialogButton} data-help-close>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
