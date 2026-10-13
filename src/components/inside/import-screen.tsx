"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { setImported } from "@/engine/inside/imported";
import { loadSession } from "@/lib/trace/load";
import { filesFromDrop, filesFromInput, type PickedFile } from "@/lib/trace/pick-files";
import type { ParseError, ParseReport, SessionCandidate, SessionTrace } from "@/lib/trace/types";
import { agentsCopy, errorCopy, formatProgress, formatSize, missingChildren, missingCopy, percentRead, reportNote, truncatedCopy } from "./import-copy";

/** React's input types have no `webkitdirectory`; the attribute is what makes the picker take a folder. */
const FOLDER = { webkitdirectory: "" } as unknown as InputHTMLAttributes<HTMLInputElement>;

type View =
  | { kind: "idle" }
  | { kind: "reading"; bytes: number; total: number }
  | { kind: "choose"; candidates: SessionCandidate[] }
  | { kind: "error"; error: ParseError; report: ParseReport | null }
  | { kind: "ready"; trace: SessionTrace; report: ParseReport };

const ring = "outline-none focus-visible:ring-2 focus-visible:ring-layer-1";
/** The inputs are visually hidden, so the label around one shows the focus ring. */
const focusRing = "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-layer-1";

const LOGO = (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <circle cx="9" cy="9" r="3.2" fill="#ffb54d" />
    <circle cx="9" cy="9" r="7.5" fill="none" stroke="#ffb54d" strokeOpacity="0.45" strokeWidth="1" />
    <circle cx="15.5" cy="5" r="1.4" fill="#4fd8eb" />
    <circle cx="3" cy="13.4" r="1.4" fill="#a78bff" />
  </svg>
);

const UPLOAD = (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 11V2M4.5 5.5 8 2l3.5 3.5M2.5 10.5v3h11v-3" fill="none" stroke="#1a1205" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const SAMPLES = [
  { size: "small", label: "Small" },
  { size: "medium", label: "Medium" },
  { size: "large", label: "Large" },
] as const;

function Header() {
  return (
    <header className="mx-auto flex w-full max-w-[1392px] flex-wrap items-center gap-x-4 gap-y-3 px-4 pt-5 sm:px-6">
      <Link href="/" className={`flex min-h-11 items-center gap-2.5 pr-2 font-mono text-[13px] tracking-[0.12em] text-label hover:text-white ${ring}`}>
        {LOGO}
        <span>
          SWARM <span className="text-rule">/</span> <span className="font-semibold text-ink">INSIDE</span>
        </span>
      </Link>
      <div role="group" aria-label="Sample session size" className="flex items-center rounded-xl border border-[rgba(150,172,214,0.18)] bg-[rgba(12,16,28,0.78)] p-1">
        <span className="pr-2.5 pl-2 font-mono text-[10px] tracking-[0.14em] text-faint">SAMPLE</span>
        {SAMPLES.map(({ size, label }) => (
          <Link key={size} href={`/inside?source=${size}`} className={`flex min-h-11 items-center rounded-[9px] px-3 text-sm text-label hover:text-ink sm:px-4 ${ring}`}>
            {label}
          </Link>
        ))}
      </div>
      <span aria-current="page" className="flex min-h-11 items-center gap-2 rounded-xl bg-opus px-4 text-sm font-bold text-[#1a1205]">
        {UPLOAD}
        Load your session
      </span>
    </header>
  );
}

