"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { InsideApp } from "@/engine/inside/app";
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

/** Space, Left / Right and 1 / 2 / 3, unless the key belongs to the control that has focus. */
function useShortcuts(app: InsideApp) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target instanceof HTMLElement ? e.target : null;
      const typing = !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
      if (typing) return;
      // A focused button, link or summary already answers Space and Enter itself.
      const activates = !!el && /^(BUTTON|A|SUMMARY)$/.test(el.tagName);
      const tl = app.timeline();
      if (e.key === " " || e.code === "Space") {
        if (activates) return;
        if (app.playing()) app.pause();
        else app.play();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const dir = e.key === "ArrowLeft" ? -1 : 1;
        const pb = tl.toPlayback(app.time()) + dir * STEP * tl.playbackDuration;
        app.seek(tl.toTrace(Math.min(Math.max(pb, 0), tl.playbackDuration)));
      } else if (e.key >= "1" && e.key <= String(RATES.length)) {
        app.setRate(RATES[Number(e.key) - 1]);
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [app]);
}

/** The Act 1 HUD over the canvas; a stacked layout on a phone. */
export function Hud({ app }: { app: InsideApp }) {
  const narrow = useNarrow();
  const selected = useSelection(app);
  const [sheetOpen, setSheetOpen] = useState(false);
  const slot = useRef<HTMLDivElement>(null);
  useShortcuts(app);

  // The phone frames the scene in the gap between the counters and the cards.
  useEffect(() => {
    const el = slot.current;
    if (!narrow || !el) {
      app.setFrame(null);
      return;
    }
    const fit = () => {
      const r = el.getBoundingClientRect();
      app.setFrame({ top: r.top, height: r.height });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => {
      ro.disconnect();
      app.setFrame(null);
    };
  }, [app, narrow]);

  const close = () => app.select(-1);

  if (narrow) {
    return (
      <div className="pointer-events-none absolute inset-0 flex flex-col gap-2.5 px-4 pt-3 pb-4 font-sans text-ink">
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
        {/* The design's 300 px scene band; it gives way first on a short screen, and spare height goes under the cards. */}
        <div ref={slot} className="min-h-[200px] flex-[0_1_300px]" aria-hidden="true" />
        <NowPanel app={app} narrow />
        {selected > 0 ? <AgentBar app={app} id={selected} expanded={sheetOpen} onToggle={() => setSheetOpen((o) => !o)} /> : null}
        <div className="grow" aria-hidden="true" />
        <Timeline app={app} narrow />
        {selected > 0 && sheetOpen ? (
          <div
            role="dialog"
            aria-label="Selected agent details"
            className="pointer-events-auto absolute inset-x-0 bottom-0 z-10 max-h-[78%] overflow-y-auto rounded-t-[18px] border border-b-0 border-panel-border bg-[rgba(12,16,28,0.96)] px-4 pt-4 pb-6 shadow-[0_-18px_48px_rgba(0,0,0,0.5)]"
          >
            <DetailCard key={selected} app={app} id={selected} sheet onClose={() => setSheetOpen(false)} />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-0 grid min-h-[640px] grid-rows-[auto_minmax(0,1fr)_auto] gap-4 px-6 py-5 font-sans text-ink">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Link href="/" className={`pointer-events-auto flex min-h-11 items-center gap-2.5 pr-2 font-mono text-[13px] tracking-[0.12em] text-label hover:text-white ${linkRing}`}>
          {LOGO}
          <span>
            SWARM <span className="text-rule">/</span> <span className="font-semibold text-ink">INSIDE</span>
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

      <div className="flex min-h-0 flex-wrap items-stretch justify-between gap-4">
        <div className="flex max-h-full min-h-0 w-[300px] max-w-full flex-col gap-3">
          <NowPanel app={app} narrow={false} />
          <KeyPanel open={typeof window === "undefined" || window.innerHeight >= 820} />
        </div>
        {selected > 0 ? <DetailCard key={selected} app={app} id={selected} onClose={close} /> : null}
      </div>

      <Timeline app={app} narrow={false} />
    </div>
  );
}
