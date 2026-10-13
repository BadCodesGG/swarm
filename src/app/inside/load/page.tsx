import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Load your session",
  description: "Replay your own Claude Code session as a swarm. The file is read in your browser and never uploaded.",
  path: "/inside/load",
});

export default function LoadPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-5 p-8 text-center">
      <h1 className="font-mono text-[11px] tracking-[0.28em] text-ink">LOAD YOUR SESSION</h1>
      <p className="max-w-md text-[15px] leading-snug text-body">
        Replaying your own session is coming. It will read the file in your browser and never upload it.
      </p>
      <Link
        href="/inside"
        className="flex min-h-11 items-center rounded-xl border border-panel-border bg-panel px-5 text-sm text-ink outline-none hover:border-layer-3 focus-visible:ring-2 focus-visible:ring-layer-1"
      >
        Back to the sample
      </Link>
    </main>
  );
}
