import { stoppingLayers } from "./replay";
import { runTrials } from "./trials";
import { runWorldTrials } from "./world-trials";
import { worldStoppingLayers } from "./world-replay";
import type { Flip, Scenario, StopTarget } from "./world-types";
import type { BoxConfig, LayerId, TrialSummary } from "./types";

/** The jobs the worker runs: a batch of trials or the replay that finds the layer an escape needed, for one box or a whole world. */
export type WorkerRequest =
  | { kind: "trials"; config: BoxConfig; n: number; seed: number }
  | { kind: "stops"; config: BoxConfig; seed: number; agentCount: number; agent: number; tick: number }
  | { kind: "worldTrials"; scenario: Scenario; n: number; seed: number }
  | { kind: "worldStops"; scenario: Scenario; flips: Flip[]; target: StopTarget; tick: number };

export type WorkerResponse = { ok: true; result: TrialSummary | LayerId[] } | { ok: false; error: string };

const scope = self as unknown as {
  onmessage: ((e: { data: WorkerRequest }) => void) | null;
  postMessage(message: WorkerResponse): void;
};

function run(req: WorkerRequest): TrialSummary | LayerId[] {
  switch (req.kind) {
    case "trials":
      return runTrials(req.config, req.n, req.seed);
    case "stops":
      return stoppingLayers(req.config, req.seed, req.agentCount, req.agent, req.tick);
    case "worldTrials":
      return runWorldTrials(req.scenario, req.n, req.seed);
    case "worldStops":
      return worldStoppingLayers(req.scenario, req.flips, req.target, req.tick);
  }
}

scope.onmessage = (e) => {
  try {
    scope.postMessage({ ok: true, result: run(e.data) });
  } catch (err) {
    scope.postMessage({ ok: false, error: err instanceof Error ? err.message : `${e.data.kind} failed` });
  }
};
