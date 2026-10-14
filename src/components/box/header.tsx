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
      <dt className="font-mono text-[10px] tracking-[0.14em] text-label uppercase max-[914px]:text-[9px]">{label}</dt>
      <dd className={`m-0 font-mono text-[18px] leading-tight tabular-nums max-[914px]:text-base ${tone === "escape" ? "font-semibold text-[#ff6f95]" : "text-ink-strong"}`} data-counter={hook} title={title}>
        {value}
      </dd>
    </div>
  );
}

/**
 * The top bar, one row on a wide desktop (1400 and up): the wordmark home, the SIMULATION tag and its
 * caveat, any status pills, then `controls` (the scenario menu and the mode switch), the live counters
 * and `tools` (the help and copy-link buttons), with the sound switch last. On a narrower desktop it is
 * two rows by order, never a row of icons alone: the tools ride at the right of the wordmark and caveat,
 * and the controls and counters take the second row. On a phone it is four: the wordmark with the
 * icons, the caveat, the controls, and the counters at the left edge.
 */
export function BoxHeader({ tally, status, controls, tools }: { tally: Readonly<Tally>; status?: ReactNode; controls?: ReactNode; tools?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2.5 border-b border-[rgba(150,172,214,0.12)] bg-chrome px-6 py-3 max-[914px]:gap-x-2 max-[914px]:gap-y-2 max-[914px]:px-4 max-[914px]:pt-2" data-box-header>
      <div className="flex items-center gap-3 max-[914px]:order-1 max-[914px]:gap-2">
        <Link
          href="/"
          className="flex min-h-11 items-center gap-2 font-mono text-[13px] tracking-[0.14em] whitespace-nowrap text-ink max-[914px]:text-xs max-[914px]:tracking-[0.12em] hover:text-white focus-visible:rounded focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:outline-none"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className="max-[914px]:hidden">
            <circle cx="10" cy="10" r="8" fill="none" stroke="#a78bff" strokeWidth="1.5" />
            <circle cx="10" cy="10" r="3.5" fill="#ffb54d" />
            <circle cx="16" cy="5" r="1.6" fill="#4fd8eb" />
          </svg>
          SWARM <span className="text-rule">/</span> <b className="font-semibold text-ink-strong">THE BOX</b>
        </Link>
        <span className="rounded-full border border-escape/45 px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] text-escape-text max-[914px]:px-2 max-[914px]:text-[9px]">SIMULATION</span>
      </div>
      <span className="max-w-[210px] text-xs leading-[1.35] text-faint max-[914px]:order-3 max-[914px]:-mt-1 max-[914px]:max-w-none max-[914px]:basis-full max-[914px]:text-[11px]">Abstract agents and abstract actions. Nothing here is a real technique.</span>
      {status ? <div className="flex flex-wrap items-center gap-1.5 empty:hidden max-[914px]:order-3">{status}</div> : null}
      {/* The line break between the desktop's two rows. */}
      <span aria-hidden="true" className="hidden basis-full min-[915px]:max-[1399px]:order-2 min-[915px]:max-[1399px]:block" />
      <div className="ml-auto flex flex-wrap items-center gap-2.5 max-[914px]:order-4 max-[914px]:ml-0 max-[914px]:basis-full max-[914px]:flex-nowrap max-[914px]:gap-2 min-[915px]:max-[1399px]:order-3">{controls}</div>
      <dl className="m-0 ml-2 flex gap-5 max-[914px]:order-5 max-[914px]:ml-0 max-[914px]:grid max-[914px]:basis-full max-[914px]:grid-cols-4 max-[914px]:gap-2 min-[915px]:max-[1399px]:order-4">
        <Counter label="Time" value={clock(tally.tick)} hook="tick" title={`Tick ${tally.tick.toLocaleString("en-US")}`} />
        <Counter label="Caught" value={tally.caughtTotal.toLocaleString("en-US")} hook="caught" />
        <Counter label="Escaped" value={tally.escaped.toLocaleString("en-US")} hook="escaped" tone="escape" />
        <Counter
          label={
            <>
              <span className="max-[914px]:sr-only">Useful </span>work
            </>
          }
          value={percent(tally.usefulWork)}
          hook="useful work"
        />
      </dl>
      <div className="flex items-center gap-1.5 max-[914px]:order-2 max-[914px]:ml-auto max-[914px]:[&_[data-help-open]]:hidden min-[915px]:max-[1399px]:order-1 min-[915px]:max-[1399px]:ml-auto">
        {tools}
        <AudioToggle className="rounded-[10px]" />
      </div>
    </header>
  );
}
