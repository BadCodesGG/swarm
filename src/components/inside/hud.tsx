"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { InsideApp } from "@/engine/inside/app";
import { cycleAgent } from "@/engine/inside/layout";
import AudioToggle from "@/components/audio-toggle";
import { Counters } from "./counters";
import { AgentBar, DetailCard } from "./detail-card";
import { KeyPanel } from "./key-panel";
import { NowPanel } from "./now-panel";
import { RATES } from "./rates";
import { Timeline } from "./scrubber";
import { SourceSwitcher } from "./source-switcher";
import { useNarrow, useSelection } from "./use-engine";

/** Fraction of the playback axis one Left / Right press moves. */
const STEP = 0.02;

/** The card's width (`w-80`): the desktop scene keeps clear of this column whether or not a card is open. */
const CARD_COLUMN = 320;
/** CSS px the station labels keep from the panels around the scene. */
const SCENE_GAP = 8;

const LOGO = (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <circle cx="9" cy="9" r="3.2" fill="#ffb54d" />
    <circle cx="9" cy="9" r="7.5" fill="none" stroke="#ffb54d" strokeOpacity="0.45" strokeWidth="1" />
    <circle cx="15.5" cy="5" r="1.4" fill="#4fd8eb" />
    <circle cx="3" cy="13.4" r="1.4" fill="#a78bff" />
  </svg>
);

const UPLOAD = (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 11V2M4.5 5.5 8 2l3.5 3.5M2.5 10.5v3h11v-3" fill="none" stroke="#ffc77a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const linkRing = "outline-none focus-visible:ring-2 focus-visible:ring-layer-1";

/**
 * Space, Left / Right, 1 / 2 / 3, A / Shift+A (next and previous agent) and Escape (close the card),
 * unless the key belongs to the control that has focus. While a modal sheet is open only Escape
 * works: the rest belong to the controls under it.
 */
function useShortcuts(app: InsideApp, onCycle: (dir: 1 | -1) => void, onEscape: () => boolean, modal: boolean) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (modal && e.key !== "Escape") return;
      const el = e.target instanceof HTMLElement ? e.target : null;
      const typing = !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
      if (typing) return;
      // A focused button, link or summary already answers Space and Enter itself.
      const activates = !!el && /^(BUTTON|A|SUMMARY)$/.test(el.tagName);
      const tl = app.timeline();
      if (e.key === "Escape") {
        if (!onEscape()) return;
      } else if (e.key === " " || e.code === "Space") {
        if (activates) return;
        if (app.playing()) app.pause();
        else app.play();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const dir = e.key === "ArrowLeft" ? -1 : 1;
        const pb = tl.toPlayback(app.time()) + dir * STEP * tl.playbackDuration;
        app.seek(tl.toTrace(Math.min(Math.max(pb, 0), tl.playbackDuration)));
      } else if (e.key === "a" || e.key === "A") {
        onCycle(e.shiftKey ? -1 : 1);
      } else if (e.key === "d" || e.key === "D") {
        app.resumeDirector();
      } else if (e.key >= "1" && e.key <= String(RATES.length)) {
        app.setRate(RATES[Number(e.key) - 1]);
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [app, onCycle, onEscape, modal]);
}

