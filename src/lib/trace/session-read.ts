import { cutText, createTraceBuilder, type TraceLimits } from "./build";
import { createLineSplitter } from "./lines";
import { countSubagents, selectSession, type PickedFile } from "./session-files";
import { TRACE_LIMITS, type ChooseResult, type ParseResult, type SessionCandidate } from "./types";

export type Progress = (bytesRead: number, totalBytes: number) => void;

export interface ReadOptions {
  /** The session to read when the files hold several top-level sessions. */
  session?: string;
  onProgress?: Progress;
  signal?: AbortSignal;
  limits?: Partial<TraceLimits>;
}

const PROMPT_LINE = 120;
const PROMPT_SCAN_LINES = 5_000;

function abortError(signal?: AbortSignal): unknown {
  return signal?.reason ?? new DOMException("Aborted", "AbortError");
}

/**
 * Streams one file through a UTF-8 decoder (which holds back half a character at a chunk edge) and
 * a line splitter. `onLine` returns false to stop reading early.
 */
async function streamLines(
  file: File,
  onLine: (line: string) => boolean | void,
  maxChars: number,
  onBytes?: (n: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  let stopped = false;
  const count = new TransformStream<BufferSource, BufferSource>({
    transform(chunk, controller) {
      onBytes?.(chunk.byteLength);
      controller.enqueue(chunk);
    },
  });
  const reader = file.stream().pipeThrough(count).pipeThrough(new TextDecoderStream()).getReader();
  const split = createLineSplitter((line) => {
    if (!stopped && onLine(line) === false) stopped = true;
  }, maxChars);
  try {
    while (!stopped) {
      if (signal?.aborted) throw abortError(signal);
      const { done, value } = await reader.read();
      if (done) break;
      split.push(value);
    }
    if (!stopped) split.end();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** The first line of the first human prompt, for the chooser. */
async function firstPrompt(file: File, signal?: AbortSignal): Promise<string> {
  let found = "";
  let n = 0;
  await streamLines(
    file,
    (line) => {
      if (++n > PROMPT_SCAN_LINES) return false;
      if (!line.includes('"human"')) return;
      try {
        const rec = JSON.parse(line) as { type?: unknown; origin?: { kind?: unknown }; message?: { content?: unknown } };
        if (rec.type !== "user" || rec.origin?.kind !== "human") return;
        const c = rec.message?.content;
        const text =
          typeof c === "string"
            ? c
            : Array.isArray(c)
              ? c.map((b: { type?: unknown; text?: unknown }) => (b?.type === "text" && typeof b.text === "string" ? b.text : "")).join("\n")
              : "";
        const first = text.split(/\r?\n/).map((s) => s.trim()).find((s) => s !== "") ?? "";
        found = cutText(first, PROMPT_LINE);
        return false;
      } catch {
        return;
      }
    },
    TRACE_LIMITS.lineBytes,
    undefined,
    signal,
  );
  return found;
}

/** Reads the picked files into a trace, or lists the sessions to choose from. */
export async function readSession(files: readonly PickedFile[], opts: ReadOptions = {}): Promise<ParseResult | ChooseResult> {
  const limits = { ...TRACE_LIMITS, ...opts.limits };
  const builder = createTraceBuilder(opts.limits);
  const selection = selectSession(files, opts.session);
  if (selection.kind === "none") return builder.finish();

  if (selection.kind === "choose") {
    const onlySession = false;
    const choose: SessionCandidate[] = [];
    for (const s of selection.sessions) {
      choose.push({
        path: s.path,
        size: s.file.size,
        firstPrompt: await firstPrompt(s.file, opts.signal).catch((e) => {
          if (opts.signal?.aborted) throw e;
          return "";
        }),
        subagentFiles: countSubagents(files, s, onlySession),
      });
    }
    return { ok: false, error: "several-session-files", report: builder.report(), choose };
  }

  const queue = [selection.session, ...selection.related].filter((f) => builder.accepts(f.path));
  const total = queue.reduce((n, f) => n + f.file.size, 0);
  let read = 0;
  let lastReport = 0;
  const bump = (n: number) => {
    read += n;
    const now = Date.now();
    if (now - lastReport >= 50) {
      lastReport = now;
      opts.onProgress?.(read, total);
    }
  };

  try {
    for (const f of queue) {
      if (opts.signal?.aborted) throw abortError(opts.signal);
      if (f.path.endsWith(".meta.json")) {
        builder.meta(f.path, await f.file.text());
        bump(f.file.size);
      } else {
        await streamLines(f.file, (line) => void builder.line(f.path, line), limits.lineBytes, bump, opts.signal);
      }
    }
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    return { ok: false, error: "read-failed", report: builder.report() };
  }
  opts.onProgress?.(total, total);
  return builder.finish();
}
