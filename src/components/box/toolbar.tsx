"use client";

import { useState } from "react";
import { PRESET_BLURB, PRESET_LABEL } from "@/lib/box/presets";
import { PRESET_IDS, type Preset } from "@/lib/box/world-types";

export type Mode = "watch" | "defend" | "agent";

export const MODE_LABEL: Record<Mode, string> = { watch: "Watch", defend: "Defend", agent: "Play as the agent" };

export const button =
  "inline-flex min-h-11 items-center justify-center rounded-[10px] border border-[rgba(150,172,214,0.22)] bg-transparent px-3.5 text-sm text-body hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-pressed:border-ink aria-pressed:bg-control aria-pressed:text-ink-strong";

/** On a phone a strip is one row that scrolls sideways, so the scene stays within the first screen. */
const strip = "flex flex-wrap items-center gap-2 max-[640px]:w-full max-[640px]:flex-nowrap max-[640px]:overflow-x-auto max-[640px]:pb-1 max-[640px]:[scrollbar-width:thin]";

/** One click per preset; the current one is marked in words as well as colour. */
export function PresetStrip({ current, onPick }: { current: Preset | null; onPick(p: Preset): void }) {
  return (
    <div role="group" aria-label="Presets" className={strip} data-preset-strip>
      <span className="font-mono text-[10px] tracking-[0.14em] text-label">PRESET</span>
      {PRESET_IDS.map((id) => (
        <button key={id} type="button" aria-pressed={current === id} title={PRESET_BLURB[id]} data-preset={id} onClick={() => onPick(id)} className={`${button} max-[640px]:shrink-0`}>
          {PRESET_LABEL[id]}
          {current === id ? <span className="sr-only"> (current)</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Watch, defend, or play the agent; and the world editor. */
export function ModeBar({ mode, editing, onMode, onEdit }: { mode: Mode; editing: boolean; onMode(m: Mode): void; onEdit(on: boolean): void }) {
  return (
    <div className={strip}>
      <div role="group" aria-label="Mode" className="flex flex-wrap items-center gap-2 max-[640px]:shrink-0 max-[640px]:flex-nowrap">
        <span className="font-mono text-[10px] tracking-[0.14em] text-label">MODE</span>
        {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
          <button key={m} type="button" aria-pressed={mode === m} data-mode={m} onClick={() => onMode(m)} className={`${button} max-[640px]:shrink-0`}>
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>
      <button type="button" aria-pressed={editing} data-edit-world onClick={() => onEdit(!editing)} className={`${button} max-[640px]:shrink-0`}>
        Edit world
      </button>
    </div>
  );
}

/** Puts the current scenario in the address bar and on the clipboard. */
export function ShareButton({ link }: { link(): string }) {
  const [said, setSaid] = useState("");
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
    <div className="flex items-center gap-2">
      <button type="button" data-copy-link onClick={copy} className={button}>
        Copy link
      </button>
      <span role="status" className="text-xs text-label" data-share-status>
        {said}
      </span>
    </div>
  );
}
