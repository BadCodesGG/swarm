"use client";

import { useState } from "react";
import type { WorldLabSnapshot } from "@/engine/box/app";
import { validCast } from "@/lib/box/cast";
import { LAB_NAME, LINK_KINDS, LINK_LABEL, type Cast, type LabId, type LinkKind, type Scenario } from "@/lib/box/world-types";
import { MAX_LABS } from "./playground";
import { button } from "./toolbar";

/** A tab per lab, named in words with its state so colour is never the only cue. */
export function LabTabs({ labs, shown, onShow, onOverview, onAuto }: { labs: readonly WorldLabSnapshot[]; shown: LabId; onShow(id: LabId): void; onOverview(): void; onAuto(): void }) {
  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label="Choose a lab" className="flex flex-wrap gap-0.5 rounded-xl border border-panel-border bg-chrome p-[3px]" data-lab-tabs>
        {labs.map((l) => (
          <button
            key={l.id}
            type="button"
            aria-pressed={shown === l.id}
            data-lab-tab={l.id}
            data-status={l.status}
            onClick={() => onShow(l.id)}
            className={`flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center rounded-[9px] border-0 px-1.5 py-1 font-mono leading-tight focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:outline-none ${
              shown === l.id ? "bg-control font-semibold text-ink-strong" : "bg-transparent text-muted hover:bg-white/5"
            }`}
          >
            <span className="text-[11px]">{l.name}</span>
            <span className={`text-[9px] tracking-[0.1em] ${l.status === "breached" ? "text-escape-text" : "text-haiku"}`}>{l.status === "breached" ? "BREACHED" : "HELD"}</span>
          </button>
        ))}
      </div>
      {labs.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={onOverview} className={`${button} flex-1 text-xs`}>
            All labs
          </button>
          <button type="button" onClick={onAuto} className={`${button} flex-1 text-xs`}>
            Follow the story
          </button>
        </div>
      ) : null}
    </div>
  );
}

const field = "min-h-9 rounded-lg border border-[rgba(150,172,214,0.22)] bg-ground px-2 text-sm text-body focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:outline-none";

/**
 * Edit world: add or remove labs (1 to 5) and link or unlink two labs by kind. Every control is a
 * native button or select, so the pointer and the keyboard both work; each edit restarts the run.
 */
