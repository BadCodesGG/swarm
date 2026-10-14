"use client";

import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from "react";
import type { WorldLabSnapshot } from "@/engine/box/app";
import { clock, LAYER_NAME } from "@/engine/box/explain";
import type { LayerId } from "@/lib/box/types";
import type { BreakoutStep, LabId } from "@/lib/box/world-types";
import { pinClass, type Pin } from "./timeline";
import { button, iconButton, segment, segmentItem } from "./toolbar";

type Tab = "story" | "feed";

/** A step's verdict in one word, coloured by what it means and never by colour alone. */
export function verdictOf(step: BreakoutStep | null, kind: Pin["kind"]): { text: string; tone: string } {
  const r = step?.verdict?.result;
  if (r === "passed") return { text: "PASSED", tone: "text-warn" };
  if (r === "off") return { text: "OFF", tone: "text-escape-text" };
  if (r === "refused" || kind === "held") return { text: kind === "held" ? "HELD" : "REFUSED", tone: "text-haiku" };
  return kind === "crossing" ? { text: "BREACHED", tone: "font-semibold text-[#ff6f95]" } : { text: "GOT OUT", tone: "font-semibold text-[#ff6f95]" };
}

const title = (name: string) => name.charAt(0) + name.slice(1).toLowerCase();

/** "A", "A and B", "A, B and C", each name in bold. */
function names(labs: readonly WorldLabSnapshot[]): ReactNode {
  return labs.map((l, i) => (
    <span key={l.id}>
      {i === 0 ? "" : i === labs.length - 1 ? " and " : ", "}
      <b className="text-ink-strong">{title(l.name)}</b>
    </span>
  ));
}

function Summary({ labs }: { labs: readonly WorldLabSnapshot[] }) {
  const breached = labs.filter((l) => l.status === "breached");
  const held = labs.filter((l) => l.status !== "breached");
  if (breached.length === 0) return <>Every lab has held so far.</>;
  return (
    <>
      {names(breached)} breached.{held.length ? <> {names(held)} held.</> : null}
    </>
  );
}

