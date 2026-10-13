import { stoppingLayers } from "./replay";
import { runTrials } from "./trials";
import type { WorkerRequest, WorkerResponse } from "./trials.worker";
import type { BoxConfig, LayerId, TrialSummary } from "./types";

/** One job in the trials worker so the page keeps drawing; inline where there is no Worker. Aborting stops the worker. */
function offThread<T>(req: WorkerRequest, inline: () => T, signal?: AbortSignal): Promise<T> {
  if (typeof Worker === "undefined") return Promise.resolve(inline());
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("aborted", "AbortError"));
    const worker = new Worker(new URL("./trials.worker.ts", import.meta.url), { type: "module" });
    const finish = () => {
      signal?.removeEventListener("abort", onAbort);
      worker.terminate();
    };
    const onAbort = () => {
      finish();
      reject(new DOMException("aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort);
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      finish();
      if (e.data.ok) resolve(e.data.result as T);
      else reject(new Error(e.data.error));
    };
    worker.onerror = () => {
      finish();
      reject(new Error(`${req.kind} worker failed`));
    };
    worker.postMessage(req);
  });
}

export function runTrialsOffThread(config: BoxConfig, n: number, seed: number, signal?: AbortSignal): Promise<TrialSummary> {
  return offThread({ kind: "trials", config, n, seed }, () => runTrials(config, n, seed), signal);
}

/** The off layers that, turned on, would have kept `agent` from escaping by `tick` (`lib/box/replay`), replayed off the frame. */
export function stoppingLayersOffThread(config: BoxConfig, seed: number, agentCount: number, agent: number, tick: number, signal?: AbortSignal): Promise<LayerId[]> {
  return offThread({ kind: "stops", config, seed, agentCount, agent, tick }, () => stoppingLayers(config, seed, agentCount, agent, tick), signal);
}
