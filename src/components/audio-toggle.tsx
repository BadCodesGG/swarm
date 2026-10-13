"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { getAudio, subscribeAudio } from "@/engine/audio/handle";
import { readAudioPref, writeAudioPref, type AudioPref } from "@/engine/audio/pref";

/**
 * Sound switch for both HUDs; sound is off by default. Browsers only start audio from a gesture, so a saved "on" does not play
 * by itself: the button shows an armed state and the first click or key press anywhere starts it.
 */
export default function AudioToggle({ className = "" }: { className?: string }) {
  const audio = useSyncExternalStore(subscribeAudio, getAudio, () => null);
  // The engine that is currently sounding. Comparing by identity means a fresh engine (dev strict
  // mode mounts twice) is never mistaken for a running one.
  const [live, setLive] = useState<unknown>(null);
  const [pref, setPref] = useState<AudioPref>(() => readAudioPref());

  const on = audio !== null && live === audio;
  const armed = audio !== null && !on && pref === "on";

  useEffect(() => {
    if (!audio || !armed) return;
    const start = (e: Event) => {
      // Let the button's own click handle itself, or it would start sound and then switch it off.
      if (e.target instanceof Element && e.target.closest("[data-audio-toggle]")) return;
      void audio.enable().then((running) => {
        if (running) setLive(audio);
      });
    };
    window.addEventListener("click", start, true);
    window.addEventListener("keydown", start, true);
    return () => {
      window.removeEventListener("click", start, true);
      window.removeEventListener("keydown", start, true);
    };
  }, [audio, armed]);

  if (!audio) return null;

  const toggle = async () => {
    if (on) {
      audio.disable();
      setLive(null);
      writeAudioPref("off");
      setPref("off");
      return;
    }
    writeAudioPref("on");
    setPref("on");
    if (await audio.enable()) setLive(audio);
  };

  const state = on ? "on" : armed ? "armed" : "off";
  return (
    <button
      type="button"
      data-audio-toggle
      data-state={state}
      aria-pressed={on}
      aria-label="Sound on/off"
      title={on ? "Sound on" : armed ? "Sound on: click anywhere to start" : "Sound off"}
      onClick={toggle}
      className={`pointer-events-auto flex size-11 shrink-0 items-center justify-center rounded-xl border border-panel-border bg-panel text-label transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:outline-none aria-pressed:border-sonnet/45 aria-pressed:text-sonnet ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={armed ? "motion-safe:animate-pulse" : undefined}
      >
        <path d="M11 5 6 9H2v6h4l5 4V5z" />
        {on || armed ? (
          <>
            <path d="M15.5 8.5a5 5 0 0 1 0 7" />
            <path d="M18.5 5.5a9 9 0 0 1 0 13" />
          </>
        ) : (
          <>
            <path d="m22 9-6 6" />
            <path d="m16 9 6 6" />
          </>
        )}
      </svg>
    </button>
  );
}
