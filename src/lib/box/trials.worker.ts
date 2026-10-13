import { runTrials } from "./trials";
import type { BoxConfig, TrialSummary } from "./types";

export interface TrialsRequest {
  config: BoxConfig;
  n: number;
  seed: number;
}

export type TrialsResponse = { ok: true; summary: TrialSummary } | { ok: false; error: string };

const scope = self as unknown as {
  onmessage: ((e: { data: TrialsRequest }) => void) | null;
  postMessage(message: TrialsResponse): void;
};

scope.onmessage = (e) => {
  try {
    const { config, n, seed } = e.data;
    scope.postMessage({ ok: true, summary: runTrials(config, n, seed) });
  } catch (err) {
    scope.postMessage({ ok: false, error: err instanceof Error ? err.message : "trials failed" });
  }
};
