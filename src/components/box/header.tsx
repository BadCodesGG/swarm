"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import type { Tally } from "@/engine/box/tally";
import { clock, percent } from "@/engine/box/explain";
import AudioToggle from "@/components/audio-toggle";
import { countsLine, nextAnnouncement, type Said } from "./announce";

/** Ms between two spoken changes of the caught count; an escape or a reset is spoken at once. */
const COUNTS_GAP = 5000;

/** A screen reader hears the caught and escaped counts when they change, at most every few seconds. */
export function CountsStatus({ caught, escaped }: { caught: number; escaped: number }) {
  const said = useRef<Said>({ caught, escaped, at: 0 });
  const [line, setLine] = useState("");
  useEffect(() => {
    const last = said.current;
    if (caught === last.caught && escaped === last.escaped) return;
    const now = performance.now();
    // Said now, or once the gap is up (a held change is said even if nothing else changes by then).
    const wait = nextAnnouncement(last, { caught, escaped }, now, COUNTS_GAP) ? 0 : Math.max(0, last.at + COUNTS_GAP - now);
    const id = window.setTimeout(() => {
      said.current = { caught, escaped, at: performance.now() };
      setLine(countsLine(caught, escaped));
    }, wait);
    return () => window.clearTimeout(id);
  }, [caught, escaped]);
  return (
    <p role="status" className="sr-only" data-status="counts">
      {line}
    </p>
  );
}

function Counter({ label, value, hook, title, tone }: { label: ReactNode; value: string; hook: string; title?: string; tone?: "escape" }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="font-mono text-[10px] tracking-[0.14em] text-label uppercase max-[915px]:text-[9px]">{label}</dt>
      <dd className={`m-0 font-mono text-[18px] leading-tight tabular-nums max-[915px]:text-base ${tone === "escape" ? "font-semibold text-[#ff6f95]" : "text-ink-strong"}`} data-counter={hook} title={title}>
        {value}
      </dd>
    </div>
  );
}

/** The desktop layout's first width (the phone layout runs to 914). */
const DESKTOP = "(min-width: 915px)";
/** Px a one-row top bar keeps spare: measured widths are exact, this covers rounding. */
const SLACK = 2;

/** Whether the bar's items (a row wrapper counts its own items and gaps), the gaps between them and the padding fit the bar's width. */
function fitsOneRow(el: HTMLElement): boolean {
  if (!window.matchMedia(DESKTOP).matches) return false;
  const cs = getComputedStyle(el);
  const room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const gap = parseFloat(cs.columnGap) || 0;
  const items = [...el.children].filter((c) => c.getClientRects().length > 0);
  const widthOf = (c: Element): number => {
    if (!c.hasAttribute("data-row")) return c.getBoundingClientRect().width;
    const inner = [...c.children].filter((i) => i.getClientRects().length > 0);
    return inner.reduce((sum, i) => sum + i.getBoundingClientRect().width, 0) + (parseFloat(getComputedStyle(c).columnGap) || 0) * Math.max(0, inner.length - 1);
  };
  const width = items.reduce((sum, c) => sum + widthOf(c), 0) + gap * Math.max(0, items.length - 1);
  return width + SLACK <= room;
}

/**
 * Whether the top bar's content fits one row, measured (`fitsOneRow`) so the switch follows the content and the
 * window (a scrollbar, a longer scenario name, a status pill) rather than a breakpoint: whenever the bar or one of its
 * items changes size, a frame later, so the bar's own reflow never re-enters the observer. The phone layout is never one row.
 */
function useOneRow(header: HTMLElement | null): boolean {
  const [oneRow, setOneRow] = useState(false);
  useEffect(() => {
    if (!header) return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setOneRow(fitsOneRow(header));
      });
    });
    ro.observe(header);
    for (const c of header.children) ro.observe(c);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [header]);
  return oneRow;
}

/**
 * The top bar. One row where its content fits (a wide desktop, 1432 and up with the Breakout name): the wordmark
 * home, the SIMULATION tag and its caveat, any status pills, then `controls` (the scenario menu and the mode
 * switch) with the live counters, and `tools` (the help and copy-link buttons, the sound switch) last. On a
 * narrower desktop it is two rows, never a row of icons alone: the tools ride at the right of the wordmark and
 * caveat, and the controls and counters take the second row. On a phone it is four: the wordmark with the icons,
 * the caveat, the controls, and the counters at the left edge (under 360 px the scenario and the modes take a row
 * each). In every layout the items come in reading order, so Tab moves as the eye does: `useOneRow` measures the
 * fit, and the tools move after the controls only when they sit there.
 */