const ICON_WARN = (
  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className="mt-px">
    <path d="M10 2.5 18 17H2z" fill="none" stroke="#ffc77a" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M10 8v4.2M10 14.4v.5" stroke="#ffc77a" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);
const ICON_INFO = (
  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className="mt-px">
    <circle cx="10" cy="10" r="8.5" fill="none" stroke="#ffc77a" strokeWidth="1.5" />
    <path d="M10 9v5M10 6v.5" stroke="#ffc77a" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);
const ICON_ERROR = (
  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className="mt-px">
    <circle cx="10" cy="10" r="8.5" fill="none" stroke="#ff8aa0" strokeWidth="1.5" />
    <path d="M10 5.5v5.5M10 13.6v.6" stroke="#ff8aa0" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

function Notice({ tone, icon, title, label, kind, children }: { tone: "warn" | "error"; icon: ReactNode; title: string; label: string; kind: string; children: ReactNode }) {
  const error = tone === "error";
  return (
    <section
      aria-label={label}
      role={error ? "alert" : undefined}
      data-notice={kind}
      className={`grid grid-cols-[20px_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-[14px] border px-4 py-3.5 ${
        error ? "border-[rgba(255,92,120,0.45)] bg-[rgba(255,92,120,0.07)]" : "border-[rgba(255,181,77,0.4)] bg-[rgba(255,181,77,0.06)]"
      }`}
    >
      {icon}
      <span className={`text-[15px] font-bold ${error ? "text-[#ffd0d8]" : "text-[#ffe2b8]"}`}>{title}</span>
      <span />
      <div className={`flex flex-col items-start gap-2.5 text-[13px] leading-normal ${error ? "text-[#dfc3c9]" : "text-[#e2d3bd]"}`}>{children}</div>
    </section>
  );
}

const card = "flex flex-col gap-2.5 rounded-[14px] border border-[rgba(150,172,214,0.18)] bg-[rgba(12,16,28,0.86)] px-[18px] py-4";

function Reading({ bytes, total, onCancel }: { bytes: number; total: number; onCancel: () => void }) {
  const pct = percentRead(bytes, total);
  return (
    <section aria-label="Reading" data-state="reading" className={card}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-base font-bold">Reading your session</span>
        <span className="font-mono text-xs text-label">{pct}%</span>
      </div>
      <div role="progressbar" aria-label="Reading" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className="h-1.5 overflow-hidden rounded-[3px] bg-white/[0.07]">
        <div style={{ width: `${pct}%` }} className="h-full rounded-[3px] bg-opus shadow-[0_0_10px_rgba(255,181,77,0.6)]" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-xs text-label">
        <span>{total > 0 ? formatProgress(bytes, total) : "Starting"}</span>
        <button type="button" onClick={onCancel} className={`min-h-11 rounded-[10px] border border-[rgba(150,172,214,0.22)] bg-transparent px-3.5 font-sans text-[13px] text-body hover:text-white ${ring}`}>
          Cancel
        </button>
      </div>
    </section>
  );
}

function Chooser({ candidates, onPlay }: { candidates: SessionCandidate[]; onPlay: (path: string) => void }) {
  const [picked, setPicked] = useState(candidates[0]?.path ?? "");
  return (
    <section aria-label="Choose one session" data-state="choose" className={card}>
      <span className="text-base font-bold">This folder holds {candidates.length} sessions</span>
      <div role="radiogroup" aria-label="Sessions" className="flex flex-col gap-1.5">
        {candidates.map((c) => {
          const on = c.path === picked;
          return (
            <label
              key={c.path}
              className={`grid min-h-14 cursor-pointer grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-3 rounded-[10px] px-3 py-1.5 ${focusRing} ${on ? "bg-[#1a2238] shadow-[inset_0_0_0_1px_rgba(255,181,77,0.45)]" : ""}`}
            >
              <input type="radio" name="session" value={c.path} checked={on} onChange={() => setPicked(c.path)} className="m-0 size-4 accent-opus outline-none" />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span data-first-prompt className={`truncate text-sm ${on ? "text-ink" : "text-body"}`}>
                  {c.firstPrompt || "(no prompt found)"}
                </span>
                <span className="font-mono text-[11px] text-label">{formatSize(c.size)}</span>
              </span>
              <span className={`font-mono text-[11px] ${c.subagentFiles > 0 && on ? "text-[#c9b8ff]" : "text-label"}`}>{agentsCopy(c.subagentFiles)}</span>
            </label>
          );
        })}
      </div>
      <button type="button" onClick={() => onPlay(picked)} className={`min-h-11 self-start rounded-[10px] border-0 bg-ink px-[18px] text-sm font-bold text-ground ${ring}`}>
        Play this session
      </button>
    </section>
  );
}

/** A visually hidden folder input inside a styled label. */
function FolderButton({ children, className, name, onFiles }: { children: string; className: string; name: string; onFiles: (files: PickedFile[]) => void }) {
  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const files = filesFromInput(e.target.files ?? []);
    e.target.value = "";
    onFiles(files);
  };
  return (
    <label className={`relative flex cursor-pointer items-center ${focusRing} ${className}`}>
      {children}
      <input type="file" data-input={name} {...FOLDER} onChange={pick} className="sr-only" />
    </label>
  );
}

function Ready({ trace, report, onPlay, onFiles }: { trace: SessionTrace; report: ParseReport; onPlay: () => void; onFiles: (files: PickedFile[]) => void }) {
  const missing = missingChildren(trace);
  const note = reportNote(report);
  return (
    <>
      <section aria-label="Session ready" data-state="ready" className={card}>
        <span className="text-base font-bold">Your session is ready</span>
        <span className="font-mono text-xs text-label">
          {trace.events.length.toLocaleString("en-US")} events, {agentsCopy(trace.agents.length - 1)}
        </span>
        {note ? (
          <span data-report className="text-xs text-faint">
            {note}
          </span>
        ) : null}
        <button type="button" onClick={onPlay} className={`min-h-11 self-start rounded-[10px] border-0 bg-ink px-[18px] text-sm font-bold text-ground ${ring}`}>
          Play this session
        </button>
      </section>
      {trace.truncated ? (
        <Notice tone="warn" icon={ICON_WARN} title="Very long session: playing the first part" label="Session too large" kind="truncated">
          <span>{truncatedCopy}</span>
        </Notice>
      ) : null}
      {missing > 0 ? (
        <Notice tone="warn" icon={ICON_INFO} title="Showing the main agent only" label="Subagents missing" kind="child-missing">
          <span>{missingCopy(missing)}</span>
          <FolderButton name="missing-folder" onFiles={onFiles} className="min-h-11 rounded-[10px] border border-[rgba(255,181,77,0.5)] px-4 text-sm font-semibold text-warn">
            Choose the folder
          </FolderButton>
        </Notice>
      ) : null}
    </>
  );
}

export default function ImportScreen() {
  const router = useRouter();
  const [view, setView] = useState<View>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const files = useRef<PickedFile[]>([]);
  const running = useRef<AbortController | null>(null);

  useEffect(() => () => running.current?.abort(), []);

  const play = useCallback(
    (trace: SessionTrace) => {
      setImported(trace);
      router.push("/inside?source=upload");
    },
    [router],
  );

  const run = useCallback(
    async (picked: PickedFile[], session?: string) => {
      running.current?.abort();
      const ctl = new AbortController();
      running.current = ctl;
      files.current = picked;
      setView({ kind: "reading", bytes: 0, total: 0 });
      try {
        const result = await loadSession(picked, (bytes, total) => setView({ kind: "reading", bytes, total }), ctl.signal, { session });
        if (ctl.signal.aborted) return;
        if (!result.ok) {
          if ("choose" in result) setView({ kind: "choose", candidates: result.choose });
          else setView({ kind: "error", error: result.error, report: result.report });
          return;
        }
        const { trace, report } = result;
        // A clean, complete parse goes straight to the replay; anything worth saying stops here first.
        if (!trace.truncated && missingChildren(trace) === 0 && reportNote(report) === null) play(trace);
        else setView({ kind: "ready", trace, report });
      } catch {
        // Cancel rejects with an AbortError and returns to the drop zone; any other failure is a failed read.
        if (!ctl.signal.aborted) setView({ kind: "error", error: "read-failed", report: null });
      }
    },
    [play],
  );

  const cancel = () => {
    running.current?.abort();
    setView({ kind: "idle" });
  };

  const onDrop = async (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    setDragging(false);
    try {
      await run(await filesFromDrop(e.dataTransfer));
    } catch {
      setView({ kind: "error", error: "read-failed", report: null });
    }
  };

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = filesFromInput(e.target.files ?? []);
    e.target.value = "";
    void run(picked);
  };

  let state: ReactNode = null;
  if (view.kind === "reading") state = <Reading bytes={view.bytes} total={view.total} onCancel={cancel} />;
  else if (view.kind === "choose") state = <Chooser candidates={view.candidates} onPlay={(path) => void run(files.current, path)} />;
  else if (view.kind === "ready") state = <Ready trace={view.trace} report={view.report} onPlay={() => play(view.trace)} onFiles={(f) => void run(f)} />;
  else if (view.kind === "error") {
    const copy = errorCopy(view.error);
    const note = view.report ? reportNote(view.report) : null;
    state = (
      <Notice tone="error" icon={ICON_ERROR} title={copy.title} label="Could not load" kind={view.error}>
        <span>{copy.body}</span>
        {note ? (
          <span data-report className="text-xs text-[#c7a9b0]">
            {note}
          </span>
        ) : null}
      </Notice>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(900px_640px_at_30%_40%,#10162b_0%,#0a0d18_55%,#070910_100%)] text-ink">
      <Header />
      <main className="mx-auto flex w-full max-w-[1392px] flex-wrap items-start gap-6 px-4 pt-8 pb-10 sm:px-6">
        <div className="flex max-w-[820px] min-w-0 flex-[999_1_560px] flex-col gap-5">
          <div className="flex flex-col gap-2.5">
            <h1 className="m-0 text-[clamp(32px,4vw,48px)] leading-[1.05] font-extrabold tracking-[-0.03em]">Watch your own swarm.</h1>
            <p className="m-0 max-w-[56ch] text-[17px] leading-normal text-muted [text-wrap:pretty]">
              Bring a Claude Code session and Swarm replays it: every subagent, tool call and web search, at the moment it happened.
            </p>
          </div>

          <section
            aria-label="Choose a session"
            data-dropzone
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
            }}
            onDrop={onDrop}
            className={`relative flex flex-col items-center gap-[18px] rounded-[18px] border-[1.5px] border-dashed px-5 py-11 text-center sm:px-8 ${
              dragging ? "border-opus bg-[rgba(255,181,77,0.1)]" : "border-[rgba(255,181,77,0.55)] bg-[rgba(255,181,77,0.04)]"
            }`}
          >
            <svg width="72" height="72" viewBox="0 0 72 72" aria-hidden="true">
              <circle cx="36" cy="36" r="34" fill="none" stroke="#ffb54d" strokeOpacity="0.25" strokeDasharray="2 4" />
              <circle cx="36" cy="36" r="22" fill="rgba(255,181,77,0.1)" />
              <path d="M36 44V24M28 31l8-8 8 8" fill="none" stroke="#ffc77a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="62" cy="20" r="3" fill="#a78bff" />
              <circle cx="10" cy="48" r="2.6" fill="#4fd8eb" />
              <circle cx="58" cy="58" r="2.2" fill="#7ee2a8" />
            </svg>
            <div className="flex flex-col gap-1.5">
              <span className="text-[22px] font-bold">Drop a session file or folder here</span>
              <span className="text-[15px] text-label">
                A <code className="font-mono text-sm text-body">.jsonl</code> file, or its whole folder to bring its subagents too.
              </span>
            </div>
            <div className="flex flex-wrap justify-center gap-2.5">
              <label className={`relative flex min-h-12 cursor-pointer items-center rounded-xl bg-opus px-[22px] text-[15px] font-bold text-[#1a1205] ${focusRing}`}>
                Choose a file
                <input type="file" accept=".jsonl" data-input="file" onChange={onFile} className="sr-only" />
              </label>
              <FolderButton name="folder" onFiles={(f) => void run(f)} className="min-h-12 rounded-xl border border-[rgba(255,181,77,0.5)] px-[22px] text-[15px] font-semibold text-warn">
                Choose a folder
              </FolderButton>
            </div>
            <p className="m-0 flex items-center gap-2 text-sm text-muted">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
                <rect x="3" y="7" width="10" height="7" rx="1.5" fill="none" stroke="#7ee2a8" strokeWidth="1.4" />
                <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="#7ee2a8" strokeWidth="1.4" />
              </svg>
              Parsed in your browser. Nothing is uploaded or stored.
            </p>
          </section>

          <section aria-label="Where to find a session" className="flex flex-col gap-3.5 rounded-[14px] border border-panel-border bg-panel px-[22px] py-5">
            <span className="font-mono text-[10px] tracking-[0.14em] text-label">WHERE TO FIND ONE</span>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] gap-3">
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] text-label">macOS and Linux</span>
                <code className="block rounded-lg bg-white/[0.04] px-3 py-2.5 font-mono text-[12.5px] leading-normal break-words text-ink">~/.claude/projects/&lt;project&gt;/&lt;session-id&gt;.jsonl</code>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] text-label">Windows</span>
                <code className="block rounded-lg bg-white/[0.04] px-3 py-2.5 font-mono text-[12.5px] leading-normal break-words text-ink">%USERPROFILE%\.claude\projects\&lt;project&gt;\&lt;session-id&gt;.jsonl</code>
              </div>
            </div>
            <ul className="m-0 flex list-disc flex-col gap-1.5 pl-[18px] text-sm leading-normal text-muted">
              <li>
                Subagents sit beside it in <code className="font-mono text-[13px] text-ink">&lt;session-id&gt;/subagents/</code>. Choose the project folder to bring them in.
              </li>
              <li>
                If you set <code className="font-mono text-[13px] text-ink">CLAUDE_CONFIG_DIR</code>, look in that folder instead of <code className="font-mono text-[13px] text-ink">.claude</code>.
              </li>
              <li>Your own prompts show as you wrote them, and only in this tab.</li>
            </ul>
          </section>
        </div>

        <div aria-live="polite" className="flex min-w-0 flex-[1_1_380px] flex-col gap-3 empty:hidden">
          {state}
        </div>
      </main>
    </div>
  );
}
