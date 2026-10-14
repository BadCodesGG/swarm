"use client";

import { useId, useRef, useState, type KeyboardEvent, type ToggleEvent } from "react";
import { PRESET_BLURB, PRESET_LABEL } from "@/lib/box/presets";
import { PRESET_IDS, type Preset } from "@/lib/box/world-types";
import { button } from "./toolbar";

const item =
  "flex min-h-11 w-full flex-col items-start justify-center gap-0.5 rounded-lg border-0 bg-transparent px-3 py-1.5 text-left text-sm text-body hover:bg-white/5 focus-visible:bg-white/5 focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:outline-none aria-checked:bg-control";

/**
 * The Scenario button and its menu: one radio item per preset (the current one checked, and said
 * in words), then Edit world, which shows the world editor in the Defences rail. The menu is a native
 * popover, so a click outside or Escape closes it and focus goes back to the button.
 */
export function ScenarioMenu({ current, editing, onPick, onEdit }: { current: Preset | null; editing: boolean; onPick(p: Preset): void; onEdit(on: boolean): void }) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const items = () => [...(menu.current?.querySelectorAll<HTMLElement>("[role^='menuitem']") ?? [])];

  const onToggle = (e: ToggleEvent<HTMLDivElement>) => {
    const isOpen = e.newState === "open";
    setOpen(isOpen);
    const el = menu.current;
    const r = opener.current?.getBoundingClientRect();
    if (!isOpen || !el || !r) return;
    // Under the button, kept inside the window.
    el.style.top = `${Math.round(r.bottom + 6)}px`;
    el.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 8)))}px`;
    (items().find((i) => i.getAttribute("aria-checked") === "true") ?? items()[0])?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      e.preventDefault();
      all[(i + all.length) % all.length]?.focus();
    };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(all.length - 1);
    else if (e.key === "Tab") menu.current?.hidePopover();
  };

  const close = () => menu.current?.hidePopover();

  return (
    <>
      <button
        ref={opener}
        type="button"
        popoverTarget={id}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        data-scenario-menu
        className={`${button} gap-2.5`}
      >
        <span className="font-mono text-[10px] tracking-[0.14em] text-faint uppercase">Scenario</span>
        <span className="font-semibold text-ink-strong">{current ? PRESET_LABEL[current] : "Your own"}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className={`transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      <div
        ref={menu}
        id={id}
        popover="auto"
        role="menu"
        aria-label="Scenario"
        onToggle={onToggle}
        onKeyDown={onKey}
        className="fixed inset-auto m-0 w-[320px] max-w-[calc(100vw-16px)] flex-col gap-0.5 rounded-xl border border-panel-border bg-panel p-1.5 text-body shadow-[0_12px_40px_rgba(0,0,0,0.55)] open:flex"
        data-scenario-items
      >
        <span className="px-3 pt-1.5 pb-1 font-mono text-[10px] tracking-[0.14em] text-label uppercase" aria-hidden="true">
          Presets
        </span>
        {PRESET_IDS.map((p) => (
          <button
            key={p}
            type="button"
            role="menuitemradio"
            aria-checked={current === p}
            data-preset={p}
            onClick={() => {
              onPick(p);
              close();
            }}
            className={item}
          >
            <span className="flex w-full items-baseline justify-between gap-2">
              <span className={current === p ? "font-semibold text-ink-strong" : ""}>{PRESET_LABEL[p]}</span>
              {current === p ? <span className="font-mono text-[10px] tracking-[0.12em] text-label">CURRENT</span> : null}
            </span>
            <span className="text-xs leading-snug text-faint">{PRESET_BLURB[p]}</span>
          </button>
        ))}
        <span role="separator" className="mx-2 my-1 h-px bg-panel-border" />
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={editing}
          data-edit-world
          onClick={() => {
            onEdit(!editing);
            close();
          }}
          className={`${item} flex-row! items-center! justify-between!`}
        >
          <span>Edit world</span>
          <span className="font-mono text-[10px] tracking-[0.14em] text-label">{editing ? "ON" : "OFF"}</span>
        </button>
      </div>
    </>
  );
}