export function StepBody({ pin, onReplayWith }: { pin: Pin; onReplayWith(lab: LabId, layer: LayerId): void }) {
  const { step } = pin;
  if (!step) return <p className="m-0 text-[13px] leading-normal text-label">Replaying the run with each layer on, one at a time, to see which would have stopped it.</p>;
  return (
    <>
      <p className="m-0 text-[13px] leading-normal text-muted">{step.body}</p>
      {step.verdict ? (
        <p className="m-0 font-mono text-[11px] text-label" data-verdict={step.verdict.result}>
          {step.verdict.text}
        </p>
      ) : null}
      {step.kind === "held" ? null : (
        <div className="flex flex-col gap-0.5 rounded-[10px] border border-panel-border px-2.5 py-2">
          <span className="font-mono text-[10px] tracking-[0.14em] text-label uppercase">Would have stopped it</span>
          <span className="text-[13px] font-semibold text-ink" data-stopped-by>
            {step.stoppedBy.length > 0 ? step.stoppedBy.map((l) => LAYER_NAME[l]).join(", ") : "No single layer."}
          </span>
          <span className="text-xs text-label">{step.stop}</span>
        </div>
      )}
      {step.stoppedBy.length ? (
        <div className="flex flex-wrap gap-2">
          {step.stoppedBy.map((l) => (
            <button key={l} type="button" data-replay-with={l} onClick={() => onReplayWith(step.lab, l)} className={`${button} grow border-escape/55 text-[#ffd0dc]`}>
              Replay with the {LAYER_NAME[l].toLowerCase()} on
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}

/**
 * The left rail in Watch: the Story tab lists the numbered steps (the same pins the map and the
 * timeline show), each opening in place to say what happened, the layer's verdict and which layer
 * would have stopped it, with a replay; previous and next walk them. The Feed tab holds the logs.
 * In another mode `primary` takes the first tab's place (the defender's meter, the agent's hand).
 */
export function StoryRail({
  presetName,
  labs,
  pins,
  selected,
  onPick,
  onClose,
  onStep,
  onReplayWith,
  lead,
  primary,
  feed,
}: {
  presetName: string | null;
  labs: readonly WorldLabSnapshot[];
  pins: readonly Pin[];
  selected: number | null;
  /** Opens a step, or closes it when it is the open one. */
  onPick(n: number): void;
  onClose(): void;
  onStep(dir: 1 | -1): void;
  onReplayWith(lab: LabId, layer: LayerId): void;
  /** Above the steps: the lone Box's escape explainer, which has no steps. */
  lead?: ReactNode;
  primary?: { label: string; node: ReactNode } | null;
  feed: ReactNode;
}) {
  const id = useId();
  const [tab, setTab] = useState<Tab>("story");
  // A step opened anywhere (the map, a pin, a key) or a new mode brings the first tab forward.
  const [seen, setSeen] = useState({ selected, primary: primary?.label ?? null });
  if (seen.selected !== selected || seen.primary !== (primary?.label ?? null)) {
    setSeen({ selected, primary: primary?.label ?? null });
    if ((selected !== null && selected !== seen.selected) || seen.primary !== (primary?.label ?? null)) setTab("story");
  }
  // The open step scrolls into view inside the rail.
  useEffect(() => {
    if (selected !== null) document.querySelector(`[data-marker-card="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const steps = [...pins].sort((a, b) => a.n - b.n);
  const tabs: [Tab, string][] = [
    ["story", primary?.label ?? "Story"],
    ["feed", "Feed"],
  ];
  const onTabKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next: Tab = tab === "story" ? "feed" : "story";
    setTab(next);
    document.getElementById(`${id}-${next}-tab`)?.focus();
  };
  const closeFrom = (e: KeyboardEvent, n: number) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    onClose();
    // Back to the step's own row, which stays.
    requestAnimationFrame(() => document.getElementById(`${id}-step-${n}`)?.focus());
  };

  const story = primary ? (
    primary.node
  ) : (
    <>
      <div>
        <div className="font-mono text-[10px] tracking-[0.14em] text-label uppercase">
          {presetName ?? "Your scenario"}, {steps.length} {steps.length === 1 ? "step" : "steps"}
        </div>
        <p className="mt-1.5 mb-0 text-[15px] leading-[1.45] text-ink">{labs.length > 1 ? <Summary labs={labs} /> : "One lab. Each escape is explained here as it happens."}</p>
      </div>
      {lead}
      {steps.length === 0 && labs.length > 1 ? <p className="m-0 text-[13px] text-faint">The steps appear here as the run reaches them.</p> : null}
      <ol className="m-0 flex list-none flex-col gap-0.5 p-0" aria-label="Steps">
        {steps.map((p) => {
          const open = selected === p.n;
          const v = verdictOf(p.step, p.kind);
          return (
            <li
              key={p.n}
              className={`rounded-xl border ${open ? "border-escape/35 bg-escape/[0.06]" : "border-transparent"}`}
              data-marker-card={open ? p.n : undefined}
              onKeyDown={open ? (e) => closeFrom(e, p.n) : undefined}
            >
              <button
                id={`${id}-step-${p.n}`}
                type="button"
                aria-expanded={open}
                aria-controls={`${id}-body-${p.n}`}
                onClick={() => onPick(p.n)}
                data-story-step={p.n}
                className="flex min-h-11 w-full gap-3 rounded-xl border-0 bg-transparent px-3 py-2.5 text-left text-body hover:bg-white/[0.03] focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:outline-none"
              >
                <span aria-hidden="true" className={`${pinClass(p.kind, open)} mt-px h-[26px] w-[26px] text-xs`}>
                  {p.n}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                  <span className="flex justify-between gap-2">
                    <span className="text-sm font-semibold text-ink-strong">{p.step?.title ?? "Working out what happened"}</span>
                    <span className="font-mono text-[11px] text-faint">{clock(p.tick)}</span>
                  </span>
                  <span className="font-mono text-[10px] tracking-[0.1em] text-label">
                    {p.step?.where ?? p.lab.toUpperCase()} <span className={v.tone}>{v.text}</span>
                  </span>
                </span>
              </button>
              {open ? (
                <div id={`${id}-body-${p.n}`} className="flex flex-col gap-2 px-3 pb-3 pl-[50px]">
                  <StepBody pin={p} onReplayWith={onReplayWith} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </>
  );

  return (
    <aside aria-label={primary ? primary.label : "The story"} className="flex min-h-0 flex-col gap-3 rounded-[14px] border border-panel-border bg-panel p-4" data-story-rail>
      <div role="tablist" aria-label="Left panel" className={`${segment} self-start`}>
        {tabs.map(([t, label]) => (
          <button
            key={t}
            id={`${id}-${t}-tab`}
            type="button"
            role="tab"
            aria-selected={tab === t}
            aria-controls={`${id}-${t}`}
            tabIndex={tab === t ? 0 : -1}
            onClick={() => setTab(t)}
            onKeyDown={onTabKey}
            className={segmentItem}
            data-rail-tab={t}
          >
            {label}
          </button>
        ))}
      </div>
      <div id={`${id}-story`} role="tabpanel" aria-labelledby={`${id}-story-tab`} hidden={tab !== "story"} className="-mx-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1">
        {story}
      </div>
      <div id={`${id}-feed`} role="tabpanel" aria-labelledby={`${id}-feed-tab`} hidden={tab !== "feed"} className="-mx-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1" data-feed>
        {feed}
      </div>
      {!primary && tab === "story" && steps.length ? (
        <div className="flex shrink-0 items-center gap-2 border-t border-panel-border pt-3">
          <button type="button" aria-label="Previous step" aria-keyshortcuts="[" title="Previous step ([)" onClick={() => onStep(-1)} className={iconButton} data-step-prev>
            <span aria-hidden="true">{"←"}</span>
          </button>
          <span className="grow text-center font-mono text-[11px] text-label">{selected === null ? `${steps.length} steps` : `Step ${selected} of ${steps.length}`}</span>
          <button type="button" aria-label="Next step" aria-keyshortcuts="]" title="Next step (])" onClick={() => onStep(1)} className={iconButton} data-step-next>
            <span aria-hidden="true">{"→"}</span>
          </button>
        </div>
      ) : null}
    </aside>
  );
}
