"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { runTrialsOffThread } from "@/lib/box/trials-client";
import { DEFAULT_CONFIG, type BoxConfig, type LayerId } from "@/lib/box/types";
import type { BoxApp } from "@/engine/box/app";
import { useMedia } from "@/components/inside/use-engine";
import { countsLine, nextAnnouncement, trialsLine, type Said } from "./announce";
import { EscapeExplainer } from "./escape-explainer";
import { EventLog } from "./event-log";
import { BoxHeader } from "./header";
import { OutsidePanel } from "./outside-panel";
import { Panel, RunControls } from "./panel";
import { addRun, settingsKey, type PlotPoint } from "./plot";
import { SceneLabels } from "./scene-labels";
import { TrialsPlot } from "./trials-plot";
import { useBoxSnapshot } from "./use-box";

const TRIALS = 100;

const withLayers = (c: BoxConfig, layers: Partial<BoxConfig["layers"]>): BoxConfig => ({ ...c, layers: { ...c.layers, ...layers } });

/** Earlier setups the escape shot plots beside its own, so the frame shows a frontier as the design does. */
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

/**
 * Everything over the Box canvas: the header, the controls, the scene slot the engine draws into
 * (with its SVG labels), the escape explainer, and the OUTSIDE, trials plot and event log column.
 * The settings live here and go to `app.configure`; trials run off the main thread.
 */
export function BoxHud({ app }: { app: BoxApp }) {
  const snap = useBoxSnapshot(app);
  const [config, setConfig] = useState<BoxConfig>(snap.config);
  const [points, setPoints] = useState<PlotPoint[]>([]);
  const [running, setRunning] = useState(false);
  const [plotReady, setPlotReady] = useState(!snap.shot);
  const [textScale, setTextScale] = useState(1);
  const [trialsSaid, setTrialsSaid] = useState("");
  /** Phone and tablet: the scene comes first, so the run row sits under it rather than at the panel's foot. */
  const stacked = useMedia("(max-width: 914px)");
  const slot = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);
  const { tally } = snap;

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

  const runTrials = useCallback(
    (c: BoxConfig, runs: number) => {
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      setRunning(true);
      runTrialsOffThread(c, TRIALS, runSeed(snap.seed, runs), ctrl.signal)
        .then((summary) => {
          setPoints((pts) => addRun(pts, c, summary));
          setTrialsSaid(trialsLine(summary));
          app.bus.emit("trials", summary);
        })
        .catch((err: unknown) => {
          if (!(err instanceof DOMException && err.name === "AbortError")) console.warn("Trials failed:", err);
        })
        .finally(() => {
          if (abort.current === ctrl) setRunning(false);
        });
    },
    [app, snap.seed],
  );

  // The escape shot plots six earlier setups and its own, each from a real run of 100 trials.
  useEffect(() => {
    if (!snap.shot) return;
    const ctrl = new AbortController();
    const setups = [...SHOT_PRIORS, snap.config];
    Promise.all(setups.map((c) => runTrialsOffThread(c, TRIALS, snap.seed, ctrl.signal).then((s) => [c, s] as const)))
      .then((results) => {
        setPoints(results.reduce<PlotPoint[]>((pts, [c, s]) => addRun(pts, c, s), []));
        setPlotReady(true);
      })
      .catch(() => {});
    return () => ctrl.abort();
    // Once, for the shot's own settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeConfig = (next: BoxConfig) => {
    setConfig(next);
    app.configure(next);
  };

  const rerunWith = (layer: LayerId) => {
    const next = withLayers(config, { [layer]: true });
    changeConfig(next);
    app.reset(snap.seed);
    app.play();
  };

  const key = settingsKey(config);
  const runsSoFar = points.find((p) => p.key === key)?.runs ?? 0;
  const escape = tally.lastEscape;

  return (
    <div className="absolute inset-0 overflow-x-hidden overflow-y-auto text-ink" data-plot-ready={plotReady ? "true" : "false"}>
      <div className="box-border flex min-h-full flex-col gap-4 px-6 py-5 min-[1158px]:h-full min-[1158px]:min-h-[720px]">
        <BoxHeader tally={tally} />
        <div className="flex min-h-0 flex-1 flex-wrap gap-4">
          <Panel
            config={config}
            tally={tally}
            playing={snap.playing}
            running={running}
            onConfig={changeConfig}
            onPlay={(play) => (play ? app.play() : app.pause())}
            onReset={() => app.reset(snap.seed)}
            onRunTrials={() => runTrials(config, runsSoFar)}
            withRun={!stacked}
          />
          <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-3 max-[914px]:order-first">
            <div ref={slot} className="relative min-h-[300px] max-[1157px]:aspect-[760/560] min-[1158px]:flex-auto" data-scene-slot>
              <SceneLabels config={config} markers={tally.markers} escape={escape} stage={snap.escapeStage} textScale={textScale} />
            </div>
            {stacked ? (
              <RunControls
                playing={snap.playing}
                running={running}
                onPlay={(play) => (play ? app.play() : app.pause())}
                onReset={() => app.reset(snap.seed)}
                onRunTrials={() => runTrials(config, runsSoFar)}
              />
            ) : null}
            {escape ? <EscapeExplainer escape={escape} escaped={tally.escaped} onReplay={() => app.replayEscape()} onRerun={rerunWith} /> : null}
          </div>
          <div className="flex max-w-full min-w-0 flex-[1_1_260px] flex-col gap-3">
            <OutsidePanel escaped={tally.escaped} />
            <TrialsPlot points={points} currentKey={key} running={running} />
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