/** The Act 1 HUD over the canvas; a stacked layout on a phone. */
export function Hud({ app }: { app: InsideApp }) {
  const narrow = useNarrow();
  const selected = useSelection(app);
  const [sheetOpen, setSheetOpen] = useState(false);
  // A cleared selection (a source switch, say) closes the sheet, so it does not pop back with the next pick.
  const [sheetSelection, setSheetSelection] = useState(selected);
  if (sheetSelection !== selected) {
    setSheetSelection(selected);
    if (selected < 0) setSheetOpen(false);
  }
  const sheet = useRef<HTMLDivElement>(null);
  const sheetShown = narrow && selected >= 0 && sheetOpen;
  const [announced, setAnnounced] = useState("");
  const slot = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLElement>(null);
  const side = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const timeline = useRef<HTMLDivElement>(null);
  const nextAgent = useRef<HTMLButtonElement>(null);
  const agentBar = useRef<HTMLButtonElement>(null);
  /** Where focus goes when the card closes: the control that had it when the keyboard picked an agent. */
  const returnTo = useRef<HTMLElement | null>(null);

  const cycle = useCallback(
    (dir: 1 | -1) => {
      const active = document.activeElement;
      returnTo.current = active instanceof HTMLElement && active !== document.body ? active : null;
      const id = cycleAgent(app.timeline().trace, app.time(), app.selected(), dir);
      app.select(id);
      setAnnounced(id === 0 ? "Selected the orchestrator" : `Selected ${app.timeline().trace.agents[id]?.label ?? "an agent"}`);
    },
    [app],
  );

  // The card unmounts with focus inside it, which would drop focus to the page; send it back.
  const refocus = useCallback(() => {
    const back = returnTo.current;
    returnTo.current = null;
    requestAnimationFrame(() => (back?.isConnected ? back : nextAgent.current)?.focus());
  }, []);

  /** Escape closes the phone's sheet, else the card. False when there was nothing to close. */
  const escape = useCallback(() => {
    if (sheetShown) {
      setSheetOpen(false);
      requestAnimationFrame(() => agentBar.current?.focus());
      return true;
    }
    if (app.selected() < 0) return false;
    app.select(-1);
    refocus();
    return true;
  }, [app, refocus, sheetShown]);

  useShortcuts(app, cycle, escape, sheetShown);

  // The sheet is modal: focus moves into it as it opens (and back to the agent bar as it closes).
  useEffect(() => {
    if (sheetShown) sheet.current?.focus();
  }, [sheetShown]);

  // The phone frames the scene in the band between the counters and the cards; the desktop frames it
  // between the header, the side panels, the card's column and the timeline, so the station ring and
  // its labels clear all of them.
  useEffect(() => {
    const fit = () => {
      if (narrow) {
        const el = slot.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        app.setFrame({ top: r.top, height: r.height });
        return;
      }
      const h = header.current?.getBoundingClientRect();
      const s = side.current?.getBoundingClientRect();
      const w = row.current?.getBoundingClientRect();
      const tl = timeline.current?.getBoundingClientRect();
      if (!h || !s || !w || !tl) return;
      const top = h.bottom + SCENE_GAP;
      const left = s.right + SCENE_GAP;
      const right = Math.max(left + 1, w.right - CARD_COLUMN - SCENE_GAP);
      app.setFrame({ top, height: Math.max(1, tl.top - SCENE_GAP - top), left, width: right - left, fit: "stations" });
    };
    fit();
    const ro = new ResizeObserver(fit);
    for (const el of [slot.current, header.current, side.current, row.current, timeline.current]) if (el) ro.observe(el);
    return () => {
      ro.disconnect();
      app.setFrame(null);
    };
  }, [app, narrow]);

  const close = () => {
    app.select(-1);
    refocus();
  };

  const status = (
    <p role="status" className="sr-only">
      {announced}
    </p>
  );

  if (narrow) {
    return (
      <div className="pointer-events-none absolute inset-0 flex flex-col gap-2.5 px-4 pt-3 pb-4 font-sans text-ink">
        {/* Inert under the open sheet, so Tab cannot reach the controls it covers; `contents` keeps the column's layout. */}
        <div className="contents" inert={sheetShown} data-under-sheet>
        <header className="flex items-center justify-between gap-2">
          <Link href="/" className={`pointer-events-auto flex min-h-11 items-center gap-2 font-mono text-xs tracking-[0.12em] text-label ${linkRing}`}>
            {LOGO}
            <span className="font-semibold text-ink">INSIDE</span>
          </Link>
          <AudioToggle className="ml-auto" />
          <Link
            href="/inside/load"
            className={`pointer-events-auto flex min-h-11 items-center gap-1.5 rounded-xl border border-opus/45 bg-opus/8 px-3.5 text-sm font-semibold text-warn ${linkRing}`}
          >
            {UPLOAD}
            Your session
          </Link>
        </header>
        <SourceSwitcher app={app} narrow />
        <Counters app={app} compact />
        {/* The design's 300 px scene band. It takes spare height up to 340 px, so the cards sit under the
            ring and the scrubber stays at the bottom as on the board; it gives way first on a short screen. */}
        <div ref={slot} className="max-h-[340px] min-h-[200px] flex-[1_1_300px]" aria-hidden="true" />
        <NowPanel app={app} narrow />
        {/* Shown only while focused, so the keyboard has a way to the agents without changing the board's look. */}
        <button
          ref={nextAgent}
          type="button"
          aria-keyshortcuts="A"
          onClick={() => cycle(1)}
          className="pointer-events-auto sr-only min-h-11 rounded-xl border border-panel-border bg-[rgba(12,16,28,0.86)] px-3.5 text-left font-mono text-xs text-label outline-none focus-visible:not-sr-only focus-visible:ring-2 focus-visible:ring-layer-1"
        >
          Select the next agent (A)
        </button>
        {selected >= 0 ? <AgentBar ref={agentBar} app={app} id={selected} expanded={sheetOpen} onToggle={() => setSheetOpen((o) => !o)} /> : null}
        <div className="grow" aria-hidden="true" />
        <Timeline app={app} narrow />
        </div>
        {sheetShown ? (
          <div
            ref={sheet}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            aria-label="Selected agent details"
            className="pointer-events-auto absolute inset-x-0 bottom-0 z-10 max-h-[78%] overflow-y-auto rounded-t-[18px] outline-none border border-b-0 border-panel-border bg-[rgba(12,16,28,0.96)] px-4 pt-4 pb-6 shadow-[0_-18px_48px_rgba(0,0,0,0.5)]"
          >
            <DetailCard
              key={selected}
              app={app}
              id={selected}
              sheet
              onClose={() => {
                setSheetOpen(false);
                requestAnimationFrame(() => agentBar.current?.focus());
              }}
            />
          </div>
        ) : null}
        {status}
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-0 grid min-h-[640px] grid-rows-[auto_minmax(0,1fr)_auto] gap-4 px-6 py-5 font-sans text-ink">
      <header ref={header} className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Link href="/" className={`pointer-events-auto flex min-h-11 items-center gap-2.5 pr-2 font-mono text-[13px] tracking-[0.12em] text-label hover:text-white ${linkRing}`}>
          {LOGO}
          <span>
            SWARM <span className="text-faint">/</span> <span className="font-semibold text-ink">INSIDE</span>
          </span>
        </Link>
        <SourceSwitcher app={app} narrow={false} />
        <Link
          href="/inside/load"
          className={`pointer-events-auto flex min-h-11 items-center gap-2 rounded-xl border border-opus/45 bg-opus/8 px-4 text-sm font-semibold text-warn ${linkRing}`}
        >
          {UPLOAD}
          Load your session
        </Link>
        <div className="grow" />
        <Counters app={app} />
        <AudioToggle />
      </header>

      <div ref={row} className="flex min-h-0 flex-wrap items-stretch justify-between gap-4">
        <div ref={side} className="flex max-h-full min-h-0 w-[300px] max-w-full flex-col gap-3">
          <NowPanel app={app} narrow={false} />
          <KeyPanel open={typeof window === "undefined" || window.innerHeight >= 820} />
        </div>
        {selected >= 0 ? <DetailCard key={selected} app={app} id={selected} onClose={close} /> : null}
      </div>

      <div ref={timeline}>
        <Timeline app={app} narrow={false} nextAgentRef={nextAgent} onNextAgent={() => cycle(1)} />
      </div>
      {status}
    </div>
  );
}
