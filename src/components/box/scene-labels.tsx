import type { BoxConfig, LayerId } from "@/lib/box/types";
import { LAYER_ORDER } from "@/lib/box/types";
import { CENTRE, RING_RADIUS, toDesign } from "@/engine/box/layout";
import { ringLabel } from "@/engine/box/explain";
import type { EscapeRecord, Marker } from "@/engine/box/tally";

/** Ring label colours, inside out, as the design sets them; an off layer's label turns pink. */
const LABEL_HEX: Record<LayerId, string> = {
  sandbox: "#dbe6ff",
  permissions: "#c3d2f4",
  network: "#b6c8ee",
  monitor: "#a9bde6",
  audit: "#9fb3dc",
};
/** Baseline gap above each ring's top, design px. */
const LABEL_LIFT: Record<LayerId, number> = { sandbox: 6, permissions: 5, network: 5, monitor: 5, audit: 5 };
/** Markers that carry a text label at once; older ones keep only their mark. */
const LABELLED = 3;

/** Two labels closer than this (design px) would overprint; only the newer keeps its text. */
const LABEL_GAP = 40;

const halo = (k: number) => ({ paintOrder: "stroke", stroke: "#0a0d18", strokeWidth: 4 * k }) as const;

/** The newest markers to label, newest first, skipping any that would sit on a newer one. */
function labelled(markers: readonly Marker[]): Marker[] {
  const out: Marker[] = [];
  for (let i = markers.length - 1; i >= 0 && out.length < LABELLED; i--) {
    const m = markers[i];
    if (out.every((o) => Math.hypot(o.x - m.x, o.y - m.y) >= LABEL_GAP)) out.push(m);
  }
  return out;
}

function markerLabel(m: Marker, k: number) {
  const p = toDesign(m.x, m.y);
  const left = p.x < CENTRE.x;
  const below = p.y > CENTRE.y;
  return (
    <text
      key={m.id}
      x={p.x + (left ? -14 : 14) * k}
      y={p.y + (below ? 20 : -7) * k}
      textAnchor={left ? "end" : "start"}
      fill={m.kind === "flag" ? "#ffd59a" : "#dfe5ee"}
      data-marker={m.kind}
    >
      {m.label}
    </text>
  );
}

function describe(config: BoxConfig, escape: EscapeRecord | null): string {
  const off = LAYER_ORDER.filter((l) => !config.layers[l]);
  const rings = off.length ? `Five nested containment rings; switched off: ${off.join(", ")}.` : "Five nested containment rings, all switched on.";
  return escape ? `${rings} One agent passed every ring that was on and cracked the outer one.` : `${rings} The crowd of agents sits in the middle.`;
}

/**
 * The text over the scene, in the design's 760x560 frame: one label per ring, the latest catch
 * markers' notes, and the escape trail's monitor score and audit outcome once the escapee has
 * crossed those shells. `meet` scaling matches the engine's camera, so text sits on its ring.
 */
export function SceneLabels({
  config,
  markers,
  escape,
  stage,
  textScale = 1,
}: {
  config: BoxConfig;
  markers: readonly Marker[];
  escape: EscapeRecord | null;
  stage: number;
  /** Text grows by this on a small scene, where the design's 10.5 px would shrink past reading. */
  textScale?: number;
}) {
  const k = textScale;
  const monitorAt = escape?.path.crossings[3];
  const auditAt = escape?.path.crossings[4];
  return (
    <svg
      viewBox="0 0 760 560"
      preserveAspectRatio="xMidYMid meet"
      className="pointer-events-none absolute inset-0 h-full w-full select-none"
      role="img"
      aria-label={describe(config, escape)}
    >
      <g className="font-mono" fontSize={10.5 * k} letterSpacing={k} textAnchor="middle" style={{ ...halo(k), whiteSpace: "pre" }}>
        {LAYER_ORDER.map((l) => (
          <text key={l} x={CENTRE.x} y={CENTRE.y - RING_RADIUS[l] - LABEL_LIFT[l]} fill={config.layers[l] ? LABEL_HEX[l] : "#ff8aa8"} data-ring={l}>
            {ringLabel(l, config)}
          </text>
        ))}
      </g>
      <g className="font-mono" fontSize={10.5 * k} style={halo(k)}>
        {labelled(markers).map((m) => markerLabel(m, k))}
      </g>
      {escape && monitorAt && auditAt ? (
        <g className="font-mono" fontSize={10 * k} fill="#ffb3c6" style={halo(k)}>
          {stage >= 4 && escape.trail.monitor ? (
            <text x={toDesign(monitorAt.x, monitorAt.y).x} y={toDesign(monitorAt.x, monitorAt.y).y + 10 + 13 * k} textAnchor="middle" data-trail="monitor">
              {escape.trail.monitor}
            </text>
          ) : null}
          {stage >= 5 && escape.trail.audit ? (
            // Beside the crack as the design has it; centred under it once larger text would run off the frame.
            <text
              x={toDesign(auditAt.x, auditAt.y).x + (k > 1 ? 0 : 12)}
              y={toDesign(auditAt.x, auditAt.y).y + 28 + 13 * k}
              textAnchor={k > 1 ? "middle" : "start"}
              data-trail="audit"
            >
              {escape.trail.audit}
            </text>
          ) : null}
        </g>
      ) : null}
    </svg>
  );
}
