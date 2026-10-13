"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Image from "next/image";
import { readPrefs, writePref, type Quality } from "@/engine/shared/prefs";

/** What an act's start function receives. */
export interface StartOptions {
  /** The raw `?shot=` value, or null. */
  shot: string | null;
  /** `?webgl=1`. */
  forceWebGL: boolean;
  /** The saved quality preference. */
  quality: Quality;
  /** The page's query string, for the act's own parameters. */
  params: URLSearchParams;
  onProgress(fraction: number, label: string): void;
}

export interface ExperienceApp {
  dispose(): void;
}

export interface StillImage {
  src: string;
  alt: string;
}

interface LoadState {
  fraction: number;
  label: string;
}

/**
 * probing     waiting for idle, then asking the browser what it can draw
 * run         the engine is starting or running
 * still       reduced motion is on: a still frame and an "Enter anyway" button
 * unsupported neither WebGPU nor WebGL 2: the still and an explanation
 */
type Gate = "probing" | "run" | "still" | "unsupported";

/** WebGPU is present, or a WebGL 2 context can be made (three has no WebGL 1 path). */
function canDraw(): boolean {
  if ("gpu" in navigator && navigator.gpu) return true;
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    // Release the probe's context now rather than waiting on GC; browsers cap live contexts.
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

function whenIdle(fn: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(fn, { timeout: 1000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(fn, 200);
  return () => window.clearTimeout(id);
}

function Still({ still, title, children }: { still: StillImage; title: string; children?: ReactNode }) {
  return (
    <div className="absolute inset-0">
      <Image src={still.src} alt={still.alt} fill priority unoptimized sizes="100vw" className="object-cover" />
      <div className="absolute inset-0 bg-gradient-to-t from-ground/85 via-ground/5 to-ground/20" />
      <div className="absolute bottom-8 left-6 max-w-[34rem] pr-6 sm:left-10">
        <h1 className="font-mono text-[11px] uppercase tracking-[0.28em] text-ink">{title}</h1>
        {children}
      </div>
    </div>
  );
}

/**
 * Full-viewport canvas shared by both acts. The engine (and three) is imported by `start` on the
 * client only, after mount and after a capability probe at idle, so the server-rendered page is
 * just the dark frame and the loader.
 */
export default function Experience<A extends ExperienceApp>({
  start,
  still,
  title,
  label,
  overlay,
}: {
  start: (canvas: HTMLCanvasElement, opts: StartOptions) => Promise<A>;
  still: StillImage;
  title: string;
  /** The canvas's accessible name. */
  label: string;
  /** Rendered over the canvas once the engine is running (HUD, panel). */
  overlay?: (app: A) => ReactNode;
}) {
  const [gate, setGate] = useState<Gate>("probing");
  const [load, setLoad] = useState<LoadState>({ fraction: 0, label: "Preparing" });
  const [app, setApp] = useState<A | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  useEffect(
    () =>
      whenIdle(() => {
        if (!canDraw()) return setGate("unsupported");
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        setGate(reduced && readPrefs().motion !== "on" ? "still" : "run");
      }),
    [],
  );

  const enterAnyway = useCallback(() => {
    writePref("motion", "on");
    setGate("run");
  }, []);

  useEffect(() => {
    if (gate !== "run" || !canvas) return;
    let disposed = false;
    let dispose: (() => void) | null = null;
    const params = new URLSearchParams(window.location.search);

    start(canvas, {
      shot: params.get("shot"),
      forceWebGL: params.get("webgl") === "1",
      quality: readPrefs().quality,
      params,
      onProgress: (fraction, text) => {
        if (!disposed) setLoad({ fraction, label: text });
      },
    })
      .then((started) => {
        if (disposed) {
          started.dispose();
          return;
        }
        dispose = () => started.dispose();
        setApp(started);
      })
      .catch((err: unknown) => {
        if (!disposed) setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      disposed = true;
      dispose?.();
      setApp(null);
    };
  }, [gate, canvas, start]);

  const running = gate === "run";
  const showLoader = gate === "probing" || (running && !app);

  return (
    <main className="fixed inset-0 overflow-hidden bg-ground text-body select-none">
      <canvas ref={setCanvas} className={`h-full w-full outline-none ${running ? "block" : "hidden"}`} aria-label={label} />

      {gate === "still" ? (
        <Still still={still} title={title}>
          <p className="mt-3 text-[15px] leading-snug text-ink-strong">Your device asks for reduced motion, so the scene is paused on a still.</p>
          <p className="mt-1.5 text-[13px] leading-snug text-muted">Entering starts the live scene.</p>
          <button
            type="button"
            onClick={enterAnyway}
            className="mt-4 rounded-[4px] border border-layer-2/50 bg-layer-2/10 px-4 py-2 text-[13px] tracking-wide text-ink-strong transition-colors hover:bg-layer-2/20 focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:ring-offset-2 focus-visible:ring-offset-ground focus-visible:outline-none"
          >
            Enter anyway
          </button>
          <p className="mt-2 text-xs text-muted">Remembered on this device.</p>
        </Still>
      ) : null}

      {gate === "unsupported" ? (
        <Still still={still} title={title}>
          <p className="mt-3 text-[15px] leading-snug text-ink-strong">This browser can draw neither WebGPU nor WebGL 2, so the live scene cannot start.</p>
          <p className="mt-1.5 text-[13px] leading-snug text-muted">
            Try a recent Chrome, Edge, Firefox or Safari on a device with a graphics chip. The picture is a frame from the live scene.
          </p>
        </Still>
      ) : null}

      <div
        className={`pointer-events-none absolute inset-0 flex items-center justify-center bg-ground ease-out ${
          showLoader ? "opacity-100" : "opacity-0"
        } ${running ? "transition-opacity duration-[1200ms]" : ""}`}
        aria-hidden={!showLoader}
      >
        <div className="flex w-64 flex-col items-center gap-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-label">{error ? "Could not start" : load.label}</p>
          <div className="h-px w-full overflow-hidden bg-rule/40">
            <div className="h-full bg-layer-2 transition-[width] duration-300 ease-out" style={{ width: `${Math.round(load.fraction * 100)}%` }} />
          </div>
          {error ? <p className="text-center text-xs text-error">{error}</p> : null}
        </div>
      </div>

      {app && overlay ? overlay(app) : null}
    </main>
  );
}
