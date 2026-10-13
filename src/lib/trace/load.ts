import type { PickedFile } from "./session-files";
import type { ChooseResult, ParseReport, ParseResult } from "./types";
import type { StartMessage, WorkerMessage } from "./worker";

/** The part of `Worker` this module uses, so a test can stand in for it. */
export interface WorkerLike {
  onmessage: ((e: MessageEvent<WorkerMessage>) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onmessageerror: ((e: unknown) => void) | null;
  postMessage(m: StartMessage): void;
  terminate(): void;
}

export interface LoadOptions {
  /** The session to read when the files hold several; take it from a `ChooseResult`. */
  session?: string;
  createWorker?: () => WorkerLike;
}

const EMPTY_REPORT: ParseReport = { linesRead: 0, malformedLines: 0, overlongLines: 0, unknownTypes: 0, capsHit: [] };
const readFailed = (): ParseResult => ({ ok: false, error: "read-failed", report: { ...EMPTY_REPORT } });

function defaultWorker(): WorkerLike {
  return new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike;
}

/**
 * Parses the picked files in a Web Worker. Resolves with the trace, or with a failed result:
 * `read-failed` when the worker crashes, and (for several top-level sessions) a `ChooseResult` listing
 * the candidates; call again with `options.session` set to the chosen path. Aborting rejects with the
 * signal's reason and stops the worker.
 */
export function loadSession(
  files: PickedFile[],
  onProgress: (bytesRead: number, totalBytes: number) => void,
  signal?: AbortSignal,
  options: LoadOptions = {},
): Promise<ParseResult | ChooseResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    let worker: WorkerLike;
    try {
      worker = (options.createWorker ?? defaultWorker)();
    } catch {
      resolve(readFailed());
      return;
    }
    const settle = (fn: () => void) => {
      signal?.removeEventListener("abort", onAbort);
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      worker.terminate();
      fn();
    };
    function onAbort() {
      settle(() => reject(signal?.reason ?? new DOMException("Aborted", "AbortError")));
    }
    signal?.addEventListener("abort", onAbort, { once: true });

    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === "progress") onProgress(m.bytes, m.total);
      else settle(() => resolve(m.result));
    };
    worker.onerror = () => settle(() => resolve(readFailed()));
    worker.onmessageerror = () => settle(() => resolve(readFailed()));
    try {
      worker.postMessage({ type: "start", files, session: options.session });
    } catch {
      settle(() => resolve(readFailed()));
    }
  });
}
