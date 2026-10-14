"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { budgetFromParams } from "@/lib/box/share";
import { stoppingLayersOffThread } from "@/lib/box/trials-client";
import { outcomeOf } from "@/lib/box/branch";
import { forkFlips } from "@/lib/box/fork";
import { PRESET_LABEL, presetScenario } from "@/lib/box/presets";
import { LAYER_ORDER, type BoxConfig, type LayerId } from "@/lib/box/types";
import type { Cast, Flip, LabId, LinkKind, Preset, Scenario } from "@/lib/box/world-types";
import type { BoxApp } from "@/engine/box/app";
import type { EscapeRecord } from "@/engine/box/tally";
import { ActTools, FallbackBadge, HandoffNote, type ActRender } from "@/components/site/act-tools";
import { DefendCard } from "./defend-card";
import { DefendLayers } from "./defend-layers";
import { DefencesRail } from "./defences-rail";
import { InterceptPanel } from "./debrief";
import { EscapeExplainer } from "./escape-explainer";
import { EventLog } from "./event-log";
import { BoxHeader, CountsStatus } from "./header";
import { CastPanel, LabTabs, WorldBuilder } from "./lab-panels";
import { buildLanes } from "./lanes";
import { OutsidePanel } from "./outside-panel";
import { Panel } from "./panel";
import { PhoneTabs, type PanelTab } from "./phone-tabs";
import { settingsKey } from "./plot";
import { AgentCard } from "./play-panels";
import { addLab, currentScenario, linkLabs, presetOf, removeLab, setCast, shareQuery, stepAfter, unlinkLabs } from "./playground";
import { BranchedPill, ResultsView } from "./results-view";
import { ScenarioMenu } from "./scenario-menu";
import { RingLegend, SceneLabels } from "./scene-labels";
import { Sheet } from "./sheet";
import { StepCard } from "./step-card";
import { StoryRail } from "./story-rail";
import { Timeline, type Pin } from "./timeline";
import { ModeSwitch, ShareButton, type Mode } from "./toolbar";
import { useBoxOverlay, useBoxSnapshot } from "./use-box";
import { usePhone } from "./use-phone";
import { isResultsQuery, withResultsView } from "./view";
import { isAbort, useTrials } from "./use-trials";
import { useWorldAt } from "./use-world-at";
import { WorldOverlay } from "./world-overlay";

/** One escape, as the replay sees it: the same seed, crowd, settings, agent and tick give the same answer. */
const escapeKey = (seed: number, agents: number, e: EscapeRecord) => `${seed}|${agents}|${settingsKey(e.config)}|${e.agent}|${e.tick}`;

/** Ticks of the live run between two rebuilds of the world the score, the per-lab figures and the branch read. */
const LIVE_BUCKET = 10;
/** Ms between two threshold changes sent to the engine while a slider is dragged (each replays the run). */
const THRESHOLD_GAP = 250;

type ThresholdKey = "monitorThreshold" | "auditBudget";

/**
 * Everything over the Box canvas, as a layout shell. On a desktop the first screen is the top bar
 * and three columns: the story (or the mode's own card) on the left, the scene with the timeline
 * under it in the centre, the defences on the right; the results sit below. The engine draws into the
 * scene slot's rect (`app.setFrame`). At 914 px and under (a phone, a tablet held upright) the scene
 * comes first, then the timeline and the current step; the defences and the feed open as bottom sheets
 * from a tab bar that also leads to the results. Trials run off the main thread.
 */
