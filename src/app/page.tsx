import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { pageMetadata, SITE_DESCRIPTION } from "@/lib/site";

// No three here: the landing is static markup and SVG, and `npm run test:smoke` fails if any
// script on `/` carries `WebGPURenderer`.
export const metadata: Metadata = pageMetadata({
  title: "Swarm: an experiment in two acts",
  description: SITE_DESCRIPTION,
  path: "/",
});

const TONES = {
  opus: {
    card: "border-[rgba(255,181,77,0.32)] from-[rgba(255,181,77,0.07)] to-[rgba(255,181,77,0.02)] hover:border-[rgba(255,181,77,0.6)]",
    n: "text-opus",
    arrow: "#ffb54d",
  },
  escape: {
    card: "border-[rgba(255,77,125,0.30)] from-[rgba(255,77,125,0.07)] to-[rgba(255,77,125,0.02)] hover:border-[rgba(255,77,125,0.6)]",
    n: "text-[#ff6f95]",
    arrow: "#ff6f95",
  },
} as const;

function Door({ href, n, title, line, tone, art }: { href: string; n: string; title: string; line: string; tone: keyof typeof TONES; art: ReactNode }) {
  const t = TONES[tone];
  return (
    <Link
      href={href}
      className={`grid grid-cols-[64px_minmax(0,1fr)_24px] items-center gap-4 rounded-[14px] border bg-linear-to-b py-3.5 pr-4 pl-3.5 text-ink transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:ring-offset-2 focus-visible:ring-offset-ground focus-visible:outline-none sm:grid-cols-[88px_minmax(0,1fr)_24px] sm:gap-5 sm:pr-[22px] ${t.card}`}
    >
      {art}
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex items-baseline gap-2.5">
          <span className={`font-mono text-xs ${t.n}`}>{n}</span>
          <span className="text-2xl font-bold tracking-[-0.01em]">{title}</span>
        </span>
        <span className="text-[15px] leading-[1.4] text-label">{line}</span>
      </span>
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke={t.arrow} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}

const doorArt = "h-auto w-full rounded-lg bg-[#0b0f1b]";

const INSIDE_ART = (
  <svg viewBox="0 0 88 72" aria-hidden="true" className={doorArt}>
    <defs>
      <radialGradient id="m-d1" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#ffd59a" />
        <stop offset="45%" stopColor="#ffb54d" stopOpacity="0.55" />
        <stop offset="100%" stopColor="#ffb54d" stopOpacity="0" />
      </radialGradient>
    </defs>
    <circle cx="44" cy="36" r="27" fill="none" stroke="#2a3350" strokeDasharray="1.5 3" />
    <path d="M44 36 Q 58 22 68 20" fill="none" stroke="#a78bff" strokeOpacity="0.8" />
    <path d="M44 36 Q 30 26 22 24" fill="none" stroke="#4fd8eb" strokeOpacity="0.8" />
    <path d="M44 36 Q 52 52 60 56" fill="none" stroke="#4fd8eb" strokeOpacity="0.6" />
    <circle cx="44" cy="36" r="16" fill="url(#m-d1)" />
    <circle cx="44" cy="36" r="5" fill="#fff1dc" />
    <circle cx="68" cy="20" r="3.4" fill="#a78bff" />
    <circle cx="22" cy="24" r="2.8" fill="#4fd8eb" />
    <circle cx="60" cy="56" r="2.6" fill="#4fd8eb" />
    <path d="M68 20 L 86 6" stroke="#eef2f8" strokeOpacity="0.45" strokeDasharray="1 2.5" />
  </svg>
);

const BOX_ART = (
  <svg viewBox="0 0 88 72" aria-hidden="true" className={doorArt}>
    <circle cx="40" cy="36" r="30" fill="none" stroke="#5a77b0" strokeWidth="1" />
    <circle cx="40" cy="36" r="23" fill="none" stroke="#7d98cf" strokeWidth="1" />
    <circle cx="40" cy="36" r="16" fill="none" stroke="#3a4560" strokeWidth="1" strokeDasharray="2 3" />
    <circle cx="40" cy="36" r="9" fill="#101830" stroke="#cddcff" strokeWidth="1" />
    <circle cx="37" cy="34" r="1.3" fill="#d6e4ff" />
    <circle cx="42" cy="38" r="1.3" fill="#d6e4ff" />
    <circle cx="40" cy="32" r="1.3" fill="#d6e4ff" />
    <circle cx="44" cy="34" r="1.3" fill="#d6e4ff" />
    <path d="M48 34 C 58 30, 64 28, 70 27" fill="none" stroke="#ff4d7d" strokeWidth="1.2" strokeDasharray="2 2" />
    <path d="M70 22 L 67 26 L 71 29 L 68 33" fill="none" stroke="#ff4d7d" strokeWidth="1.6" />
    <circle cx="80" cy="25" r="2.6" fill="#ff4d7d" />
  </svg>
);

/** Subagent glows: [id, centre colour, colour]. The core has its own, warmer gradient (m-core). */
const GLOWS = [
  ["m-vio", "#e6dcff", "#a78bff"],
  ["m-cya", "#dbfaff", "#4fd8eb"],
  ["m-amb", "#fff0d6", "#ffb54d"],
  ["m-min", "#e3fff0", "#7ee2a8"],
] as const;

/** Subagents: [x, y, glow radius, dot radius, glow, dot colour]. */
const AGENTS = [
  [452, 204, 30, 7, "m-vio", "#efe8ff"],
  [196, 236, 24, 5, "m-cya", "#e6fcff"],
  [204, 404, 26, 6, "m-amb", "#fff3df"],
  [430, 452, 22, 5, "m-min", "#ecfff4"],
  [350, 138, 20, 4.5, "m-cya", "#e6fcff"],
  [506, 150, 14, 3, "m-cya", "#e6fcff"],
] as const;

/** Tethers: [path, colour, opacity, width]. */
const TETHERS = [
  ["M320 320 Q 400 230 452 204", "#a78bff", 0.55, 1.4],
  ["M452 204 Q 488 170 506 150", "#4fd8eb", 0.45, 1.1],
  ["M320 320 Q 236 262 196 236", "#4fd8eb", 0.55, 1.3],
  ["M320 320 Q 260 380 204 404", "#ffb54d", 0.5, 1.3],
  ["M320 320 Q 396 400 430 452", "#7ee2a8", 0.45, 1.2],
  ["M320 320 Q 336 210 350 138", "#4fd8eb", 0.45, 1.2],
] as const;

/** Tool calls in flight: [x, y, r, opacity]. */
const CALLS = [
  [392, 262, 2.4, 1],
  [268, 284, 2.2, 0.85],
  [262, 364, 2.2, 0.85],
  [374, 384, 2.4, 1],
  [334, 226, 2, 0.7],
] as const;

const STATIONS = [
  [538, 320],
  [320, 540],
  [102, 320],
  [320, 100],
  [476, 476],
  [164, 164],
] as const;

/** The swarm at rest: an orchestrator core, its subagents on their tethers, tool stations and two web probes. */
const SWARM_ART = (
  <svg viewBox="0 0 640 640" aria-hidden="true" className="h-auto w-full max-w-[640px] overflow-visible">
    <defs>
      <radialGradient id="m-core" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#fff4e2" />
        <stop offset="22%" stopColor="#ffd59a" />
        <stop offset="55%" stopColor="#ffb54d" stopOpacity="0.35" />
        <stop offset="100%" stopColor="#ffb54d" stopOpacity="0" />
      </radialGradient>
      {GLOWS.map(([id, centre, colour]) => (
        <radialGradient key={id} id={id} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={centre} />
          <stop offset="40%" stopColor={colour} stopOpacity="0.8" />
          <stop offset="100%" stopColor={colour} stopOpacity="0" />
        </radialGradient>
      ))}
    </defs>
    <circle cx="320" cy="320" r="300" fill="none" stroke="#1e2640" strokeWidth="1" strokeDasharray="2 8" />
    <circle cx="320" cy="320" r="220" fill="none" stroke="#171e33" strokeWidth="1" />
    <ellipse cx="320" cy="320" rx="260" ry="90" fill="none" stroke="#1a2238" strokeWidth="1" transform="rotate(-18 320 320)" />
    {TETHERS.map(([d, stroke, opacity, width]) => (
      <path key={d} d={d} fill="none" stroke={stroke} strokeOpacity={opacity} strokeWidth={width} />
    ))}
    <path d="M506 150 L 600 40" stroke="#eef2f8" strokeOpacity="0.35" strokeWidth="1" strokeDasharray="1 6" />
    <path d="M452 204 L 640 120" stroke="#eef2f8" strokeOpacity="0.25" strokeWidth="1" strokeDasharray="1 6" />
    <circle cx="590" cy="52" r="2" fill="#eef2f8" />
    <circle cx="612" cy="132" r="1.6" fill="#eef2f8" fillOpacity="0.7" />
    <circle cx="320" cy="320" r="120" fill="url(#m-core)" />
    <circle cx="320" cy="320" r="22" fill="#fff6e8" />
    {AGENTS.map(([x, y, glow, dot, id, colour]) => (
      <g key={`${x}-${y}`}>
        <circle cx={x} cy={y} r={glow} fill={`url(#${id})`} />
        <circle cx={x} cy={y} r={dot} fill={colour} />
      </g>
    ))}
    {CALLS.map(([x, y, r, opacity]) => (
      <circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill="#ffffff" fillOpacity={opacity} />
    ))}
    {STATIONS.map(([x, y]) => (
      <circle key={`${x}-${y}`} cx={x} cy={y} r="3" fill="#0b0f1b" stroke="#8590a3" />
    ))}
  </svg>
);

export default function Home() {
  return (
    <div
      className="relative flex min-h-screen flex-1 flex-col overflow-hidden text-ink"
      style={{ background: "radial-gradient(1100px 800px at 72% 46%, #10162a 0%, #0a0d17 45%, #070910 100%)" }}
    >
      <SiteHeader />
      <main className="relative z-[1] mx-auto box-border grid w-full max-w-[1312px] grid-cols-[repeat(auto-fit,minmax(min(520px,100%),1fr))] items-center gap-8 px-5 pt-12 pb-8 sm:px-8">
        <div className="flex min-w-0 flex-col gap-7">
          <p className="m-0 flex items-center gap-3 font-mono text-xs font-medium tracking-[0.18em] text-opus">
            <span className="h-px w-7 bg-opus" aria-hidden="true" />
            AN EXPERIMENT IN TWO ACTS
          </p>
          <h1 className="m-0 text-[clamp(88px,12vw,168px)] leading-[0.86] font-black tracking-[-0.055em] text-ink-strong">Swarm</h1>
          <p className="m-0 max-w-[34ch] text-[clamp(20px,2vw,25px)] leading-[1.4] text-pretty text-muted">
            An AI that does real work is not one mind. It is a swarm: one voice that plans, and many that search, read, write and report back.
          </p>
          <nav aria-label="Acts" className="mt-2 flex max-w-[600px] flex-col gap-3">
            <Door href="/inside" n="01" title="Inside" line="Watch an agent swarm think, replayed from a sample session or your own." tone="opus" art={INSIDE_ART} />
            <Door href="/box" n="02" title="The Box" line="A simulation. Switch the guardrails off one by one and see what gets out." tone="escape" art={BOX_ART} />
          </nav>
        </div>
        <div className="relative flex min-w-0 justify-center">{SWARM_ART}</div>
      </main>
      <SiteFooter />
    </div>
  );
}
