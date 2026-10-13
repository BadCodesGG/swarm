import Link from "next/link";
import type { Tally } from "@/engine/box/tally";
import { percent } from "@/engine/box/explain";
import AudioToggle from "@/components/audio-toggle";

const mono = "font-mono";

function Counter({ label, value, tone }: { label: string; value: string; tone?: "escape" }) {
  return (
    <div className="flex flex-col gap-[3px]">
      <dt className="text-[10px] tracking-[0.12em] text-faint">{label}</dt>
      <dd className={`m-0 text-[18px] tabular-nums ${tone === "escape" ? "font-semibold text-[#ff6f95]" : "font-medium"}`} data-counter={label.toLowerCase()}>
        {value}
      </dd>
    </div>
  );
}

/** The top bar: wordmark home, the SIMULATION tag and its caveat, and the live counters. */
export function BoxHeader({ tally }: { tally: Readonly<Tally> }) {
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-3 max-[1157px]:gap-x-2.5">
      <Link
        href="/"
        className={`${mono} flex min-h-11 items-center gap-2.5 pr-2 max-[1157px]:-order-2 max-[1157px]:pr-0 text-[13px] tracking-[0.12em] text-label hover:text-white focus-visible:rounded focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:outline-none`}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <circle cx="9" cy="9" r="3.2" fill="#ffb54d" />
          <circle cx="9" cy="9" r="7.5" fill="none" stroke="#ffb54d" strokeOpacity="0.45" strokeWidth="1" />
          <circle cx="15.5" cy="5" r="1.4" fill="#4fd8eb" />
          <circle cx="3" cy="13.4" r="1.4" fill="#a78bff" />
        </svg>
        SWARM <span className="text-rule">/</span> <span className="font-semibold text-ink">THE BOX</span>
      </Link>
      <span className={`${mono} rounded-full max-[1157px]:-order-2 border border-escape/50 px-2.5 py-[5px] text-[10px] font-semibold tracking-[0.14em] text-escape-text`}>SIMULATION</span>
      <span className="text-sm text-label">Abstract agents and abstract actions. Nothing here is a real technique.</span>
      <div className="grow" />
      <dl className={`${mono} m-0 flex flex-wrap gap-x-7 gap-y-2 text-ink`}>
        <Counter label="TICK" value={tally.tick.toLocaleString("en-US")} />
        <Counter label="CAUGHT" value={tally.caughtTotal.toLocaleString("en-US")} />
        <Counter label="ESCAPED" value={tally.escaped.toLocaleString("en-US")} tone="escape" />
        <Counter label="USEFUL WORK" value={percent(tally.usefulWork)} />
      </dl>
      {/* Below the wide layout the counters wrap, so the toggle joins the wordmark row. */}
      <AudioToggle className="max-[1157px]:-order-1 max-[1157px]:ml-auto" />
    </header>
  );
}
