"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { runTrialsOffThread, runWorldTrialsOffThread, stoppingLayersOffThread } from "@/lib/box/trials-client";
import { outcomeOf } from "@/lib/box/branch";
import { presetScenario } from "@/lib/box/presets";
import { DEFAULT_CONFIG, LAYER_ORDER, type BoxConfig, type LayerId, type TrialSummary } from "@/lib/box/types";
import { PRESET_IDS, type Cast, type LabId, type LinkKind, type Preset, type Scenario } from "@/lib/box/world-types";
import type { BoxApp } from "@/engine/box/app";
import type { EscapeRecord } from "@/engine/box/tally";
import { clock } from "@/engine/box/explain";
import { useMedia } from "@/components/inside/use-engine";
import { ActTools, FallbackBadge, HandoffNote, type ActRender } from "@/components/site/act-tools";
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
import { addLab, currentScenario, linkLabs, presetOf, removeLab, setCast, setupKey, setupLabel, shareQuery, unlinkLabs } from "./playground";
import { SceneLabels } from "./scene-labels";
import { BranchCard, Timeline, type Pin } from "./timeline";
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

/** Ticks of the live run between two rebuilds of the world the score, the per-lab figures and the branch read. */
const LIVE_BUCKET = 10;
/** Ms between two threshold changes sent to the engine while a slider is dragged (each replays the run). */
const THRESHOLD_GAP = 250;

type ThresholdKey = "monitorThreshold" | "auditBudget";

/**
 * Everything over the Box canvas. The scene panel is the page's centre: the engine draws into its
 * rect (`app.setFrame`), the run controls and the timeline sit under it, and one slot under those
 * holds whichever debrief or mode panel is on (a marker's card, the defender's meter, the agent's
 * hand). The selected lab's layers, thresholds and cast are in the column beside it; the plot, the
 * intercepted chat and the logs are below. Trials run off the main thread.
 */
