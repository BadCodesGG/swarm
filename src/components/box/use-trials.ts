"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { runTrialsOffThread, runWorldTrialsOffThread } from "@/lib/box/trials-client";
import { presetScenario } from "@/lib/box/presets";
import { DEFAULT_CONFIG, type BoxConfig, type TrialSummary } from "@/lib/box/types";
import { PRESET_IDS } from "@/lib/box/world-types";
import type { BoxApp, BoxSnapshot } from "@/engine/box/app";
import { trialsLine } from "./announce";
import { addRunKey, settingsKey, type PlotPoint } from "./plot";
import { currentScenario, setupKey, setupLabel } from "./playground";

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

/** A different trial seed for each repeat run of the same settings, so pooled runs add information. */
const runSeed = (seed: number, runs: number) => (seed + Math.imul(runs, 7919)) >>> 0;

export const isAbort = (err: unknown) => err instanceof DOMException && err.name === "AbortError";

/**
 * The trials plot's state: every setup run so far as a point, "Run 100 trials" for the current one
 * (off the main thread, pooled with earlier runs of the same setup), and on a `?shot=` frame the
 * earlier setups plotted beside it once, each from a real run.
 */
export function useTrials(app: BoxApp, snap: BoxSnapshot) {
  const [points, setPoints] = useState<PlotPoint[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const names = useRef<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [plotReady, setPlotReady] = useState(!snap.shot);
  const [said, setSaid] = useState("");
  const abort = useRef<AbortController | null>(null);

  const { world } = snap;
  const key = world.labs.length > 1 ? setupKey(currentScenario(world)) : settingsKey(world.labs[0].config);
  const runsSoFar = points.find((p) => p.key === key)?.runs ?? 0;

  useEffect(() => () => abort.current?.abort(), []);

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
          setSaid(trialsLine(summary));
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

  return { points, labels, running, plotReady, said, key, run: () => runTrials(runsSoFar) };
}
