import { describe, expect, it } from "vitest";
import { filesFromDirectory, filesFromDrop, filesFromInput } from "./pick-files";

const file = (name: string) => new File(["x"], name);

describe("filesFromInput", () => {
  it("uses the relative path of a folder pick, subagents/ prefix included, and the name of a single file", () => {
    const withPath = Object.assign(file("agent-a.jsonl"), { webkitRelativePath: "proj/abc/subagents/agent-a.jsonl" });
    const plain = file("abc.jsonl");
    expect(filesFromInput([withPath, plain]).map((f) => f.path)).toEqual(["proj/abc/subagents/agent-a.jsonl", "abc.jsonl"]);
    expect(filesFromInput([plain])[0].file).toBe(plain);
  });
});

interface FakeEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?: (ok: (f: File) => void) => void;
  createReader?: () => { readEntries: (ok: (e: FakeEntry[]) => void) => void };
}

const base = (full: string) => full.split("/").pop() ?? "";
const fileEntry = (full: string): FakeEntry => ({ isFile: true, isDirectory: false, name: base(full), fullPath: full, file: (ok) => ok(file(base(full))) });
const dirEntry = (full: string, children: FakeEntry[]): FakeEntry => ({
  isFile: false,
  isDirectory: true,
  name: base(full),
  fullPath: full,
  createReader: () => {
    // At most two entries per call, as the browser caps a batch; an empty batch ends the folder.
    let at = 0;
    return {
      readEntries: (ok) => {
        ok(children.slice(at, at + 2));
        at += 2;
      },
    };
  },
});

const drop = (entries: FakeEntry[]) => ({ items: entries.map((e) => ({ kind: "file", webkitGetAsEntry: () => e })), files: [] }) as unknown as DataTransfer;

describe("filesFromDrop", () => {
  it("walks a dropped folder in batches, keeps the subagents/ prefix, and skips files the parser cannot use", async () => {
    const tree = dirEntry("/abc", [
      fileEntry("/abc/abc.jsonl"),
      fileEntry("/abc/readme.txt"),
      dirEntry("/abc/subagents", [fileEntry("/abc/subagents/agent-a.jsonl"), fileEntry("/abc/subagents/agent-a.meta.json"), fileEntry("/abc/subagents/agent-a.prefix.json")]),
    ]);
    const got = await filesFromDrop(drop([tree]));
    expect(got.map((f) => f.path).sort()).toEqual(["abc/abc.jsonl", "abc/subagents/agent-a.jsonl", "abc/subagents/agent-a.meta.json"]);
  });

  it("keeps a single dropped file whatever it is, so the loader can say it is not a session", async () => {
    const got = await filesFromDrop(drop([fileEntry("/notes.txt")]));
    expect(got.map((f) => f.path)).toEqual(["notes.txt"]);
  });

  it("falls back to the plain file list when the browser gives no entries", async () => {
    const dt = { items: [], files: [file("a.jsonl")] } as unknown as DataTransfer;
    expect((await filesFromDrop(dt)).map((f) => f.path)).toEqual(["a.jsonl"]);
  });
});

describe("filesFromDirectory", () => {
  it("walks a directory handle, naming paths from the folder's own name", async () => {
    interface Handle {
      kind: "file" | "directory";
      name: string;
      getFile: () => Promise<File>;
      values: () => AsyncGenerator<Handle>;
    }
    const h = (name: string, kind: Handle["kind"], children: Handle[] = []): Handle => ({
      kind,
      name,
      getFile: async () => file(name),
      async *values() {
        for (const c of children) yield c;
      },
    });
    const root = h("abc", "directory", [
      h("abc.jsonl", "file"),
      h("notes.txt", "file"),
      h("subagents", "directory", [h("agent-a.jsonl", "file"), h("agent-a.meta.json", "file")]),
    ]);
    const got = await filesFromDirectory(root as unknown as FileSystemDirectoryHandle);
    expect(got.map((f) => f.path)).toEqual(["abc/abc.jsonl", "abc/subagents/agent-a.jsonl", "abc/subagents/agent-a.meta.json"]);
  });
});
