import type { Ref } from "react";
import type { BoxConfig, LayerId } from "@/lib/box/types";
import { LAYER_ORDER } from "@/lib/box/types";
import { layoutLabels, LINE_HEIGHT, type TextSpec } from "@/engine/box/labels";
import type { EscapeRecord, Marker } from "@/engine/box/tally";

/** Ring label colours, inside out, as the design sets them; an off layer's label turns pink. */
const LABEL_HEX: Record<LayerId, string> = {
  sandbox: "#dbe6ff",
  permissions: "#c3d2f4",
  network: "#b6c8ee",
  monitor: "#a9bde6",
  audit: "#9fb3dc",
};

/** Shells the escapee must have crossed before each trail note shows. */
const NOTE_STAGE = { monitor: 4, audit: 5 } as const;

const halo = (k: number) => ({ paintOrder: "stroke", stroke: "#0a0d18", strokeWidth: 4 * k, whiteSpace: "pre" }) as const;

const at = (t: TextSpec) => ({ x: t.x, y: t.y, textAnchor: t.anchor, fontSize: t.fontSize, letterSpacing: t.letterSpacing || undefined });

function describe(config: BoxConfig, escape: EscapeRecord | null): string {
  const off = LAYER_ORDER.filter((l) => !config.layers[l]);
  const rings = off.length ? `Five nested containment rings; switched off: ${off.join(", ")}.` : "Five nested containment rings, all switched on.";
  return escape ? `${rings} One agent passed every ring that was on and cracked the outer one.` : `${rings} The crowd of agents sits in the middle.`;
}

/**
 * The text over the scene, in the design's 760x560 frame: one label per ring, the latest catch
 * markers' notes, and the escape trail's monitor score and audit outcome once the escapee has
 * crossed those shells. `layoutLabels` keeps them off each other and off the trail; `meet` scaling
 * matches the engine's camera, so text sits on its ring.
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
  // Every note is placed from the start, so markers do not jump as the escapee crosses each shell.
  const layout = layoutLabels({ config, markers, escape, k });
  return (
    <svg
      viewBox="0 0 760 560"
      preserveAspectRatio="xMidYMid meet"
      className="pointer-events-none absolute inset-0 h-full w-full select-none"
      role="img"
      aria-label={describe(config, escape)}
    >
      <g className="font-mono" style={halo(k)}>
        {layout.rings.map((l) => (
          <text key={l.layer} {...at(l)} fill={l.off ? "#ff8aa8" : LABEL_HEX[l.layer]} data-ring={l.layer}>
            {l.text}
          </text>
        ))}
        {layout.markers.map((l) => (
          <text key={l.marker.id} {...at(l)} fill={l.marker.kind === "flag" ? "#ffd59a" : "#dfe5ee"} data-marker={l.marker.kind}>
            {l.lines.length === 1
              ? l.text
              : l.lines.map((line, i) => (
                  <tspan key={i} x={l.x} dy={i === 0 ? 0 : LINE_HEIGHT * l.fontSize}>
                    {line}
                  </tspan>
                ))}
          </text>
        ))}
        {layout.notes.map((l) =>
          stage >= NOTE_STAGE[l.layer] ? (
            <text key={l.layer} {...at(l)} fill="#ffb3c6" data-trail={l.layer}>
              {l.text}
            </text>
          ) : null,
        )}
      </g>
    </svg>
  );
}

/** The rings' colours in the legend, as the map draws them (`--layer-1` to `--layer-5`). */
const LEGEND: [LayerId, string, string][] = [
  ["sandbox", "Sandbox", "text-layer-1"],
  ["permissions", "Permissions", "text-layer-2"],
  ["network", "Network", "text-layer-3"],
  ["monitor", "Monitor", "text-layer-4"],
  ["audit", "Audit", "text-layer-5"],
];

/** A small key in the scene's corner: which ring is which, inside out, and that a dashed ring is off. Text, not colour alone. `ref` lets the page measure it, so the map's labels keep off it. */
export function RingLegend({ ref }: { ref?: Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className="pointer-events-none absolute bottom-3.5 left-3.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-[10px] border border-panel-border bg-[rgba(7,9,16,0.92)] px-2.5 py-2 font-mono text-[10px] max-[914px]:hidden" data-ring-legend>
      <span className="mr-1 tracking-[0.14em] text-label uppercase">Rings, inside out</span>
      {LEGEND.map(([layer, name, tone], i) => (
        <span key={layer} className={tone}>
          {String(i + 1).padStart(2, "0")} {name}
        </span>
      ))}
      <span className="ml-1.5 text-escape-text">dashed = off</span>
    </div>
  );
}