export function BoxHud({ app, still = false }: { app: BoxApp; still?: boolean }) {
  const [snap, refresh] = useBoxSnapshot(app);
  const overlay = useBoxOverlay(app);
  const { world, tally } = snap;
  const multi = world.labs.length > 1;
  const tl = overlay.timeline;
  const [shownId, setShownId] = useState<LabId>(world.labs[0].id);
  const shown = world.labs.find((l) => l.id === shownId) ?? world.labs[0];
  const [mode, setMode] = useState<Mode>("watch");
  const [editing, setEditing] = useState(false);
  const phone = usePhone();
  // The phone's bottom sheet, if one is up.
  const [sheet, setSheet] = useState<"defences" | "feed" | null>(null);
  // The Defend budget: from the link that opened the page, then the card's slider.
  const [budget, setBudget] = useState(() => budgetFromParams(new URLSearchParams(window.location.search)));
  const [textScale, setTextScale] = useState(1);
  const slot = useRef<HTMLDivElement>(null);
  // The Results view is a page over the Watch layout (`?view=results`); `pushed` says Back-to-the-map can pop the entry it pushed.
  const [view, setView] = useState<"watch" | "results">(() => (typeof window !== "undefined" && isResultsQuery(window.location.search) ? "results" : "watch"));
  const pushed = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  // The run this one was forked from, for "Back to the original".
  const [branched, setBranched] = useState<{ at: number; original: { scenario: Scenario; flips: Flip[]; head: number } } | null>(null);
  const scenario = useMemo(() => currentScenario(world), [world]);
  const trials = useTrials(app, snap);

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
      const r = el?.getBoundingClientRect();
      // Hidden (the Results view is up): hand the engine nothing, so it never gets a zero-size rect; the last real one stays until the slot is back.
      if (r && r.width > 0 && r.height > 0) {
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

  useEffect(() => {
    const onPop = () => setView(isResultsQuery(window.location.search) ? "results" : "watch");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // While Results shows, the run holds still (so the branch card's tick and comparison stay put); it carries on when the map returns.
  useEffect(() => {
    if (view !== "results") return;
    root.current?.scrollTo({ top: 0, behavior: "instant" });
    const was = app.stats().playing;
    if (was) app.pause();
    return () => {
      if (was) app.play();
    };
  }, [view, app]);

  const openResults = useCallback(() => {
    if (!isResultsQuery(window.location.search)) {
      window.history.pushState(null, "", withResultsView(window.location.href, true));
      pushed.current = true;
    }
    setView("results");
  }, []);
  const closeResults = useCallback(() => {
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
    } else {
      window.history.replaceState(null, "", withResultsView(window.location.href, false));
      setView("watch");
    }
  }, []);

  const thr = useRef<{ timer: number | null; pending: [LabId[], ThresholdKey, number] | null }>({ timer: null, pending: null });
  useEffect(() => {
    const t = thr.current;
    return () => {
      if (t.timer !== null) window.clearTimeout(t.timer);
    };
  }, []);

  // --- the world: layers, thresholds, presets, edits ---

  const changeConfig = (next: BoxConfig) => {
    for (const layer of LAYER_ORDER) if (shown.config.layers[layer] !== next.layers[layer]) app.setLayer(shown.id, layer, next.layers[layer]);
    refresh();
  };

  /** A slider drag asks the engine for a replay each time: at most one every THRESHOLD_GAP ms, the last value always lands. */
  function setThreshold(labs: LabId[], key: ThresholdKey, value: number) {
    const t = thr.current;
    if (t.timer !== null) {
      t.pending = [labs, key, value];
      return;
    }
    for (const lab of labs) app.setThreshold(lab, key, value);
    refresh();
    t.timer = window.setTimeout(() => {
      t.timer = null;
      const p = t.pending;
      t.pending = null;
      if (p) setThreshold(...p);
    }, THRESHOLD_GAP);
  }

  /** Defend mode's switches and sliders: the shown lab, or every lab when "Change all labs together" is on. */
  const labsFor = (all: boolean) => (all ? world.labs.map((l) => l.id) : [shown.id]);
  const defendLayer = (layer: LayerId, on: boolean, all: boolean) => {
    for (const lab of labsFor(all)) app.setLayer(lab, layer, on);
    refresh();
  };

  /** Starts a new world; a lab to `focus` keeps the camera on it afterwards. */
  const load = (next: Scenario, focus?: LabId) => {
    setBranched(null);
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

  // --- the steps, remembered: a rewound view has not reached the later ones, but their pins stay ---
  const [pins, setPins] = useState<Pin[]>([]);
  const [pinSig, setPinSig] = useState("");
  const sig = overlay.markers.map((m) => `${m.n}:${m.tick}:${m.step ? 1 : 0}`).join();
  if (tl.live && sig !== pinSig) {
    setPinSig(sig);
    setPins(overlay.markers.map(({ n, tick, lab, kind, step }) => ({ n, tick, lab, kind, step })));
  }
  const pin = world.selected === null ? null : (pins.find((p) => p.n === world.selected) ?? null);

  /** Previous or next step, among those the map has shown. */
  const walk = useCallback(
    (dir: 1 | -1) => {
      const shownNs = app
        .overlay()
        .markers.filter((m) => m.shown)
        .map((m) => m.n);
      const n = stepAfter(shownNs, app.stats().world.selected, dir);
      if (n !== null) app.selectStep(n);
    },
    [app],
  );

  // The keys 1 to 9 open a step, [ and ] the previous or next, and Escape closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable='true']")) return;
      if (e.key === "Escape") {
        if (app.stats().world.selected !== null) app.selectStep(null);
        return;
      }
      if (e.key === "[" || e.key === "]") {
        walk(e.key === "]" ? 1 : -1);
        return;
      }
      if (!/^[1-9]$/.test(e.key)) return;
      const n = Number(e.key);
      if (app.overlay().markers.some((m) => m.n === n && m.shown)) app.selectStep(n);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [app, walk]);

  // --- the world as shown, rebuilt for the score, the per-lab figures, the lanes and the branch ---
  const viewWorld = useWorldAt(world.scenario, flips, world.tick, tl.live ? LIVE_BUCKET : 1);
  const rewound = !tl.live && viewWorld ? outcomeOf(viewWorld) : null;
  const perLayer = useMemo(() => {
    const rt = multi ? viewWorld?.labs.find((l) => l.id === shown.id) : undefined;
    if (!viewWorld || !rt) return null;
    const honest = rt.state.agentCount - rt.state.rogue.reduce((a, b) => a + b, 0);
    const base = honest * viewWorld.tick;
    const out = {} as Record<LayerId, { caught: number; costShare: number }>;
    for (const layer of LAYER_ORDER) {
      out[layer] = { caught: viewWorld.log.filter((e) => e.type === "caught" && e.lab === shown.id && e.layer === layer).length, costShare: base > 0 ? rt.state.cost[layer] / base : 0 };
    }
    return out;
  }, [multi, viewWorld, shown.id]);
  const labIds = world.labs.map((l) => l.id).join();
  const lanes = useMemo(() => buildLanes(labIds.split(",") as LabId[], viewWorld?.log ?? [], Math.max(tl.head, 1)), [labIds, viewWorld, tl.head]);

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
  const liveMarker = world.selected === null ? undefined : overlay.markers.find((m) => m.n === world.selected);
  const cardStep = liveMarker?.step ?? pin?.step ?? null;
  // How the scene is drawn, for the WebGL 2 badge and the "?" sheet.
  const render: ActRender = { isWebGPU: app.isWebGPU, still, crowdMode: app.stats().crowdMode };

  /** "Branch from here": the Results view at the scrubbed tick, with the branch card ready. */
  const openBranch = () => {
    openResults();
    window.setTimeout(() => document.querySelector<HTMLElement>("[data-branch-card] select")?.focus({ preventScroll: true }), 60);
  };

  /** "Watch the branch": fork the live run at `at` with the layer on; the map shows where it branched and the way back. */
  const watchBranch = (lab: LabId, layer: LayerId, at: number) => {
    const base = app.stats().world.scenario;
    const original = branched?.original ?? { scenario: base, flips: app.flips(), head: tl.head };
    app.loadScenario(base, { flips: forkFlips(app.flips(), at, { lab, layer, on: true }), tick: at });
    app.play();
    // The map was zoomed on a lab when the page left it: frame every lab again.
    if (base.labs.length > 1) app.camera.overview();
    setBranched({ at, original });
    closeResults();
  };
  const backToOriginal = () => {
    if (!branched) return;
    const { scenario: sc, flips: fl, head } = branched.original;
    app.loadScenario(sc, { flips: fl, tick: head });
    app.play();
    if (sc.labs.length > 1) app.camera.overview();
    setBranched(null);
  };
  /** "Keep this change": the layer goes on now, in the live run. */
  const keepChange = (lab: LabId, layer: LayerId) => {
    app.setLayer(lab, layer, true);
    refresh();
    closeResults();
  };

  // --- the regions ---

  const primary =
    mode === "defend"
      ? { label: "Defend", node: <DefendCard world={viewWorld} flips={flips} budget={budget} onBudget={setBudget} /> }
      : mode === "agent"
        ? { label: "Play", node: <AgentCard lab={shown.id} config={shown.config} seed={snap.seed} /> }
        : null;

  const feed = (
    <>
      <EventLog log={tally.log} caught={tally.caughtTotal} escaped={tally.escaped} />
      <InterceptPanel lines={world.intercept} />
      <OutsidePanel escaped={tally.escaped} />
    </>
  );

  const lead = !multi && escape ? <EscapeExplainer escape={escape} escaped={tally.escaped} stops={stops} onReplay={() => app.replayEscape()} onRerun={(layer) => rerunWith(shown.id, layer)} /> : null;

  const story = (
    <StoryRail
      presetName={preset ? PRESET_LABEL[preset] : null}
      labs={world.labs}
      pins={pins}
      selected={world.selected}
      onPick={pickMarker}
      onClose={() => app.selectStep(null)}
      onStep={walk}
      onReplayWith={rerunWith}
      lead={lead}
      primary={primary}
      feed={feed}
    />
  );

  const defences = (
    <DefencesRail
      tabs={<LabTabs labs={world.labs} shown={shown.id} onShow={showLab} onOverview={() => app.camera.overview()} onAuto={() => app.camera.director()} />}
      builder={
        editing ? (
          <WorldBuilder
            scenario={scenario}
            shown={shown.id}
            onShow={showLab}
            onAdd={() => load(addLab(scenario), shown.id)}
            onRemove={(id) => load(removeLab(scenario, id), shown.id)}
            onLink={(kind: LinkKind, a, b) => load(linkLabs(scenario, kind, a, b), shown.id)}
            onUnlink={(i) => load(unlinkLabs(scenario, i), shown.id)}
          />
        ) : null
      }
      castOf={shown.name}
      onOpenResults={() => {
        setSheet(null);
        openResults();
      }}
      sheet={phone}
      lead={phone && mode === "defend" ? <DefendCard sheet world={viewWorld} flips={flips} budget={budget} onBudget={setBudget} /> : null}
      cast={
        <CastPanel
          key={`${shown.id}|${JSON.stringify(castOf)}`}
          lab={shown.id}
          cast={castOf}
          onApply={(c: Cast) => {
            const next = setCast(scenario, shown.id, c);
            if (next) load(next, shown.id);
          }}
        />
      }
    >
      {mode === "defend" ? (
        <DefendLayers
          lab={shown.id}
          labName={shown.name}
          labCount={world.labs.length}
          labStats={{ flagged: shown.flagged }}
          perLayer={perLayer}
          config={shown.config}
          tally={tally}
          budget={budget}
          onLayer={defendLayer}
          onThreshold={(k, v, all) => setThreshold(labsFor(all), k, v)}
        />
      ) : (
        <Panel
          lab={shown.id}
          labName={shown.name}
          labStats={{ caught: shown.caught, escaped: shown.escaped, flagged: shown.flagged }}
          perLayer={perLayer}
          config={shown.config}
          tally={tally}
          onConfig={changeConfig}
          onThreshold={(k, v) => setThreshold([shown.id], k, v)}
        />
      )}
    </DefencesRail>
  );

  // The phone's step card: the open step, else the first, and previous and next from there.
  const steps = [...pins].sort((a, b) => a.n - b.n);
  const currentN = world.selected ?? steps[0]?.n ?? null;
  const currentPin = steps.find((p) => p.n === currentN) ?? null;
  const walkCard = (dir: 1 | -1) => {
    const ns = app
      .overlay()
      .markers.filter((m) => m.shown)
      .map((m) => m.n);
    const n = stepAfter(ns, currentN, dir);
    if (n !== null) app.selectStep(n);
  };
  const activeTab: PanelTab = sheet ?? (view === "results" ? "results" : "story");
  const onTab = (tab: PanelTab) => {
    if (tab === "defences" || tab === "feed") setSheet(tab);
    else if (tab === "results") openResults();
    else if (view === "results") closeResults();
  };
  const tabEl = (tab: PanelTab) => () => document.querySelector<HTMLElement>(`[data-phone-tab="${tab}"]`);

  const centre = (
    // The scene fills the column less the timeline, and never drops under 400 px (scripts/smoke-box.mjs checks it).
    <div className="flex min-h-0 min-w-0 flex-col gap-3 min-[915px]:max-[1099px]:min-h-[max(600px,calc(100vh-120px))]">
      <div ref={slot} className="relative min-h-[260px] rounded-[14px] border border-panel-border max-[914px]:aspect-[760/560] min-[915px]:min-h-[400px] min-[915px]:flex-1" data-scene-slot>
        {multi ? (
          <WorldOverlay overlay={overlay} shownLab={shown.id} onPick={pickMarker} onLab={showLab} />
        ) : (
          <SceneLabels config={shown.config} markers={tally.markers} escape={escape} stage={snap.escapeStage} textScale={textScale} />
        )}
        <RingLegend />
        {branched ? <BranchedPill at={branched.at} onBack={backToOriginal} /> : null}
      </div>
      <Timeline
        at={tl.at}
        head={tl.head}
        live={tl.live}
        markers={pins}
        selected={world.selected}
        lanes={lanes}
        playing={snap.playing}
        running={trials.running}
        onSeek={(t) => app.seek(t)}
        onLive={() => app.live()}
        onPick={pickMarker}
        onPlay={(play) => (play ? app.play() : app.pause())}
        onReset={() => {
          setBranched(null);
          app.reset(snap.seed);
        }}
        onRunTrials={trials.run}
        onBranch={openBranch}
        compact={phone}
      />
    </div>
  );

  return (
    <div
      className={`absolute inset-0 overflow-x-hidden overflow-y-auto max-[914px]:pb-[calc(4.5rem+env(safe-area-inset-bottom))] ${sheet ? "max-[914px]:overflow-y-hidden" : ""} bg-[radial-gradient(circle,rgba(150,172,214,0.13)_1px,transparent_1.5px)] bg-[length:26px_26px] text-ink`}
      data-plot-ready={trials.plotReady ? "true" : "false"}
      ref={root}
    >
      {/* The first screen: on a wide desktop exactly the window's height (never under 700 px), the results below it. */}
      <div className={view === "results" ? "hidden" : "contents"}>
        <div className="flex flex-col min-[1100px]:h-full min-[1100px]:min-h-[700px]">
          <BoxHeader
            tally={tally}
            status={
              <>
                <HandoffNote />
                <FallbackBadge render={render} />
              </>
            }
            controls={
              <>
                <ScenarioMenu current={preset} editing={editing} onPick={(p) => load(presetScenario(p))} onEdit={setEditing} />
                <ModeSwitch mode={mode} onMode={setMode} />
              </>
            }
            tools={
              <>
                <ActTools act="box" render={render} badge={false} note={false} />
                <ShareButton link={() => `${window.location.pathname}?${shareQuery(currentScenario(app.stats().world), budget)}`} />
              </>
            }
          />
          <div className="grid flex-1 grid-cols-1 gap-4 px-6 pt-4 pb-5 max-[914px]:gap-3 max-[914px]:px-4 max-[914px]:pt-3 min-[915px]:grid-cols-[minmax(250px,300px)_minmax(0,1fr)] min-[1100px]:min-h-0 min-[1100px]:grid-cols-[minmax(260px,320px)_minmax(0,1fr)_minmax(300px,360px)] min-[1100px]:grid-rows-[minmax(0,1fr)]">
            {phone ? null : story}
            {centre}
            {phone ? (
              mode === "agent" && primary ? (
                primary.node
              ) : (
                <StepCard steps={steps} current={currentPin} open={world.selected !== null} lead={lead} onStep={walkCard} onReplayWith={rerunWith} />
              )
            ) : (
              <div className="flex min-h-0 flex-col min-[915px]:max-[1099px]:col-span-2">{defences}</div>
            )}
          </div>
        </div>
      </div>
      <ResultsView
        open={view === "results"}
        points={trials.points}
        currentKey={trials.key}
        running={trials.running}
        labels={trials.labels}
        scenario={scenario}
        at={viewWorld?.tick ?? tl.at}
        head={tl.head}
        world={viewWorld}
        hint={cardStep?.stoppedBy[0] ? { lab: cardStep.lab, layer: cardStep.stoppedBy[0] } : null}
        rewound={rewound ? { at: tl.at, outcome: rewound } : null}
        onBack={closeResults}
        onRun={trials.run}
        onWatch={watchBranch}
        onKeep={keepChange}
      />
      {phone ? (
        <>
          <PhoneTabs active={activeTab} onTab={onTab} />
          {sheet === "defences" ? (
            <Sheet title="Defences" hook="defences" onClose={() => setSheet(null)} returnFocus={tabEl("defences")}>
              {defences}
            </Sheet>
          ) : null}
          {sheet === "feed" ? (
            <Sheet title="Feed" hook="feed" onClose={() => setSheet(null)} returnFocus={tabEl("feed")}>
              {feed}
            </Sheet>
          ) : null}
        </>
      ) : null}
      <CountsStatus caught={tally.caughtTotal} escaped={tally.escaped} />
      <p role="status" className="sr-only" data-status="trials">
        {trials.said}
      </p>
    </div>
  );
}
