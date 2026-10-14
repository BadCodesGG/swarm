"use client";

import { useMemo, type CSSProperties } from "react";
import { layoutWorldLabels, type TextSpec } from "@/engine/box/labels";
import type { BoxOverlay } from "@/engine/box/overlay";
import type { LabId } from "@/lib/box/world-types";
import { spreadPoints } from "./playground";

/** A marker button's side, and the room kept between two centres: past a side's diagonal, so two squares never touch however they lie. */
const BUTTON = 28;
const GAP = 40;
/** A button stays at least this far inside the slot's edge, centre to edge. */
const INSET = BUTTON / 2 + 2;
/** Under this slot width (CSS px) link names are left off the map and OUTSIDE shows only where it is clear. */
const SPARSE_BELOW = 480;

const tone = (kind: string) => (kind === "held" ? "var(--haiku, #7ee2a8)" : "var(--escape, #ff4d7d)");
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
  // A phone's slot: rings of about 40 px leave no clean spot for a link's name beside its conduit.
  const sparse = frame.width < SPARSE_BELOW;
  const layout = useMemo(() => {
    const in_ = (p: { x: number; y: number }, pad = 0) => p.x >= frame.x - pad && p.x <= frame.x + frame.width + pad && p.y >= frame.y - pad && p.y <= frame.y + frame.height + pad;
    // A button just past the slot's edge is pulled inside it rather than lost; one far off stays off.
    const visible = markers.filter((m) => m.shown && in_(m, BUTTON));
    const moved = spreadPoints(visible, GAP, { x0: frame.x + INSET, y0: frame.y + INSET, x1: frame.x + frame.width - INSET, y1: frame.y + frame.height - INSET });
    const shownMarkers = visible.map((m, i) => ({ ...m, bx: moved[i].x, by: moved[i].y }));
    const shownLabs = labs.filter((l) => l.x + l.r > frame.x && l.x - l.r < frame.x + frame.width && l.y + l.r > frame.y && l.y - l.r < frame.y + frame.height);
    const shownLinks = links.filter((l) => in_(l));
    const out = outside && in_(outside) ? outside : null;
    const text = layoutWorldLabels({
      bounds: { x0: frame.x + 2, y0: frame.y + 2, x1: frame.x + frame.width - 2, y1: frame.y + frame.height - 2 },
      labs: shownLabs.map((l) => ({ id: l.id, name: l.name, status: l.status === "breached" ? "BREACHED" : "HELD", x: l.x, y: l.y, r: l.r })),
      links: shownLinks.map((l) => ({ index: l.index, name: l.name, x: l.x, y: l.y })),
      markers: shownMarkers.map((m) => ({ n: m.n, x: m.bx, y: m.by })),
      outside: out,
      segments: trails,
      conduits: links.flatMap((l) => l.paths.map((points) => ({ link: l.index, points }))),
      k,
      sparse,
    });
    return { text, markers: shownMarkers, links: shownLinks };
  }, [frame, labs, links, markers, outside, trails, k, sparse]);

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
      <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
        {layout.markers
          .filter((m) => Math.hypot(m.bx - m.x, m.by - m.y) > 4)
          .map((m) => (
            <line key={m.n} x1={m.x} y1={m.y} x2={m.bx} y2={m.by} stroke="var(--escape, #ff4d7d)" strokeOpacity="0.6" strokeWidth="1" />
          ))}
      </svg>
      {layout.markers.map((m) => (
        <button
          key={m.n}
          type="button"
          data-step-marker={m.n}
          aria-pressed={m.selected}
          aria-label={`Marker ${m.n}, tick ${m.tick}${m.step ? `: ${m.step.title}` : ""}. Press ${m.n <= 9 ? `${m.n} or ` : ""}Enter for the detail card`}
          onClick={() => onPick(m.n)}
          className="pointer-events-auto absolute m-0 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full p-0 font-mono text-xs font-bold focus-visible:ring-2 focus-visible:ring-layer-1 focus-visible:ring-offset-2 focus-visible:ring-offset-ground focus-visible:outline-none"
          style={{
            left: m.bx,
            top: m.by,
            margin: `-${BUTTON / 2}px 0 0 -${BUTTON / 2}px`,
            // A refused reach is green and dashed, a breach pink and solid: never colour alone.
            background: m.selected ? tone(m.kind) : "rgba(7,9,16,0.88)",
            color: m.selected ? "#070910" : tone(m.kind),
            border: `${m.selected ? 2 : 1.5}px ${m.kind === "held" ? "dashed" : "solid"} ${m.selected ? "#f6f8fc" : tone(m.kind)}`,
            boxShadow: m.selected ? `0 0 14px ${tone(m.kind)}` : undefined,
          }}
        >
          {m.n}
        </button>
      ))}
    </div>
  );
}