export function BoxHeader({ tally, status, controls, tools }: { tally: Readonly<Tally>; status?: ReactNode; controls?: ReactNode; tools?: ReactNode }) {
  // A callback ref: the observer wants the element, and a ref's current is not a dependency.
  const [header, setHeader] = useState<HTMLElement | null>(null);
  const oneRow = useOneRow(header);
  const brand = (
    <div key="brand" className="flex items-center gap-3 max-[915px]:order-1 max-[915px]:gap-2">
      <Link
        href="/"
        className="flex min-h-11 items-center gap-2 font-mono text-[13px] tracking-[0.14em] whitespace-nowrap text-ink max-[915px]:text-xs max-[915px]:tracking-[0.12em] hover:text-white focus-visible:rounded focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:outline-none"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className="max-[915px]:hidden">
          <circle cx="10" cy="10" r="8" fill="none" stroke="#a78bff" strokeWidth="1.5" />
          <circle cx="10" cy="10" r="3.5" fill="#ffb54d" />
          <circle cx="16" cy="5" r="1.6" fill="#4fd8eb" />
        </svg>
        {/* The narrowest phones keep the icons on the wordmark's row by dropping the site's name from view. */}
        <span className="max-[380px]:sr-only">
          SWARM <span className="text-rule">/</span>
        </span>
        <b className="font-semibold text-ink-strong">THE BOX</b>
      </Link>
      <span className="rounded-full border border-escape/45 px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] text-escape-text max-[915px]:px-2 max-[915px]:text-[9px]">SIMULATION</span>
    </div>
  );
  const caveat = (
    <span key="caveat" className="max-w-[210px] text-xs leading-[1.35] text-faint max-[915px]:order-3 max-[915px]:-mt-1 max-[915px]:max-w-none max-[915px]:basis-full max-[915px]:text-[11px]">
      Abstract agents and abstract actions. Nothing here is a real technique.
    </span>
  );
  const pills = status ? (
    <div key="status" className="flex flex-wrap items-center gap-1.5 empty:hidden max-[915px]:order-3">
      {status}
    </div>
  ) : null;
  const toolbar = (
    <div key="tools" className={`flex items-center gap-1.5 max-[915px]:order-2 max-[915px]:ml-auto max-[915px]:[&_[data-help-open]]:hidden ${oneRow ? "" : "min-[915px]:ml-auto"}`}>
      {tools}
      <AudioToggle className="rounded-[10px]" />
    </div>
  );
  // The controls and the counters: the end of the one row, the whole second row, the phone's third and fourth. On a phone both
  // wrappers may shrink under their content, so a long scenario name ("Breakout, edited") truncates rather than widening the bar.
  const row = (
    <div key="row" className={`flex items-center gap-x-5 gap-y-2 max-[915px]:order-4 max-[915px]:ml-0 max-[915px]:min-w-0 max-[915px]:basis-full max-[915px]:flex-wrap ${oneRow ? "ml-auto" : "min-[915px]:basis-full min-[915px]:justify-end"}`} data-row>
      <div className="flex flex-wrap items-center gap-2.5 max-[915px]:min-w-0 max-[915px]:basis-full max-[915px]:flex-nowrap max-[915px]:gap-2 max-[360px]:flex-wrap max-[360px]:[&>[role=group]]:basis-full">{controls}</div>
      <dl className="m-0 flex gap-5 max-[915px]:grid max-[915px]:basis-full max-[915px]:grid-cols-4 max-[915px]:gap-2">
        <Counter label="Time" value={clock(tally.tick)} hook="tick" title={`Tick ${tally.tick.toLocaleString("en-US")}`} />
        <Counter label="Caught" value={tally.caughtTotal.toLocaleString("en-US")} hook="caught" />
        <Counter label="Escaped" value={tally.escaped.toLocaleString("en-US")} hook="escaped" tone="escape" />
        <Counter
          label={
            <>
              <span className="max-[915px]:sr-only">Useful </span>work
            </>
          }
          value={percent(tally.usefulWork)}
          hook="useful work"
        />
      </dl>
    </div>
  );
  return (
    <header
      ref={setHeader}
      className="flex flex-wrap items-center gap-x-3 gap-y-2.5 border-b border-[rgba(150,172,214,0.12)] bg-chrome px-6 py-3 max-[915px]:gap-x-2 max-[915px]:gap-y-2 max-[915px]:px-4 max-[915px]:pt-2"
      data-box-header
      data-rows={oneRow ? 1 : 2}
    >
      {oneRow ? [brand, caveat, pills, row, toolbar] : [brand, caveat, pills, toolbar, row]}
    </header>
  );
}
