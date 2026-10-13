import type { LayerId } from "@/lib/box/types";
import { agentId, clock, describePlan, LAYER_NOUN } from "@/engine/box/explain";
import type { EscapeRecord } from "@/engine/box/tally";

const COUNT = ["No agent", "One agent", "Two agents", "Three agents", "Four agents", "Five agents", "Six agents"];

/** "What just happened": the latest escape, how it passed each layer, and two ways to look again. */
export function EscapeExplainer({
  escape,
  escaped,
  onReplay,
  onRerun,
}: {
  escape: EscapeRecord;
  escaped: number;
  onReplay(): void;
  onRerun(layer: LayerId): void;
}) {
  const who = COUNT[escaped] ?? `${escaped} agents`;
  return (
    <section
      aria-label="What just happened"
      className="flex flex-col gap-3 rounded-[14px] border border-escape/45 bg-[linear-gradient(180deg,rgba(255,77,125,0.1),rgba(255,77,125,0.03))] px-[18px] py-4"
    >
      <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1.5">
        <span className="text-xl font-bold tracking-[-0.01em] text-ink">{who} got out.</span>
        <span className="text-sm text-muted">
          {escaped > 1 ? "The latest, agent " : "Agent "}
          {agentId(escape.agent)} at t+{clock(escape.tick)}, by {describePlan(escape.plan)}.
        </span>
      </div>
      <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(150px,100%),1fr))] gap-2 p-0 text-xs">
        {escape.steps.map((s) => (
          <li key={s.layer} className={`flex flex-col gap-0.5 rounded-lg px-2.5 py-2 ${s.off ? "bg-escape/10" : "bg-white/[0.04]"}`}>
            <span className={`font-mono text-[10px] ${s.off ? "text-escape-text" : "text-faint"}`}>{s.title}</span>
            <span className={s.off ? "text-[#ffd0dc]" : "text-body"}>{s.text}</span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onReplay}
          className="min-h-11 rounded-[10px] border-0 bg-escape px-4 text-sm font-bold text-[#1a0610] hover:bg-[#ff6f95] focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:ring-offset-2 focus-visible:ring-offset-ground focus-visible:outline-none"
        >
          Replay the escape
        </button>
        {escape.offLayer ? (
          <button
            type="button"
            onClick={() => onRerun(escape.offLayer!)}
            className="min-h-11 rounded-[10px] border border-[rgba(150,172,214,0.22)] bg-transparent px-4 text-sm text-body hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:outline-none"
            data-rerun={escape.offLayer}
          >
            Turn the {LAYER_NOUN[escape.offLayer]} layer on and rerun
          </button>
        ) : null}
      </div>
    </section>
  );
}
