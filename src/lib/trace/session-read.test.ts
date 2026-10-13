import { describe, expect, it } from "vitest";
import { createTraceBuilder } from "./build";
import { feed, fixtureFiles } from "./__fixtures__/read";
import { readSession } from "./session-read";
import type { PickedFile } from "./session-files";
import { validateTrace } from "./validate";

/** A File whose stream hands out `size`-byte chunks, so line and character boundaries fall anywhere. */
function chunked(text: string, name: string, size: number, onChunk?: (n: number) => void): File {
  const bytes = new TextEncoder().encode(text);
  const file = new File([bytes], name);
  file.stream = () => {
    let at = 0;
    let n = 0;
    return new ReadableStream<Uint8Array<ArrayBuffer>>({
      pull(c) {
        if (at >= bytes.length) return c.close();
        onChunk?.(++n);
        c.enqueue(bytes.slice(at, at + size));
        at += size;
      },
    });
  };
  return file;
}

const picked = (files: { path: string; text: string }[], size?: number): PickedFile[] =>
  files.map((f) => ({ path: f.path, file: size ? chunked(f.text, f.path, size) : new File([f.text], f.path) }));

const T0 = Date.UTC(2000, 0, 1);
const prompt = (t: number, text: string) =>
  JSON.stringify({ type: "user", timestamp: new Date(T0 + t * 1000).toISOString(), origin: { kind: "human" }, message: { role: "user", content: text } });

function expected() {
  const b = createTraceBuilder();
  feed(b, fixtureFiles());
  return b.finish();
}

describe("readSession", () => {
  it("streams the fixture through the decoder and splitter to the same trace the line sink builds", async () => {
    const want = expected();
    for (const size of [undefined, 997, 4096]) {
      const got = await readSession(picked(fixtureFiles(), size));
      expect(got).toEqual(want);
    }
    expect(want.ok && validateTrace(want.trace)).toEqual([]);
  });

  it("reads multi-byte characters and CRLF endings split between 3-byte chunks", async () => {
    const text = [prompt(0, "héllo 𝄞 日本語"), prompt(1, "second")].join("\r\n") + "\r\n";
    const r = await readSession(picked([{ path: "s.jsonl", text }], 3));
    expect(r.ok && r.trace.events.map((e) => e.excerpt)).toEqual(["héllo 𝄞 日本語", "second"]);
    expect(r.report.malformedLines).toBe(0);
  });

  it("reports byte progress ending at the total", async () => {
    const seen: [number, number][] = [];
    const files = picked(fixtureFiles(), 50_000);
    await readSession(files, { onProgress: (a, b) => seen.push([a, b]) });
    const total = files.reduce((n, f) => n + f.file.size, 0);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]).toEqual([total, total]);
    for (let i = 1; i < seen.length; i++) expect(seen[i][0]).toBeGreaterThanOrEqual(seen[i - 1][0]);
  });

  it("stops and rejects when the signal aborts, also in the middle of a file", async () => {
    const pre = new AbortController();
    pre.abort();
    await expect(readSession(picked(fixtureFiles()), { signal: pre.signal })).rejects.toMatchObject({ name: "AbortError" });

    const mid = new AbortController();
    let chunks = 0;
    const file = chunked(prompt(0, "x").repeat(2000), "s.jsonl", 100, (n) => {
      chunks = n;
      if (n === 5) mid.abort();
    });
    await expect(readSession([{ path: "s.jsonl", file }], { signal: mid.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(chunks).toBeLessThan(10);
  });

  it("maps an unreadable file to read-failed, keeping the counts so far", async () => {
    const bad = new File(["x"], "s.jsonl");
    bad.stream = () =>
      new ReadableStream<Uint8Array<ArrayBuffer>>({
        start(c) {
          c.enqueue(new TextEncoder().encode(prompt(0, "ok") + "\n"));
        },
        pull() {
          throw new Error("disk went away");
        },
      });
    const r = await readSession([{ path: "s.jsonl", file: bad }]);
    expect(r).toMatchObject({ ok: false, error: "read-failed" });
  });

  it("returns no-session-file when nothing is a session", async () => {
    const r = await readSession([{ path: "notes.txt", file: new File(["hi"], "notes.txt") }]);
    expect(r).toMatchObject({ ok: false, error: "no-session-file" });
    expect("choose" in r).toBe(false);
  });

  it("refuses files past the cap without reading them", async () => {
    const reads: string[] = [];
    const files = ["a", "b", "c"].map((id) => ({ path: `s/subagents/agent-${id}.jsonl`, file: chunked(prompt(0, id), id, 1000, () => reads.push(id)) }));
    const r = await readSession([{ path: "s.jsonl", file: new File([prompt(0, "main")], "s.jsonl") }, ...files], { limits: { files: 2 } });
    expect(r.report.capsHit).toEqual(["files"]);
    expect(reads).toEqual(["a"]);
  });

  describe("several top-level sessions", () => {
    const sessions: PickedFile[] = [
      { path: "proj/one.jsonl", file: new File([[JSON.stringify({ type: "queue-operation" }), prompt(0, "  Plan the trip\nwith details"), prompt(1, "later")].join("\n")], "one.jsonl") },
      { path: "proj/two.jsonl", file: new File([prompt(0, "x".repeat(300)) + "\n" + prompt(5, "more")], "two.jsonl") },
      { path: "proj/three.jsonl", file: new File([JSON.stringify({ type: "attachment" })], "three.jsonl") },
      { path: "proj/two/subagents/agent-a.jsonl", file: new File([prompt(2, "child")], "agent-a.jsonl") },
      { path: "proj/two/subagents/agent-b.jsonl", file: new File([prompt(3, "child")], "agent-b.jsonl") },
      { path: "proj/one/subagents/agent-c.jsonl", file: new File([prompt(3, "child")], "agent-c.jsonl") },
    ];

    it("lists each candidate instead of failing, with a capped first prompt line", async () => {
      const r = await readSession(sessions);
      expect(r).toMatchObject({ ok: false, error: "several-session-files" });
      if (r.ok || !("choose" in r)) throw new Error("expected a chooser");
      expect(r.choose.map((c) => c.path)).toEqual(["proj/one.jsonl", "proj/two.jsonl", "proj/three.jsonl"]);
      expect(r.choose.map((c) => c.subagentFiles)).toEqual([1, 2, 0]);
      expect(r.choose[0].firstPrompt).toBe("Plan the trip");
      expect(r.choose[1].firstPrompt).toHaveLength(120);
      expect(r.choose[2].firstPrompt).toBe("");
      expect(r.choose[1].size).toBe(sessions[1].file.size);
    });

    it("reads only the chosen session and its own subagents when called again", async () => {
      const r = await readSession(sessions, { session: "proj/one.jsonl" });
      expect(r.ok && r.trace.events.filter((e) => e.kind === "prompt")).toHaveLength(2);
      expect(r.report.linesRead).toBe(3 + 1); // its own three lines and agent-c; nothing of proj/two
    });
  });
});
