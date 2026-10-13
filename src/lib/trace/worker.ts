import { readSession } from "./session-read";
import type { PickedFile } from "./session-files";
import type { ChooseResult, ParseResult } from "./types";

/** Messages between `load.ts` and this worker. */
export interface StartMessage {
  type: "start";
  files: PickedFile[];
  /** The session to read when the files hold several. */
  session?: string;
}
export type WorkerMessage =
  | { type: "progress"; bytes: number; total: number }
  | { type: "done"; result: ParseResult | ChooseResult };

interface WorkerScope {
  onmessage: ((e: MessageEvent<StartMessage>) => void) | null;
  postMessage(m: WorkerMessage): void;
}

const scope = self as unknown as WorkerScope;

const READ_FAILED: ParseResult = {
  ok: false,
  error: "read-failed",
  report: { linesRead: 0, malformedLines: 0, overlongLines: 0, unknownTypes: 0, capsHit: [] },
};

// The visitor's session is read here, off the main thread, and never leaves the browser.
scope.onmessage = async (e) => {
  const { files, session } = e.data;
  const result = await readSession(files, {
    session,
    onProgress: (bytes, total) => scope.postMessage({ type: "progress", bytes, total }),
  }).catch((): ParseResult => READ_FAILED);
  // A result that cannot be cloned would otherwise reject here, where the page never hears of it.
  try {
    scope.postMessage({ type: "done", result });
  } catch {
    scope.postMessage({ type: "done", result: READ_FAILED });
  }
};