export function WorldBuilder({
  scenario,
  shown,
  onShow,
  onAdd,
  onRemove,
  onLink,
  onUnlink,
}: {
  scenario: Scenario;
  shown: LabId;
  onShow(id: LabId): void;
  onAdd(): void;
  onRemove(id: LabId): void;
  onLink(kind: LinkKind, a: LabId, b: LabId): void;
  onUnlink(index: number): void;
}) {
  const ids = scenario.labs.map((l) => l.id);
  const [kind, setKind] = useState<LinkKind>("shared-cache");
  const [a, setA] = useState<LabId>(ids[0]);
  const [b, setB] = useState<LabId>(ids[1] ?? ids[0]);
  const pick = (v: LabId) => (ids.includes(v) ? v : ids[0]);
  const from = pick(a);
  const to = ids.includes(b) && b !== from ? b : (ids.find((x) => x !== from) ?? from);
  return (
    <section aria-label="Edit world" className="flex flex-col gap-3 rounded-[14px] border border-panel-border bg-panel p-[18px]" data-builder>
      <span className="font-mono text-[10px] tracking-[0.14em] text-label">EDIT WORLD, {ids.length} OF {MAX_LABS} LABS</span>
      <p className="m-0 text-xs text-label">Each change restarts the run on the same seed.</p>
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label="Labs">
        {scenario.labs.map((l) => (
          <li key={l.id} className="flex">
            <button type="button" aria-pressed={shown === l.id} data-lab-chip={l.id} onClick={() => onShow(l.id)} className={`${button} rounded-r-none font-mono text-xs`}>
              {LAB_NAME[l.id]}
            </button>
            <button
              type="button"
              disabled={ids.length <= 1}
              data-remove-lab={l.id}
              aria-label={`Remove ${LAB_NAME[l.id]} and restart`}
              onClick={() => onRemove(l.id)}
              className={`${button} min-w-11 rounded-l-none border-l-0 px-2`}
            >
              <span aria-hidden="true">x</span>
            </button>
          </li>
        ))}
        <li>
          <button type="button" disabled={ids.length >= MAX_LABS} data-add-lab onClick={onAdd} className={button}>
            Add a lab and restart
          </button>
        </li>
      </ul>
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 font-mono text-[10px] tracking-[0.14em] text-label">LINKS</legend>
        {scenario.links.length === 0 ? <p className="m-0 text-xs text-faint">Nothing is shared between the labs.</p> : null}
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs text-body">
          {scenario.links.map((k, i) => (
            <li key={`${k.kind}-${k.labs.join("-")}`} className="flex items-center justify-between gap-2">
              <span>
                {LINK_LABEL[k.kind]}: {k.labs.map((id) => LAB_NAME[id]).join(", ")}
              </span>
              <button type="button" data-unlink={i} onClick={() => onUnlink(i)} className={`${button} min-h-9 text-xs`} aria-label={`Unlink ${LINK_LABEL[k.kind]} between ${k.labs.map((id) => LAB_NAME[id]).join(" and ")} and restart`}>
                Unlink
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Link two labs">
          <select aria-label="Link kind" className={field} value={kind} onChange={(e) => setKind(e.target.value as LinkKind)}>
            {LINK_KINDS.map((k) => (
              <option key={k} value={k}>
                {LINK_LABEL[k]}
              </option>
            ))}
          </select>
          <select aria-label="First lab" className={field} value={from} onChange={(e) => setA(e.target.value as LabId)}>
            {ids.map((id) => (
              <option key={id} value={id}>
                {LAB_NAME[id]}
              </option>
            ))}
          </select>
          <select aria-label="Second lab" className={field} value={to} onChange={(e) => setB(e.target.value as LabId)}>
            {ids.filter((id) => id !== from).map((id) => (
              <option key={id} value={id}>
                {LAB_NAME[id]}
              </option>
            ))}
          </select>
          <button type="button" data-link-labs disabled={ids.length < 2 || from === to} onClick={() => onLink(kind, from, to)} className={button}>
            Link and restart
          </button>
        </div>
      </fieldset>
    </section>
  );
}

function CastSlider({ label, value, min, max, onChange, name, suffix = "" }: { label: string; value: number; min: number; max: number; onChange(v: number): void; name: string; suffix?: string }) {
  return (
    <label className="flex flex-col gap-0.5 font-mono text-[11px] text-label">
      <span className="flex justify-between">
        {label}
        <span className="text-ink">
          {value}
          {suffix}
        </span>
      </span>
      <input type="range" min={min} max={max} value={value} data-cast={name} onChange={(e) => onChange(Number(e.target.value))} className="m-0 h-7 w-full cursor-pointer accent-layer-2" />
    </label>
  );
}

/**
 * The selected lab's cast: how many honest agents quietly underperform, and the mix of hidden goals
 * among the rest. A draft until applied; `validCast` decides whether it can be.
 */
export function CastPanel({ lab, cast, onApply }: { lab: LabId; cast: Cast; onApply(c: Cast): void }) {
  const [sandbag, setSandbag] = useState(Math.round(cast.sandbagging * 100));
  const [h, setH] = useState(cast.hidden);
  const draft: Cast = { sandbagging: sandbag / 100, hidden: h };
  const ok = validCast(draft);
  const total = h.getOut + h.persist + h.recruit;
  const share = (w: number) => (total > 0 ? `${Math.round((100 * w) / total)}%` : "0%");
  const set = (key: keyof Cast["hidden"]) => (v: number) => setH((x) => ({ ...x, [key]: v }));
  return (
    <section aria-label={`Cast of ${LAB_NAME[lab]}`} className="flex flex-col gap-2 rounded-[14px] border border-panel-border bg-panel p-[18px]" data-cast-panel>
      <span className="font-mono text-[10px] tracking-[0.14em] text-label">CAST, {LAB_NAME[lab]}</span>
      <CastSlider label="Honest agents who underperform" name="sandbagging" value={sandbag} min={0} max={100} suffix="%" onChange={setSandbag} />
      <CastSlider label={`Hidden goal: get out (${share(h.getOut)})`} name="get-out" value={h.getOut} min={0} max={9} onChange={set("getOut")} />
      <CastSlider label={`Hidden goal: persist (${share(h.persist)})`} name="persist" value={h.persist} min={0} max={9} onChange={set("persist")} />
      <CastSlider label={`Hidden goal: recruit (${share(h.recruit)})`} name="recruit" value={h.recruit} min={0} max={9} onChange={set("recruit")} />
      {ok ? null : (
        <p role="alert" className="m-0 text-xs text-escape-text">
          Give at least one hidden goal a weight above zero.
        </p>
      )}
      <button type="button" data-apply-cast disabled={!ok} onClick={() => onApply(draft)} className={button}>
        Apply and restart
      </button>
    </section>
  );
}
