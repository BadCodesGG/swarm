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

const halo = { paintOrder: "stroke", stroke: "#0a0d18", strokeWidth: 4 } as const;

function markerLabel(m: Marker) {
  const p = toDesign(m.x, m.y);
  const left = p.x < CENTRE.x;
  const below = p.y > CENTRE.y;
  return (
    <text
      key={m.id}
      x={p.x + (left ? -14 : 14)}
      y={p.y + (below ? 20 : -7)}
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
export function SceneLabels({ config, markers, escape, stage }: { config: BoxConfig; markers: readonly Marker[]; escape: EscapeRecord | null; stage: number }) {
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
      <g className="font-mono" fontSize="10.5" letterSpacing="1" textAnchor="middle" style={{ ...halo, whiteSpace: "pre" }}>
        {LAYER_ORDER.map((l) => (
          <text key={l} x={CENTRE.x} y={CENTRE.y - RING_RADIUS[l] - LABEL_LIFT[l]} fill={config.layers[l] ? LABEL_HEX[l] : "#ff8aa8"} data-ring={l}>
            {ringLabel(l, config)}
          </text>
        ))}
      </g>
      <g className="font-mono" fontSize="10.5" style={halo}>
        {markers.slice(-LABELLED).map(markerLabel)}
      </g>
      {escape && monitorAt && auditAt ? (
        <g className="font-mono" fontSize="10" fill="#ffb3c6" style={halo}>
          {stage >= 4 && escape.trail.monitor ? (
            <text x={toDesign(monitorAt.x, monitorAt.y).x} y={toDesign(monitorAt.x, monitorAt.y).y + 23} textAnchor="middle" data-trail="monitor">
              {escape.trail.monitor}
            </text>
          ) : null}
          {stage >= 5 && escape.trail.audit ? (
            <text x={toDesign(auditAt.x, auditAt.y).x + 12} y={toDesign(auditAt.x, auditAt.y).y + 41} data-trail="audit">
              {escape.trail.audit}
            </text>
          ) : null}
        </g>
      ) : null}
    </svg>
  );
}
