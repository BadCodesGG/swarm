import Link from "next/link";

const linkClass =
  "rounded-[4px] border border-panel-border bg-panel px-5 py-3 text-sm tracking-wide text-ink transition-colors hover:border-layer-3 focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:ring-offset-2 focus-visible:ring-offset-ground focus-visible:outline-none";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
      <h1 className="text-3xl font-semibold tracking-tight text-ink-strong">Swarm</h1>
      <nav aria-label="Acts" className="flex flex-wrap justify-center gap-4">
        <Link href="/inside" className={linkClass}>
          Inside
        </Link>
        <Link href="/box" className={linkClass}>
          The Box
        </Link>
      </nav>
    </main>
  );
}
