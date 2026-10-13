import { describe, expect, it } from "vitest";
import { filesFromDirectory, filesFromDrop, filesFromInput, mergePicked } from "./pick-files";
import { selectSession } from "./session-files";

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

describe("filesFromDrop: stopping", () => {
  it("stops walking a dropped folder once its signal aborts, and rejects with the abort", async () => {
    const ctl = new AbortController();
    let opened = 0;
    const counted = (full: string): FakeEntry => ({ ...fileEntry(full), file: (ok) => (opened++, ok(file(base(full)))) });
    const big = dirEntry("/abc", Array.from({ length: 50 }, (_, i) => counted(`/abc/agent-${i}.jsonl`)));
    const walk = filesFromDrop(drop([big]), ctl.signal);
    ctl.abort();
    await expect(walk).rejects.toMatchObject({ name: "AbortError" });
    expect(opened).toBeLessThan(50);
  });
});

describe("mergePicked", () => {
  it("adds a later pick to what was loaded, the later file winning on the same path", () => {
    const session = { path: "abc.jsonl", file: file("abc.jsonl") };
    const sub = { path: "abc/subagents/agent-a.jsonl", file: file("agent-a.jsonl") };
    const again = { path: "abc.jsonl", file: file("abc.jsonl") };
    const merged = mergePicked([session], [sub, again]);
    expect(merged.map((f) => f.path)).toEqual(["abc.jsonl", "abc/subagents/agent-a.jsonl"]);
    expect(merged[0].file).toBe(again.file);
  });

  it("treats backslash and slash paths as the same file", () => {
    const a = { path: ["abc", "subagents", "agent-a.jsonl"].join(String.fromCharCode(92)), file: file("agent-a.jsonl") };
    const b = { path: "abc/subagents/agent-a.jsonl", file: file("agent-a.jsonl") };
    expect(mergePicked([a], [b])).toHaveLength(1);
  });

  describe("a session loaded alone, then its folder", () => {
    const alone = [{ path: "abc.jsonl", file: file("abc.jsonl") }];
    const folder = (prefix: string) => [
      { path: `${prefix}abc/subagents/agent-a.jsonl`, file: file("agent-a.jsonl") },
      { path: `${prefix}abc/subagents/agent-b.jsonl`, file: file("agent-b.jsonl") },
    ];

    it("the session folder gives one session with both subagent files", () => {
      const sel = selectSession(mergePicked(alone, folder("")));
      expect(sel.kind).toBe("ok");
      if (sel.kind !== "ok") return;
      expect(sel.session.path).toBe("abc.jsonl");
      expect(sel.related.map((f) => f.path)).toEqual(["abc/subagents/agent-a.jsonl", "abc/subagents/agent-b.jsonl"]);
    });

    it("the project folder, holding the same session again, gives the same, with the folder's own copy of the session", () => {
      const again = { path: "proj/abc.jsonl", file: file("abc.jsonl") };
      const merged = mergePicked(alone, [again, ...folder("proj/")]);
      expect(merged).toHaveLength(3);
      const sel = selectSession(merged);
      expect(sel.kind).toBe("ok");
      if (sel.kind !== "ok") return;
      expect(sel.session.file).toBe(again.file);
      expect(sel.related.map((f) => f.path)).toEqual(["proj/abc/subagents/agent-a.jsonl", "proj/abc/subagents/agent-b.jsonl"]);
    });

    it("keeps two different sessions apart whatever their folders", () => {
      const merged = mergePicked(alone, [{ path: "proj/def.jsonl", file: file("def.jsonl") }]);
      expect(merged.map((f) => f.path)).toEqual(["abc.jsonl", "proj/def.jsonl"]);
    });
  });
});