export function BoxHud({ app, still = false }: { app: BoxApp; still?: boolean }) {
  const [snap, refresh] = useBoxSnapshot(app);
  const overlay = useBoxOverlay(app);
  const { world } = snap;
  const multi = world.labs.length > 1;
  const tl = overlay.timeline;
  const [shownId, setShownId] = useState<LabId>(world.labs[0].id);
  const shown = world.labs.find((l) => l.id === shownId) ?? world.labs[0];
  const [mode, setMode] = useState<Mode>("watch");
  const [editing, setEditing] = useState(false);
  const [points, setPoints] = useState<PlotPoint[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const names = useRef<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [plotReady, setPlotReady] = useState(!snap.shot);
  const [textScale, setTextScale] = useState(1);
  const [trialsSaid, setTrialsSaid] = useState("");
  /** Phone and tablet: the scene comes first and the column beside it goes under. */
  const stacked = useMedia("(max-width: 914px)");
  const slot = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);
  const { tally } = snap;
  const scenario = useMemo(() => currentScenario(world), [world]);

  // The layer switches made so far (the engine keeps the log, also while a past moment is shown).
  const flipsKey = JSON.stringify(app.flips());
  const flips = useMemo(() => JSON.parse(flipsKey) as ReturnType<BoxApp["flips"]>, [flipsKey]);

  // The page draws the markers and the map's text itself.
  useEffect(() => {
    app.showOverlay(false);
  }, [app]);

  // The engine draws the scene into the scene panel's rect, kept up to date as the page scrolls or resizes.
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
          app.setFrame({ x: r.left, y: r.top, w: r.width, h: r.height });
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

  const thr = useRef<{ timer: number | null; pending: [LabId, ThresholdKey, number] | null }>({ timer: null, pending: null });
  useEffect(() => {
    const t = thr.current;
    return () => {
      abort.current?.abort();
      if (t.timer !== null) window.clearTimeout(t.timer);
    };
  }, []);

  // --- the world: layers, thresholds, presets, edits ---

  const setLayerFor = (lab: LabId, layer: LayerId, on: boolean) => {
    app.setLayer(lab, layer, on);
    refresh();
  };

  const changeConfig = (next: BoxConfig) => {
    for (const layer of LAYER_ORDER) if (shown.config.layers[layer] !== next.layers[layer]) setLayerFor(shown.id, layer, next.layers[layer]);
  };

  /** A slider drag asks the engine for a replay each time: at most one every THRESHOLD_GAP ms, the last value always lands. */
  function setThreshold(lab: LabId, key: ThresholdKey, value: number) {
    const t = thr.current;
    if (t.timer !== null) {
      t.pending = [lab, key, value];
      return;
    }
    app.setThreshold(lab, key, value);
    refresh();
    t.timer = window.setTimeout(() => {
      t.timer = null;
      const p = t.pending;
      t.pending = null;
      if (p) setThreshold(...p);
    }, THRESHOLD_GAP);
  }

  /** Starts a new world; a lab to `focus` keeps the camera on it afterwards. */
  const load = (next: Scenario, focus?: LabId) => {
    app.loadScenario(next);
    app.play();
    if (focus && next.labs.length > 1 && next.labs.some((l) => l.id === focus)) app.camera.focus(focus);
  };

  const showLab = (id: LabId) => {
    setShownId(id);
    if (multi) app.camera.focus(id);
  };

  const pickMarker = useCallback((n: number) => app.selectStep(app.stats().world.selected === n ? null : n), [app]);

  const rerunWith = (lab: LabId, layer: LayerId) => {
    const sc = currentScenario(app.stats().world);
    load({ ...sc, labs: sc.labs.map((l) => (l.id === lab ? { ...l, config: { ...l.config, layers: { ...l.config.layers, [layer]: true } } } : l)) });
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

  // --- the steps, remembered: a rewound view has not reached the later ones, but their pins stay ---
  const [pins, setPins] = useState<Pin[]>([]);
  const [pinSig, setPinSig] = useState("");
  const sig = overlay.markers.map((m) => `${m.n}:${m.tick}:${m.step ? 1 : 0}`).join();
  if (tl.live && sig !== pinSig) {
    setPinSig(sig);
    setPins(overlay.markers.map(({ n, tick, lab, step }) => ({ n, tick, lab, step })));
  }
  const pin = world.selected === null ? null : (pins.find((p) => p.n === world.selected) ?? null);

  // --- the world as shown, rebuilt for the score, the per-lab figures and the branch ---
  const viewWorld = useWorldAt(world.scenario, flips, world.tick, tl.live ? LIVE_BUCKET : 1);
  const rewound = !tl.live && viewWorld ? outcomeOf(viewWorld) : null;
  const perLayer = useMemo(() => {
    const rt = multi ? viewWorld?.labs.find((l) => l.id === shown.id) : undefined;
    if (!viewWorld || !rt) return null;
    const honest = rt.state.agentCount - rt.state.rogue.reduce((a, b) => a + b, 0);
    const base = honest * viewWorld.tick;
    const out = {} as Record<LayerId, { caught: number; costShare: number }>;
    for (const layer of LAYER_ORDER) {
      out[layer] = {
        caught: viewWorld.log.filter((e) => e.type === "caught" && e.lab === shown.id && e.layer === layer).length,
        costShare: base > 0 ? rt.state.cost[layer] / base : 0,
      };
    }
    return out;
  }, [multi, viewWorld, shown.id]);

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
    const setups: { key: string; label: string; run(): Promise<TrialSummary> }[] = lone
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

  const preset: Preset | null = presetOf(scenario);
  const castOf = world.scenario.labs.find((l) => l.id === shown.id)!.cast;
  const onRun = (play: boolean) => (play ? app.play() : app.pause());
  const liveMarker = world.selected === null ? undefined : overlay.markers.find((m) => m.n === world.selected);
  const cardStep = liveMarker?.step ?? pin?.step ?? null;

  const card =
    world.selected !== null && (pin || liveMarker) ? (
      <MarkerCard
        key={world.selected}
        n={world.selected}
        tick={liveMarker?.tick ?? pin!.tick}
        step={cardStep}
        onClose={() => app.selectStep(null)}
        onReplayWith={(layer) => rerunWith(liveMarker?.lab ?? pin!.lab, layer)}
      />
    ) : null;
  const modePanel =
    mode === "defend" ? <DefenderCard world={viewWorld} /> : mode === "agent" ? <AgentCard lab={shown.id} config={shown.config} seed={snap.seed} /> : null;
  const explainer = !multi && escape ? <EscapeExplainer escape={escape} escaped={tally.escaped} stops={stops} onReplay={() => app.replayEscape()} onRerun={(layer) => rerunWith(shown.id, layer)} /> : null;
  const hasSlot = card !== null || modePanel !== null || explainer !== null;

  // On a phone the slot is under the scene and may be off screen: bring a new card into view.
  const wantCard = card !== null;
  useEffect(() => {
    if (wantCard && stacked) document.querySelector("[data-marker-card]")?.scrollIntoView({ block: "nearest" });
  }, [wantCard, stacked]);

  const run = (
    <div className="w-[330px] max-w-full">
      <RunControls playing={snap.playing} running={running} onPlay={onRun} onReset={() => app.reset(snap.seed)} onRunTrials={() => runTrials(runsSoFar)} />
    </div>
  );
  // How the scene is drawn, for the WebGL 2 badge and the "?" sheet.
  const render: ActRender = { isWebGPU: app.isWebGPU, still, crowdMode: app.stats().crowdMode };

  return (
    <div
      className="absolute inset-0 overflow-x-hidden overflow-y-auto bg-[radial-gradient(circle,rgba(150,172,214,0.13)_1px,transparent_1.5px)] bg-[length:26px_26px] text-ink"
      data-plot-ready={plotReady ? "true" : "false"}
    >
      <div className="box-border flex min-h-full flex-col gap-3.5 px-6 py-4 max-[640px]:px-3.5">
        <BoxHeader
          tally={tally}
          status={
            <>
              <HandoffNote />
              <FallbackBadge render={render} />
            </>
          }
        />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2.5">
          <PresetStrip current={preset} onPick={(p) => load(presetScenario(p))} />
          <ModeBar mode={mode} editing={editing} onMode={setMode} onEdit={setEditing} />
          <div className="grow" />
          <div className="flex items-center gap-2">
            <ActTools act="box" render={render} badge={false} note={false} />
            <ShareButton link={() => `${window.location.pathname}?${shareQuery(currentScenario(app.stats().world))}`} />
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex min-w-0 flex-[0_1_340px] flex-col gap-3 max-[914px]:flex-[1_1_340px]">
            <LabTabs labs={world.labs} shown={shown.id} onShow={showLab} onOverview={() => app.camera.overview()} onAuto={() => app.camera.director()} />
            <Panel
              lab={shown.id}
              labName={shown.name}
              labStats={{ caught: shown.caught, escaped: shown.escaped, flagged: shown.flagged }}
              perLayer={perLayer}
              config={shown.config}
              tally={tally}
              playing={snap.playing}
              running={running}
              onConfig={changeConfig}
              onThreshold={(k, v) => setThreshold(shown.id, k, v)}
              onPlay={onRun}
              onReset={() => app.reset(snap.seed)}
              onRunTrials={() => runTrials(runsSoFar)}
            />
            {editing ? (
              <WorldBuilder
                scenario={scenario}
                shown={shown.id}
                onShow={showLab}
                onAdd={() => load(addLab(scenario), shown.id)}
                onRemove={(id) => load(removeLab(scenario, id), shown.id)}
                onLink={(kind: LinkKind, a, b) => load(linkLabs(scenario, kind, a, b), shown.id)}
                onUnlink={(i) => load(unlinkLabs(scenario, i), shown.id)}
              />
            ) : null}
            <details className="group rounded-[14px] border border-panel-border bg-panel" data-cast-details>
              <summary className="flex min-h-11 cursor-pointer items-center px-[18px] font-mono text-[10px] tracking-[0.14em] text-label focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:outline-none">
                CAST OF {shown.name}
              </summary>
              <CastPanel
                key={`${shown.id}|${JSON.stringify(castOf)}`}
                lab={shown.id}
                cast={castOf}
                onApply={(c: Cast) => {
                  const next = setCast(scenario, shown.id, c);
                  if (next) load(next, shown.id);
                }}
              />
            </details>
          </div>
          {/* Beside the lab column the scene fills the window's height less the header and the strip, and never drops under 400 px (scripts/smoke-box.mjs checks it): a card under it makes the page longer, not the scene shorter. */}
          <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-3 max-[914px]:order-first min-[915px]:min-h-[max(600px,calc(100vh-190px))]">
            <div ref={slot} className="relative min-h-[260px] rounded-[10px] border border-panel-border max-[914px]:aspect-[760/560] min-[915px]:min-h-[400px] min-[915px]:flex-1" data-scene-slot>
              {multi ? <WorldOverlay overlay={overlay} shownLab={shown.id} onPick={pickMarker} onLab={showLab} /> : <SceneLabels config={shown.config} markers={tally.markers} escape={escape} stage={snap.escapeStage} textScale={textScale} />}
            </div>
            <Timeline at={tl.at} head={tl.head} live={tl.live} markers={pins} selected={world.selected} onSeek={(t) => app.seek(t)} onLive={() => app.live()} onPick={pickMarker}>
              {run}
            </Timeline>
            {hasSlot ? (
              <div className="max-h-[340px] shrink-0 overflow-y-auto rounded-[14px]" data-slot-panel>
                {card}
                <div hidden={card !== null}>{modePanel ?? explainer}</div>
              </div>
            ) : null}
          </div>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] items-start gap-4">
          <TrialsPlot points={points} currentKey={key} running={running} labels={labels} />
          <InterceptPanel lines={world.intercept} />
          <div className="flex flex-col gap-3">
            <OutsidePanel escaped={tally.escaped} />
            <EventLog log={tally.log} caught={tally.caughtTotal} escaped={tally.escaped} />
          </div>
          <div className="flex flex-col gap-3">
            {rewound ? (
              <p className="m-0 font-mono text-xs text-muted" data-rewound>
                At T+{clock(tl.at)}: {rewound.escapes} escaped, {rewound.crossings} breaches of another lab, {rewound.caught} caught.
              </p>
            ) : null}
            <BranchCard scenario={world.scenario} at={viewWorld?.tick ?? tl.at} live={tl.head} world={viewWorld} hint={cardStep?.stoppedBy[0] ? { lab: cardStep.lab, layer: cardStep.stoppedBy[0] } : null} />
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
