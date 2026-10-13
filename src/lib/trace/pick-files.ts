import { normalizePath, type PickedFile } from "./session-files";

export type { PickedFile };

/** Only these matter to the parser; a walked folder skips everything else without opening it. */
const relevant = (name: string) => name.endsWith(".jsonl") || name.endsWith(".meta.json");

/** A file input (`<input type=file>` or `webkitdirectory`): the relative path keeps `subagents/`. */
export function filesFromInput(list: FileList | readonly File[]): PickedFile[] {
  return Array.from(list, (file) => ({ path: file.webkitRelativePath || file.name, file }));
}

function readBatch(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

async function walkEntry(entry: FileSystemEntry, inFolder: boolean, out: PickedFile[], signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (entry.isFile) {
    if (inFolder && !relevant(entry.name)) return;
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    out.push({ path: entry.fullPath.replace(/^\//, ""), file });
    return;
  }
  if (!entry.isDirectory) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // readEntries returns at most 100 entries per call; an empty batch ends the folder.
  for (let batch = await readBatch(reader); batch.length > 0; batch = await readBatch(reader)) {
    for (const child of batch) await walkEntry(child, true, out, signal);
  }
}

/** A drop: files, or folders walked recursively. Aborting `signal` stops the walk and rejects with its reason. */
export async function filesFromDrop(data: DataTransfer, signal?: AbortSignal): Promise<PickedFile[]> {
  // The entries must be taken before the first await; the browser clears the items afterwards.
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  if (entries.length === 0) return filesFromInput(data.files);
  const out: PickedFile[] = [];
  for (const entry of entries) await walkEntry(entry, false, out, signal);
  signal?.throwIfAborted();
  return out;
}

interface DirectoryLike {
  name: string;
  values(): AsyncIterable<{ kind: "file" | "directory"; name: string }>;
}

async function walkHandle(dir: DirectoryLike, prefix: string, out: PickedFile[]): Promise<void> {
  for await (const h of dir.values()) {
    if (h.kind === "directory") {
      await walkHandle(h as unknown as DirectoryLike, `${prefix}${h.name}/`, out);
    } else if (relevant(h.name)) {
      out.push({ path: prefix + h.name, file: await (h as unknown as FileSystemFileHandle).getFile() });
    }
  }
}

/** `showDirectoryPicker()`: the paths start with the folder's name, as `webkitRelativePath` does. */
export async function filesFromDirectory(handle: FileSystemDirectoryHandle): Promise<PickedFile[]> {
  const out: PickedFile[] = [];
  await walkHandle(handle as unknown as DirectoryLike, `${handle.name}/`, out);
  return out;
}

/** What was loaded plus a later pick (the subagents folder, say), one file per path; the later pick wins. */
export function mergePicked(loaded: readonly PickedFile[], picked: readonly PickedFile[]): PickedFile[] {
  const byPath = new Map<string, PickedFile>();
  for (const f of [...loaded, ...picked]) byPath.set(normalizePath(f.path), f);
  return [...byPath.values()];
}
