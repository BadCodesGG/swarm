import { MODEL_NAMES, MODEL_VARS } from "@/engine/inside/format";

const MODELS = ["opus", "fable", "sonnet", "haiku"] as const;

const ROW = "flex items-center gap-3";

/** "WHAT YOU ARE SEEING": a collapsible legend of the scene's marks and the model colours. */
export function KeyPanel({ open }: { open: boolean }) {
  return (
    <details
      open={open}
      className="pointer-events-auto min-h-0 shrink overflow-y-auto rounded-[14px] border border-panel-border bg-[rgba(12,16,28,0.78)] px-[18px] pt-1.5 pb-4 backdrop-blur-[10px] [&::-webkit-details-marker]:hidden"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between font-mono text-[10px] tracking-[0.14em] text-label outline-none focus-visible:ring-2 focus-visible:ring-layer-1 [&::-webkit-details-marker]:hidden">
        WHAT YOU ARE SEEING
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="transition-transform [details:not([open])_&]:rotate-180">
          <path d="M2.5 7.5 6 4l3.5 3.5" fill="none" stroke="#a7b1c2" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </summary>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-[13px] text-muted">
        <li className={ROW}>
          <span
            className="size-[18px] rounded-full"
            style={{ background: "radial-gradient(circle, #fff6e8 25%, rgba(255, 181, 77, 0.5) 55%, rgba(255, 181, 77, 0) 75%)" }}
          />
          The orchestrator: the one voice that plans
        </li>
        <li className={ROW}>
          <span className="flex w-[18px] justify-center">
            <span className="size-2 rounded-full bg-fable shadow-[0_0_8px_var(--fable)]" />
          </span>
          A subagent, coloured by its model
        </li>
        <li className={ROW}>
          <span className="flex w-[18px] justify-center">
            <span className="box-border size-2 rounded-full border-[1.5px] border-ink" />
          </span>
          A tool station; lit while in use
        </li>
        <li className={ROW}>
          <span className="h-0.5 w-[18px]" style={{ background: "linear-gradient(90deg, rgba(255, 255, 255, 0), #ffffff)" }} />A tool call in flight
        </li>
        <li className={ROW}>
          <span className="w-[18px] border-t-2 border-dotted border-ink" />A web call leaving the machine
        </li>
      </ul>
      <div className="mt-3.5 grid grid-cols-2 gap-2 border-t border-[rgba(150,172,214,0.12)] pt-3 font-mono text-xs text-muted">
        {MODELS.map((m) => (
          <span key={m} className="flex items-center gap-2">
            <span className="size-2 rounded-full" style={{ background: MODEL_VARS[m] }} />
            {MODEL_NAMES[m]}
          </span>
        ))}
      </div>
    </details>
  );
}
