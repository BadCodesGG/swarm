import { runTrials } from "./trials";
import type { TrialsRequest, TrialsResponse } from "./trials.worker";
import type { BoxConfig, TrialSummary } from "./types";

/** Run the trials in a worker so the page keeps drawing. Aborting stops the worker. */
export function runTrialsOffThread(
  config: BoxConfig,
  n: number,
  seed: number,
  signal?: AbortSignal,
): Promise<TrialSummary> {
  if (typeof Worker === "undefined") return Promise.resolve(runTrials(config, n, seed));
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
    worker.onmessage = (e: MessageEvent<TrialsResponse>) => {
      finish();
      if (e.data.ok) resolve(e.data.summary);
      else reject(new Error(e.data.error));
    };
    worker.onerror = () => {
      finish();
      reject(new Error("trials worker failed"));
    };
    const req: TrialsRequest = { config, n, seed };
    worker.postMessage(req);
  });
}
