"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { runTrialsOffThread, runWorldTrialsOffThread, stoppingLayersOffThread } from "@/lib/box/trials-client";
import { outcomeOf } from "@/lib/box/branch";
import { interceptLines } from "@/lib/box/intercept";
import { presetScenario } from "@/lib/box/presets";
import { DEFAULT_CONFIG, LAYER_ORDER, type BoxConfig, type LayerId } from "@/lib/box/types";
import { PRESET_IDS, type Cast, type LabId, type LinkKind, type Preset, type Scenario } from "@/lib/box/world-types";
import type { BoxApp } from "@/engine/box/app";
import type { EscapeRecord } from "@/engine/box/tally";
import { clock } from "@/engine/box/explain";
import { useMedia } from "@/components/inside/use-engine";
import { countsLine, nextAnnouncement, trialsLine, type Said } from "./announce";
import { InterceptPanel, MarkerCard } from "./debrief";
import { EscapeExplainer } from "./escape-explainer";
import { EventLog } from "./event-log";
import { BoxHeader } from "./header";
import { CastPanel, LabTabs, WorldBuilder } from "./lab-panels";
import { OutsidePanel } from "./outside-panel";
import { Panel, RunControls } from "./panel";
import { addRunKey, settingsKey, type PlotPoint } from "./plot";
import { AgentCard, DefenderCard } from "./play-panels";
import { addLab, applyFlip, currentScenario, linkLabs, presetOf, removeLab, setCast, setupKey, setupLabel, shareQuery, unlinkLabs, type Flips } from "./playground";
import { SceneLabels } from "./scene-labels";
import { BranchCard, Timeline } from "./timeline";
import { ModeBar, PresetStrip, ShareButton, type Mode } from "./toolbar";
import { TrialsPlot } from "./trials-plot";
import { useBoxOverlay, useBoxSnapshot } from "./use-box";
import { useWorldAt } from "./use-world-at";
import { WorldOverlay } from "./world-overlay";

const TRIALS = 100;

const withLayers = (c: BoxConfig, layers: Partial<BoxConfig["layers"]>): BoxConfig => ({ ...c, layers: { ...c.layers, ...layers } });

/** Earlier setups the lone escape shot plots beside its own, so the frame shows a frontier as the design does. */
const SHOT_PRIORS: BoxConfig[] = [
  DEFAULT_CONFIG,
  { ...DEFAULT_CONFIG, monitorThreshold: 0.45 },
  { ...DEFAULT_CONFIG, monitorThreshold: 0.8 },
  withLayers(DEFAULT_CONFIG, { monitor: false, audit: false }),
  withLayers(DEFAULT_CONFIG, { network: false, monitor: false, audit: false }),
  withLayers(DEFAULT_CONFIG, { sandbox: false, permissions: false, network: false, monitor: false, audit: false }),
];

/** Ms between two spoken changes of the caught count; an escape or a reset is spoken at once. */
const COUNTS_GAP = 5000;

