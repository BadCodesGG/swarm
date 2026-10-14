"use client";

import { useMemo, type CSSProperties } from "react";
import { layoutWorldLabels, type TextSpec } from "@/engine/box/labels";
import type { BoxOverlay } from "@/engine/box/overlay";
import type { LabId } from "@/lib/box/world-types";

const HALO = "0 0 3px #0a0d18, 0 0 3px #0a0d18, 0 0 6px #0a0d18";
const shift = (a: TextSpec["anchor"]) => (a === "middle" ? "-50%" : a === "end" ? "-100%" : "0");
const align = (a: TextSpec["anchor"]) => (a === "middle" ? "center" : a === "end" ? "right" : "left");

const textStyle = (t: TextSpec, color: string): CSSProperties => ({
  position: "absolute",
  left: t.x,
  top: t.y - t.fontSize * 0.95,
  transform: `translateX(${shift(t.anchor)})`,
  textAlign: align(t.anchor),
  whiteSpace: "pre",
  font: `${t.fontSize}px/1.2 var(--font-jetbrains), ui-monospace, monospace`,
  letterSpacing: t.letterSpacing,
  color,
  textShadow: HALO,
});

/**
 * The map's text and its numbered markers, drawn over the canvas in place of the engine's own DOM
 * (`app.showOverlay(false)`). Positions are the engine's projected CSS px, so a marker sits on the
 * step it names. Markers are real buttons; a lab's name selects that lab. Only meaningful for a map
 * of more than one lab; a lone Box keeps `SceneLabels`.
 */
export function WorldOverlay({
  overlay,
  shownLab,
  onPick,
  onLab,
}: {
  overlay: BoxOverlay;
  shownLab: LabId;
  onPick(n: number): void;
  onLab(id: LabId): void;
}) {
  const { frame, labs, links, markers, outside, trails } = overlay;
  const k = frame.width < 640 ? 1.25 : 1;
  const layout = useMemo(() => {
    const in_ = (p: { x: number; y: number }) => p.x >= frame.x && p.x <= frame.x + frame.width && p.y >= frame.y && p.y <= frame.y + frame.height;
    const shownMarkers = markers.filter((m) => m.shown && in_(m));
    const shownLabs = labs.filter((l) => l.x + l.r > frame.x && l.x - l.r < frame.x + frame.width && l.y + l.r > frame.y && l.y - l.r < frame.y + frame.height);
    const shownLinks = links.filter(in_);
    const out = outside && in_(outside) ? outside : null;
    const text = layoutWorldLabels({
      bounds: { x0: frame.x + 2, y0: frame.y + 2, x1: frame.x + frame.width - 2, y1: frame.y + frame.height - 2 },
      labs: shownLabs.map((l) => ({ id: l.id, name: l.name, status: l.status === "breached" ? "BREACHED" : "HELD", x: l.x, y: l.y, r: l.r })),
      links: shownLinks.map((l) => ({ index: l.index, name: l.name, x: l.x, y: l.y })),
      markers: shownMarkers.map((m) => ({ n: m.n, x: m.x, y: m.y })),
      outside: out,
      segments: trails,
      conduits: links.flatMap((l) => l.paths.map((points) => ({ link: l.index, points }))),
      k,
    });
    return { text, markers: shownMarkers, links: shownLinks };
  }, [frame, labs, links, markers, outside, trails, k]);

  if (!overlay.map) return null;
  return (
    <div
      className="pointer-events-none fixed inset-0 overflow-hidden"
      data-world-labels
      // Text that starts inside the scene may run past its edge: show only the scene.
      style={{ clipPath: `inset(${frame.y}px calc(100% - ${frame.x + frame.width}px) calc(100% - ${frame.y + frame.height}px) ${frame.x}px)` }}
    >
      {layout.text.labs.map((t) => {
        const lab = labs.find((l) => l.id === t.id)!;
        const breached = lab.status === "breached";
        return (
          <button
            key={t.id}
            type="button"
            data-lab-name={t.id}
            data-status={breached ? "breached" : "held"}
            aria-pressed={shownLab === t.id}
            aria-label={`${lab.name}, ${breached ? "breached" : "held"}. Show its layers`}
            onClick={() => onLab(t.id as LabId)}
            className="pointer-events-auto m-0 min-h-6 min-w-6 cursor-pointer border-0 bg-transparent p-0 font-bold focus-visible:rounded focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:outline-none"
            style={{ ...textStyle(t, "var(--ink-strong, #f6f8fc)"), fontWeight: 700, textDecoration: shownLab === t.id ? "underline" : "none", textUnderlineOffset: 3 }}
          >
            <span className="block">{t.lines[0]}</span>
            <span
              className="block"
              style={{ fontWeight: 400, fontSize: t.fontSize * 0.83, letterSpacing: t.fontSize * 0.16, color: breached ? "var(--escape-text, #ff8aa8)" : "var(--haiku, #7ee2a8)" }}
            >
              {t.lines[1]}
            </span>
          </button>
        );
      })}
      {layout.text.links.map((t) => {
        const link = links.find((l) => l.index === t.index)!;
        const color = link.lit === "crossed" ? "var(--escape-text, #ff8aa8)" : link.lit === "held" ? "var(--haiku, #7ee2a8)" : "var(--layer-3, #8fa9dd)";
        return (
          <div key={t.index} data-link-name={t.index} style={textStyle(t, color)}>
            {t.text}
          </div>
        );
      })}
      {layout.text.outside ? (
        <div data-outside style={textStyle(layout.text.outside, "var(--escape-text, #ff8aa8)")}>
          {layout.text.outside.text}
        </div>
      ) : null}
      {layout.markers.map((m) => (
        <button
          key={m.n}
          type="button"
          data-step-marker={m.n}
          aria-pressed={m.selected}
          aria-label={`Marker ${m.n}, tick ${m.tick}${m.step ? `: ${m.step.title}` : ""}. Press ${m.n <= 9 ? `${m.n} or ` : ""}Enter for the detail card`}
          onClick={() => onPick(m.n)}
          className="pointer-events-auto absolute m-0 flex h-11 w-11 cursor-pointer items-center justify-center rounded-full p-0 font-mono text-[13px] font-bold focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:ring-offset-2 focus-visible:ring-offset-ground focus-visible:outline-none"
          style={{
            left: m.x,
            top: m.y,
            margin: "-22px 0 0 -22px",
            background: m.selected ? "var(--escape, #ff4d7d)" : "rgba(7,9,16,0.85)",
            color: m.selected ? "#070910" : "var(--escape, #ff4d7d)",
            border: m.selected ? "2px solid #f6f8fc" : "1.5px solid var(--escape, #ff4d7d)",
            boxShadow: m.selected ? "0 0 18px var(--escape, #ff4d7d)" : undefined,
          }}
        >
          {m.n}
        </button>
      ))}
    </div>
  );
}
