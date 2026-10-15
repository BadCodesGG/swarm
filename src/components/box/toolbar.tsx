"use client";

import { useEffect, useState } from "react";

export type Mode = "watch" | "defend" | "agent";

export const MODE_LABEL: Record<Mode, string> = { watch: "Watch", defend: "Defend", agent: "Play as the agent" };

/** The segmented control's short labels; the rest of each name is still read out. */
const MODE_SHORT: Record<Mode, [string, string]> = { watch: ["Watch", ""], defend: ["Defend", ""], agent: ["Play", " as the agent"] };

export const button =
  "inline-flex min-h-11 items-center justify-center rounded-[10px] border border-[rgba(150,172,214,0.22)] bg-transparent px-3.5 text-sm text-body hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-pressed:border-ink aria-pressed:bg-control aria-pressed:text-ink-strong";

/** A square 44 px button for an icon or a single glyph. */
export const iconButton =
  "flex size-11 shrink-0 items-center justify-center rounded-[10px] border border-[rgba(150,172,214,0.22)] bg-transparent text-body hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:outline-none";

/** The outer shell of a segmented control, and one of its segments (pressed reads in weight as well as fill). */
export const segment = "flex gap-0.5 rounded-xl border border-panel-border bg-chrome p-[3px]";
export const segmentItem =
  "min-h-[38px] rounded-[9px] border-0 bg-transparent px-3.5 text-sm text-muted hover:text-ink focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:outline-none aria-pressed:bg-control aria-pressed:font-semibold aria-pressed:text-ink-strong aria-selected:bg-control aria-selected:font-semibold aria-selected:text-ink-strong";

/** Watch, defend, or play the agent, as one segmented control. */
export function ModeSwitch({ mode, onMode }: { mode: Mode; onMode(m: Mode): void }) {
  return (
    <div role="group" aria-label="Mode" className={`${segment} max-[915px]:min-w-0 max-[915px]:flex-1`}>
      {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
        <button key={m} type="button" aria-pressed={mode === m} data-mode={m} onClick={() => onMode(m)} className={`${segmentItem} min-h-[38px] max-[915px]:min-h-11 max-[915px]:flex-1 max-[915px]:px-2`}>
          {MODE_SHORT[m][0]}
          {MODE_SHORT[m][1] ? <span className="sr-only">{MODE_SHORT[m][1]}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Puts the current scenario in the address bar and on the clipboard; what happened shows under the button. */
export function ShareButton({ link }: { link(): string }) {
  const [said, setSaid] = useState("");
  // The note under the button goes after a few seconds, so it never sits over the rail below.
  useEffect(() => {
    if (!said) return;
    const id = window.setTimeout(() => setSaid(""), 5000);
    return () => window.clearTimeout(id);
  }, [said]);
  const copy = async () => {
    const url = link();
    // The address bar carries the link even where the clipboard is blocked.
    window.history.replaceState(null, "", url);
    try {
      await navigator.clipboard.writeText(new URL(url, window.location.href).href);
      setSaid("Link copied.");
    } catch {
      setSaid("Could not copy. The link is in the address bar.");
    }
  };
  return (
    <div className="relative">
      <button type="button" data-copy-link aria-label="Copy link to this run" title="Copy link to this run" onClick={copy} className={iconButton}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M6.5 9.5l3-3M7 4.5l1.2-1.2a2.6 2.6 0 013.6 3.6L10.6 8M9 11.5l-1.2 1.2a2.6 2.6 0 01-3.6-3.6L5.4 8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
      <span
        role="status"
        className="absolute top-full right-0 z-20 mt-1.5 w-max max-w-[220px] rounded-lg border border-panel-border bg-panel px-2.5 py-1.5 text-xs text-label empty:border-0 empty:p-0"
        data-share-status
      >
        {said}
      </span>
    </div>
  );
}