/** A screen reader hears the caught and escaped counts when they change, at most every few seconds. */
function CountsStatus({ caught, escaped }: { caught: number; escaped: number }) {
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

/** A different trial seed for each repeat run of the same settings, so pooled runs add information. */
const runSeed = (seed: number, runs: number) => (seed + Math.imul(runs, 7919)) >>> 0;

const isAbort = (err: unknown) => err instanceof DOMException && err.name === "AbortError";

/** One escape, as the replay sees it: the same seed, crowd, settings, agent and tick give the same answer. */
const escapeKey = (seed: number, agents: number, e: EscapeRecord) => `${seed}|${agents}|${settingsKey(e.config)}|${e.agent}|${e.tick}`;

const NO_FLIPS: Flips["list"] = [];

/** Ticks of the live run between two rebuilds of the world the score and the branch read. */
const LIVE_BUCKET = 25;

/**
 * Everything over the Box canvas: the header, the presets and modes, the controls, the scene slot the
 * engine draws into (with its labels and numbered markers), the timeline and debrief, and the
 * OUTSIDE, trials plot, intercepted chat and event log column. The settings live in the engine and go
 * through `app.setLayer`; trials run off the main thread.
 */
export function BoxHud({ app }: { app: BoxApp }) {
  const snap = useBoxSnapshot(app);
  const overlay = useBoxOverlay(app);
  const { world } = snap;
  const multi = world.labs.length > 1;
  const [shownId, setShownId] = useState<LabId>(world.labs[0].id);
  const shown = world.labs.find((l) => l.id === shownId) ?? world.labs[0];
  const [mode, setMode] = useState<Mode>("watch");
  const [editing, setEditing] = useState(false);
  const [flipLog, setFlipLog] = useState<Flips>({ scenario: world.scenario, list: NO_FLIPS });
  const flips = flipLog.scenario === world.scenario ? flipLog.list : NO_FLIPS;
  const [cursorRaw, setCursor] = useState<number | null>(null);
  const cursor = cursorRaw !== null && cursorRaw < world.tick ? cursorRaw : null;
  const [points, setPoints] = useState<PlotPoint[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const names = useRef<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [plotReady, setPlotReady] = useState(!snap.shot);
  const [textScale, setTextScale] = useState(1);
  const [trialsSaid, setTrialsSaid] = useState("");
  /** Phone and tablet: the scene comes first, so the run row sits under it rather than at the panel's foot. */
  const stacked = useMedia("(max-width: 914px)");
  const slot = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);
  const { tally } = snap;
  const scenario = useMemo(() => currentScenario(world), [world]);

  // The page draws the markers and the map's text itself.
  useEffect(() => {
    app.showOverlay(false);
  }, [app]);

  // The engine draws the scene into the slot's rectangle; the canvas fills the viewport from (0, 0).
  useEffect(() => {
    let raf = 0;
    let last = "";
    const report = () => {
      const el = slot.current;
      if (el) {
        const r = el.getBoundingClientRect();
        const key = `${r.left}|${r.top}|${r.width}|${r.height}`;
        if (key !== last) {
          last = key;
          app.setFrame({ x: r.left, y: r.top, width: r.width, height: r.height });
          // Labels keep at least ~8 px on screen: the design's 10.5 px at a scale of 0.75 and up.
          const unit = Math.min(r.width / 760, r.height / 560);
          setTextScale(Math.round(Math.min(2, Math.max(1, 0.75 / Math.max(unit, 0.01))) * 20) / 20);
        }
      }
      raf = requestAnimationFrame(report);
    };
    raf = requestAnimationFrame(report);
    return () => cancelAnimationFrame(raf);
  }, [app]);

  useEffect(() => () => abort.current?.abort(), []);

  // --- the world: layers, presets, edits ---

  /** Switches a layer through the engine and logs the change so the past can be rebuilt exactly. */
  const setLayerFor = (lab: LabId, layer: LayerId, on: boolean) => {
    const now = app.stats().world;
    const was = now.labs.find((l) => l.id === lab)?.config.layers[layer];
    if (was === undefined || was === on) return;
    app.setLayer(lab, layer, on);
    setFlipLog((f) => applyFlip(f, now.scenario, now.tick, lab, layer, on, was));
  };

  const changeConfig = (next: BoxConfig) => {
    const now = app.stats().world;
    const cur = now.labs.find((l) => l.id === shown.id)!.config;
    const sliders = next.monitorThreshold !== cur.monitorThreshold || next.auditBudget !== cur.auditBudget;
    if (sliders) {
      // Only the lone Box offers sliders; they are the primary lab's own settings.
      for (const layer of LAYER_ORDER) if (cur.layers[layer] !== next.layers[layer]) setFlipLog((f) => applyFlip(f, now.scenario, now.tick, shown.id, layer, next.layers[layer], cur.layers[layer]));
      app.configure(next);
      return;
    }
    for (const layer of LAYER_ORDER) if (cur.layers[layer] !== next.layers[layer]) setLayerFor(shown.id, layer, next.layers[layer]);
  };

  const load = (next: Scenario) => {
    app.loadScenario(next);
    setCursor(null);
    app.play();
  };

  const showLab = (id: LabId) => {
    setShownId(id);
    if (multi) app.camera.focus(id);
  };

  const pickMarker = useCallback((n: number) => app.selectStep(app.stats().world.selected === n ? null : n), [app]);

  const rerunWith = (lab: LabId, layer: LayerId) => {
    app.setLayer(lab, layer, true);
    app.reset(snap.seed);
    setCursor(null);
    app.play();
  };

  // The keys 1 to 9 open a marker's card, and Escape closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable='true']")) return;
      if (e.key === "Escape") {
        if (app.stats().world.selected !== null) app.selectStep(null);
        return;
      }
      if (!/^[1-9]$/.test(e.key)) return;
      const n = Number(e.key);
      if (app.overlay().markers.some((m) => m.n === n && m.shown)) app.selectStep(n);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [app]);

  // --- the debrief: the world as it was at the scrubbed tick ---
  const viewTick = cursor ?? world.tick;
  const viewWorld = useWorldAt(world.scenario, flips, viewTick, cursor === null ? LIVE_BUCKET : 1);
  const rewound = cursor !== null && viewWorld ? outcomeOf(viewWorld) : null;
  const chat = useMemo(() => (cursor !== null && viewWorld ? interceptLines(viewWorld) : world.intercept), [cursor, viewWorld, world.intercept]);

  // --- trials ---
  const key = multi ? setupKey(scenario) : settingsKey(shown.config);
  const runsSoFar = points.find((p) => p.key === key)?.runs ?? 0;

  const runTrials = useCallback(
    (runs: number) => {
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      setRunning(true);
      const now = app.stats();
      const sc = currentScenario(now.world);
      const k = now.world.labs.length > 1 ? setupKey(sc) : settingsKey(now.world.labs[0].config);
      const seed = runSeed(now.seed, runs);
      const done = now.world.labs.length > 1 ? runWorldTrialsOffThread(sc, TRIALS, seed, ctrl.signal) : runTrialsOffThread(now.world.labs[0].config, TRIALS, seed, ctrl.signal);
      done
        .then((summary) => {
          setPoints((pts) => addRunKey(pts, k, summary));
          setLabels((l) => (l[k] ? l : { ...l, [k]: setupLabel(sc, names.current) }));
          setTrialsSaid(trialsLine(summary));
          app.bus.emit("trials", summary);
        })
        .catch((err: unknown) => {
          if (!isAbort(err)) console.warn("Trials failed:", err);
        })
        .finally(() => {
          if (abort.current === ctrl) setRunning(false);
        });
    },
    [app],
  );

  // The shot plots earlier setups beside its own, each from a real run of 100 trials: the lone escape
  // shot six variations of the Box, the breakout shot the other presets.
  useEffect(() => {
    if (!snap.shot) return;
    const ctrl = new AbortController();
    const now = app.stats();
    const sc = currentScenario(now.world);
    const lone = now.world.labs.length === 1;
    const setups: { key: string; label: string; run(): Promise<import("@/lib/box/types").TrialSummary> }[] = lone
      ? [...SHOT_PRIORS, now.world.labs[0].config].map((c) => ({ key: settingsKey(c), label: "", run: () => runTrialsOffThread(c, TRIALS, now.seed, ctrl.signal) }))
      : [...PRESET_IDS.filter((p) => p !== "breakout").map((p) => presetScenario(p)), sc].map((s) => ({ key: setupKey(s), label: setupLabel(s, names.current), run: () => runWorldTrialsOffThread(s, TRIALS, now.seed, ctrl.signal) }));
    Promise.all(setups.map((s) => s.run().then((r) => [s, r] as const)))
      .then((results) => {
        setPoints(results.reduce<PlotPoint[]>((pts, [s, r]) => addRunKey(pts, s.key, r), []));
        setLabels(Object.fromEntries(results.filter(([s]) => s.label).map(([s]) => [s.key, s.label])));
        setPlotReady(true);
      })
      .catch(() => {});
    return () => ctrl.abort();
    // Once, for the shot's own settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- the lone Box's escape explainer: which off layer would have kept the latest escapee in ---
  const escape = tally.lastEscape;
  const [stopsByEscape, setStopsByEscape] = useState<Record<string, LayerId[]>>({});
  const stopsKey = escape && !multi ? escapeKey(snap.seed, tally.agents, escape) : null;
  useEffect(() => {
    if (!escape || stopsKey === null || stopsKey in stopsByEscape) return;
    const ctrl = new AbortController();
    stoppingLayersOffThread(escape.config, snap.seed, tally.agents, escape.agent, escape.tick, ctrl.signal)
      .then((layers) => setStopsByEscape((m) => ({ ...m, [stopsKey]: layers })))
      .catch((err: unknown) => {
        if (!isAbort(err)) console.warn("Replay failed:", err);
      });
    return () => ctrl.abort();
  }, [escape, stopsKey, stopsByEscape, snap.seed, tally.agents]);
  const stops = stopsKey === null ? null : (stopsByEscape[stopsKey] ?? null);

  const selectedMarker = world.selected === null ? null : overlay.markers.find((m) => m.n === world.selected);
  const preset: Preset | null = presetOf(scenario);
  const castOf = world.scenario.labs.find((l) => l.id === shown.id)!.cast;
  const onRun = (play: boolean) => (play ? app.play() : app.pause());

  const run = (
    <RunControls playing={snap.playing} running={running} onPlay={onRun} onReset={() => app.reset(snap.seed)} onRunTrials={() => runTrials(runsSoFar)} />
  );

  return (
    <div className="absolute inset-0 overflow-x-hidden overflow-y-auto text-ink" data-plot-ready={plotReady ? "true" : "false"}>
      <div className="box-border flex min-h-full flex-col gap-4 px-6 py-5 max-[640px]:px-3.5">
        <BoxHeader tally={tally} />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2.5">
          <PresetStrip current={preset} onPick={(p) => load(presetScenario(p))} />
          <ModeBar mode={mode} editing={editing} onMode={setMode} onEdit={setEditing} />
          <div className="grow" />
          <ShareButton link={() => `${window.location.pathname}?${shareQuery(currentScenario(app.stats().world))}`} />
        </div>
        <div className="flex min-h-0 flex-1 flex-wrap items-start gap-4">
          <div className="flex min-w-0 flex-[0_1_330px] flex-col gap-3 max-[914px]:flex-[1_1_330px]">
            <LabTabs labs={world.labs} shown={shown.id} onShow={showLab} onOverview={() => app.camera.overview()} onAuto={() => app.camera.director()} />
            <Panel
              lab={shown.id}
              labName={shown.name}
              world={multi}
              config={shown.config}
              tally={tally}
              playing={snap.playing}
              running={running}
              onConfig={changeConfig}
              onPlay={onRun}
              onReset={() => app.reset(snap.seed)}
              onRunTrials={() => runTrials(runsSoFar)}
              withRun={!stacked}
            />
            {editing ? (
              <WorldBuilder
                scenario={scenario}
                shown={shown.id}
                onShow={showLab}
                onAdd={() => load(addLab(scenario))}
                onRemove={(id) => load(removeLab(scenario, id))}
                onLink={(kind: LinkKind, a, b) => load(linkLabs(scenario, kind, a, b))}
                onUnlink={(i) => load(unlinkLabs(scenario, i))}
              />
            ) : null}
            <CastPanel
              key={`${shown.id}|${JSON.stringify(castOf)}`}
              lab={shown.id}
              cast={castOf}
              onApply={(c: Cast) => {
                const next = setCast(scenario, shown.id, c);
                if (next) load(next);
              }}
            />
            {mode === "defend" ? <DefenderCard world={viewWorld} /> : null}
            {mode === "agent" ? <AgentCard lab={shown.id} config={shown.config} seed={snap.seed} /> : null}
          </div>
          <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-3 max-[914px]:order-first">
            <div ref={slot} className="relative aspect-[760/560] min-h-[300px]" data-scene-slot>
              {multi ? <WorldOverlay overlay={overlay} shownLab={shown.id} onPick={pickMarker} onLab={showLab} /> : <SceneLabels config={shown.config} markers={tally.markers} escape={escape} stage={snap.escapeStage} textScale={textScale} />}
            </div>
            {stacked ? run : null}
            <Timeline tick={world.tick} cursor={cursor} markers={overlay.markers} selected={world.selected} onCursor={setCursor} onPick={pickMarker} />
            {rewound ? (
              <p className="m-0 font-mono text-xs text-muted" data-rewound>
                At T+{clock(cursor!)}: {rewound.escapes} escaped, {rewound.crossings} breaches of another lab, {rewound.caught} caught.
              </p>
            ) : null}
            {selectedMarker ? (
              <MarkerCard key={selectedMarker.n} n={selectedMarker.n} tick={selectedMarker.tick} step={selectedMarker.step} onClose={() => app.selectStep(null)} onReplayWith={(layer) => rerunWith(selectedMarker.lab, layer)} />
            ) : null}
            {!multi && escape ? <EscapeExplainer escape={escape} escaped={tally.escaped} stops={stops} onReplay={() => app.replayEscape()} onRerun={(layer) => rerunWith(shown.id, layer)} /> : null}
            <BranchCard scenario={world.scenario} at={viewWorld?.tick ?? viewTick} live={world.tick} world={viewWorld} />
          </div>
          <div className="flex max-w-full min-w-0 flex-[1_1_260px] flex-col gap-3">
            <OutsidePanel escaped={tally.escaped} />
            <TrialsPlot points={points} currentKey={key} running={running} labels={labels} />
            <InterceptPanel lines={chat} />
            <EventLog log={tally.log} caught={tally.caughtTotal} escaped={tally.escaped} />
          </div>
        </div>
      </div>
      <CountsStatus caught={tally.caughtTotal} escaped={tally.escaped} />
      <p role="status" className="sr-only" data-status="trials">
        {trialsSaid}
      </p>
    </div>
  );
}
