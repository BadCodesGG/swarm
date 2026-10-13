import { describe, expect, it } from "vitest";
import { createLineSplitter } from "./lines";

function split(chunks: string[], max?: number): string[] {
  const out: string[] = [];
  const s = createLineSplitter((l) => out.push(l), max);
  for (const c of chunks) s.push(c);
  s.end();
  return out;
}

describe("createLineSplitter", () => {
  it("splits lines inside one chunk", () => {
    expect(split(["a\nb\nc\n"])).toEqual(["a", "b", "c"]);
  });

  it("joins a line cut at any chunk boundary", () => {
    const text = '{"a":1}\n{"b":2}\n{"c":3}\n';
    for (let cut = 1; cut < text.length; cut++) {
      expect(split([text.slice(0, cut), text.slice(cut)])).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
    }
    expect(split([...text])).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });

  it("treats CRLF as one terminator, also when the pair straddles chunks", () => {
    expect(split(["a\r\nb\r\n"])).toEqual(["a", "b"]);
    expect(split(["a\r", "\nb\r", "\n"])).toEqual(["a", "b"]);
    expect(split(["a\rb\n"])).toEqual(["a\rb"]);
  });

  it("delivers a last line with no terminator, and no phantom line after a final newline", () => {
    expect(split(["a\nb"])).toEqual(["a", "b"]);
    expect(split(["a\n"])).toEqual(["a"]);
    expect(split([])).toEqual([]);
  });

  it("keeps blank lines (the consumer ignores them)", () => {
    expect(split(["a\n\nb\n"])).toEqual(["a", "", "b"]);
  });

  it("caps an over-long line at max + 1 characters and resumes at the next line", () => {
    const out = split(["x".repeat(50), "y".repeat(50), "\nok\n"], 10);
    expect(out).toEqual(["x".repeat(11), "ok"]);
    expect(split(["abcde\n"], 5)).toEqual(["abcde"]);
    expect(split(["abcdef\n"], 5)).toEqual(["abcdef"]);
  });

  it("reassembles a UTF-8 character split between byte chunks (through TextDecoderStream)", async () => {
    const bytes = new TextEncoder().encode('{"t":"héllo 𝄞 日本"}\r\n{"t":"ok"}\n');
    for (let cut = 1; cut < bytes.length; cut++) {
      const stream = new ReadableStream<BufferSource>({
        start(c) {
          c.enqueue(bytes.slice(0, cut));
          c.enqueue(bytes.slice(cut));
          c.close();
        },
      }).pipeThrough(new TextDecoderStream());
      const out: string[] = [];
      const s = createLineSplitter((l) => out.push(l));
      const reader = stream.getReader();
      for (let r = await reader.read(); !r.done; r = await reader.read()) s.push(r.value);
      s.end();
      expect(out).toEqual(['{"t":"héllo 𝄞 日本"}', '{"t":"ok"}']);
    }
  });
});
