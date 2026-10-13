import Link from "next/link";

/** The wordmark's mark: the core, its ring, and two subagents. */
export function SwarmMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r="3.2" fill="#ffb54d" />
      <circle cx="9" cy="9" r="7.5" fill="none" stroke="#ffb54d" strokeOpacity="0.45" strokeWidth="1" />
      <circle cx="15.5" cy="5" r="1.4" fill="#4fd8eb" />
      <circle cx="3" cy="13.4" r="1.4" fill="#a78bff" />
    </svg>
  );
}

const ring = "focus-visible:rounded focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:outline-none";

const NAV = [
  { href: "/inside", label: "INSIDE" },
  { href: "/box", label: "THE BOX" },
  { href: "/about", label: "ABOUT" },
] as const;

/** The wordmark home and the three routes, as on the landing canvas. */
export function SiteHeader({ current }: { current?: (typeof NAV)[number]["href"] }) {
  return (
    <header className="relative z-[2] mx-auto box-border flex w-full max-w-[1312px] flex-wrap items-center justify-between gap-4 px-5 pt-7 sm:px-8">
      <Link href="/" className={`flex min-h-11 items-center gap-2.5 font-mono text-[13px] font-semibold tracking-[0.14em] text-ink hover:text-white ${ring}`}>
        <SwarmMark />
        SWARM
      </Link>
      <nav aria-label="Main" className="flex flex-wrap gap-1 font-mono text-[13px] tracking-[0.08em]">
        {NAV.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            aria-current={current === href ? "page" : undefined}
            className={`flex min-h-11 items-center px-3.5 text-label hover:text-white aria-[current=page]:text-ink ${ring}`}
          >
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="relative z-[1] mx-auto box-border flex w-full max-w-[1312px] flex-wrap justify-between gap-3 px-5 pt-2 pb-7 font-mono text-xs text-faint sm:px-8">
      <span>
        Built by{" "}
        <a href="https://badcodes.dev" className={`text-muted hover:text-white ${ring}`}>
          BadCodes
        </a>
      </span>
      <span className="flex flex-wrap gap-x-5 gap-y-2">
        <span>Sound off by default</span>
        <span>Best on a GPU</span>
        <a href="https://github.com/BadCodesGG/swarm" className={`text-muted hover:text-white ${ring}`}>
          Source
        </a>
      </span>
    </footer>
  );
}
