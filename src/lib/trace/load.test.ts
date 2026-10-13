import { afterEach, describe, expect, it, vi } from "vitest";
import { loadSession, type WorkerLike } from "./load";
import type { StartMessage, WorkerMessage } from "./worker";
import type { PickedFile } from "./session-files";
import type { ParseResult } from "./types";

const files: PickedFile[] = [{ path: "s.jsonl", file: new File(["x"], "s.jsonl") }];
const failed = {
  ok: false,
  error: "no-conversation",
  report: { linesRead: 1, malformedLines: 0, overlongLines: 0, unknownTypes: 0, capsHit: [] },
} satisfies ParseResult;

function fakeWorker() {
  const w = {
    onmessage: null as WorkerLike["onmessage"],
    onerror: null as WorkerLike["onerror"],
    onmessageerror: null as WorkerLike["onmessageerror"],
    started: [] as StartMessage[],
    terminated: 0,
    postMessage(m: StartMessage) {
      this.started.push(m);
    },
    terminate() {
      this.terminated++;
    },
    emit(m: WorkerMessage) {
      this.onmessage?.({ data: m } as MessageEvent<WorkerMessage>);
    },
  };
  return w;
}

afterEach(() => vi.unstubAllGlobals());

describe("loadSession", () => {
  it("posts the files, forwards progress and resolves with the worker's result, then stops the worker", async () => {
    const w = fakeWorker();
    const progress: [number, number][] = [];
    const p = loadSession(files, (a, b) => progress.push([a, b]), undefined, { createWorker: () => w, session: "s.jsonl" });
    expect(w.started).toEqual([{ type: "start", files, session: "s.jsonl" }]);
    w.emit({ type: "progress", bytes: 5, total: 10 });
    w.emit({ type: "done", result: failed });
    await expect(p).resolves.toEqual(failed);
    expect(progress).toEqual([[5, 10]]);
    expect(w.terminated).toBe(1);
  });

  it("maps a worker crash to read-failed", async () => {
    const w = fakeWorker();
    const p = loadSession(files, () => undefined, undefined, { createWorker: () => w });
    w.onerror?.(new Event("error"));
    await expect(p).resolves.toMatchObject({ ok: false, error: "read-failed" });
    expect(w.terminated).toBe(1);
  });

  it("maps an unclonable message, a worker that cannot start and a failed post to read-failed", async () => {
    const w = fakeWorker();
    const p = loadSession(files, () => undefined, undefined, { createWorker: () => w });
    w.onmessageerror?.(new Event("messageerror"));
    await expect(p).resolves.toMatchObject({ error: "read-failed" });

    await expect(
      loadSession(files, () => undefined, undefined, {
        createWorker: () => {
          throw new Error("no workers");
        },
      }),
    ).resolves.toMatchObject({ error: "read-failed" });

    const bad = fakeWorker();
    bad.postMessage = () => {
      throw new Error("DataCloneError");
    };
    await expect(loadSession(files, () => undefined, undefined, { createWorker: () => bad })).resolves.toMatchObject({ error: "read-failed" });
    expect(bad.terminated).toBe(1);
  });

  it("rejects and stops the worker when aborted, and ignores what it says afterwards", async () => {
    const w = fakeWorker();
    const ac = new AbortController();
    const p = loadSession(files, () => undefined, ac.signal, { createWorker: () => w });
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(w.terminated).toBe(1);
    expect(w.onmessage).toBeNull();
  });

  it("rejects at once, without starting a worker, when the signal is already aborted", async () => {
    const create = vi.fn(fakeWorker);
    const ac = new AbortController();
    ac.abort();
    await expect(loadSession(files, () => undefined, ac.signal, { createWorker: create })).rejects.toMatchObject({ name: "AbortError" });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("worker.ts", () => {
  it("answers a start message with a done message carrying the result", async () => {
    const posted: WorkerMessage[] = [];
    const scope: { onmessage: ((e: { data: StartMessage }) => Promise<void>) | null; postMessage: (m: WorkerMessage) => void } = {
      onmessage: null,
      postMessage: (m) => void posted.push(m),
    };
    vi.stubGlobal("self", scope);
    await import("./worker");
    expect(scope.onmessage).toBeTypeOf("function");
    await scope.onmessage?.({ data: { type: "start", files: [{ path: "notes.txt", file: new File(["hi"], "notes.txt") }] } });
    expect(posted[posted.length - 1]).toMatchObject({ type: "done", result: { ok: false, error: "no-session-file" } });
  });
});
