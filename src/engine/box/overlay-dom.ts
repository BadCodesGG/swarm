/**
 * The map's text and its numbered markers as plain DOM over the canvas, so the map reads (and the
 * markers click) without the page's own overlay. It mounts beside the canvas, never takes a click
 * except on a marker's button, and hides itself when the page asks (`app.showOverlay(false)`) or the
 * world is a lone lab, which the page's own scene labels already cover.
 *
 * Positions come from `BoxOverlay` (CSS px, projected); where the names go is `layoutWorldLabels`.
 */

import { layoutWorldLabels, type TextSpec } from "./labels";
import type { BoxOverlay } from "./overlay";

export interface OverlayDom {
  update(o: BoxOverlay, k: number): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

const FONT = "var(--font-jetbrains), ui-monospace, monospace";
const INK = "var(--ink-strong, #f6f8fc)";
const PINK = "var(--escape, #ff4d7d)";
const PINK_TEXT = "var(--escape-text, #ff8aa8)";
const GREEN = "var(--haiku, #7ee2a8)";
const BLUE = "var(--layer-3, #8fa9dd)";
const HALO = "0 0 3px #0a0d18, 0 0 3px #0a0d18, 0 0 6px #0a0d18";

/** The button's face for a step: breach pink, or held green; the selected one is filled. */
function markerStyle(selected: boolean, held: boolean): string {
  const tone = held ? GREEN : PINK;
  const face = selected
    ? `background:${tone};color:#070910;border:2px solid #f6f8fc;box-shadow:0 0 18px ${tone}`
    : `background:rgba(7,9,16,0.85);color:${tone};border:1.5px solid ${tone}`;
  return `position:absolute;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;padding:0;cursor:pointer;pointer-events:auto;font:700 13px ${FONT};display:flex;align-items:center;justify-content:center;${face}`;
}

const anchorShift = (a: TextSpec["anchor"]) => (a === "middle" ? "-50%" : a === "end" ? "-100%" : "0");
const alignOf = (a: TextSpec["anchor"]) => (a === "middle" ? "center" : a === "end" ? "right" : "left");

/** Sets a style string only when it changed, so a still frame costs no style recalculation. */
function put(el: HTMLElement, css: string, text?: string): void {
  if (el.dataset.css !== css) {
    el.dataset.css = css;
    el.style.cssText = css;
  }
  if (text !== undefined && el.textContent !== text) el.textContent = text;
}

export function mountOverlay(canvas: HTMLCanvasElement, onPick: (n: number) => void): OverlayDom {
  const root = document.createElement("div");
  root.dataset.worldOverlay = "";
  root.style.cssText = "position:fixed;inset:0;pointer-events:none;overflow:hidden";
  canvas.after(root);
  const els = new Map<string, HTMLElement>();
  let visible = true;
  let kind = "";

  const get = (key: string, make: () => HTMLElement): HTMLElement => {
    let el = els.get(key);
    if (!el) {
      el = make();
      root.appendChild(el);
      els.set(key, el);
    }
    return el;
  };
  const div = (attr: string, value: string) => () => {
    const el = document.createElement("div");
    el.setAttribute(attr, value);
    return el;
  };

  /** A block of text laid where `layoutWorldLabels` put it. */
  const textCss = (t: TextSpec, color: string, extra = "") =>
    `position:absolute;left:${t.x.toFixed(1)}px;top:${(t.y - t.fontSize * 0.95).toFixed(1)}px;transform:translateX(${anchorShift(t.anchor)});text-align:${alignOf(t.anchor)};white-space:pre;font:${t.fontSize.toFixed(2)}px/1.2 ${FONT};letter-spacing:${t.letterSpacing.toFixed(2)}px;color:${color};text-shadow:${HALO};${extra}`;

  return {
    setVisible(next) {
      visible = next;
      root.style.display = next ? "" : "none";
    },
    update(o, k) {
      const show = visible && o.map;
      root.style.display = show ? "" : "none";
      if (!show) return;
      const slot = { x0: o.frame.x, y0: o.frame.y, x1: o.frame.x + o.frame.width, y1: o.frame.y + o.frame.height };
      const inSlot = (p: { x: number; y: number }) => p.x >= slot.x0 && p.x <= slot.x1 && p.y >= slot.y0 && p.y <= slot.y1;
      const markers = o.markers.filter((m) => m.shown && inSlot(m));
      const labs = o.labs.filter((l) => l.x + l.r > slot.x0 && l.x - l.r < slot.x1 && l.y + l.r > slot.y0 && l.y - l.r < slot.y1);
      const links = o.links.filter(inSlot);
      const outside = o.outside && inSlot(o.outside) ? o.outside : null;
      const layout = layoutWorldLabels({
        bounds: { x0: slot.x0 + 2, y0: slot.y0 + 2, x1: slot.x1 - 2, y1: slot.y1 - 2 },
        labs: labs.map((l) => ({ id: l.id, name: l.name, status: l.status === "breached" ? "BREACHED" : "HELD", x: l.x, y: l.y, r: l.r })),
        links: links.map((l) => ({ index: l.index, name: l.name, x: l.x, y: l.y })),
        markers: markers.map((m) => ({ n: m.n, x: m.x, y: m.y })),
        outside,
        k,
      });

      // Rebuild the children when what is on show changes kind, so stale elements go.
      const now = [labs.map((l) => l.id), links.map((l) => l.index), markers.map((m) => m.n), outside ? 1 : 0].join("|");
      if (now !== kind) {
        kind = now;
        const keep = new Set<string>([...labs.map((l) => `lab:${l.id}`), ...links.map((l) => `link:${l.index}`), ...markers.map((m) => `marker:${m.n}`), ...(outside ? ["outside"] : [])]);
        for (const [key, el] of els) {
          if (!keep.has(key)) {
            el.remove();
            els.delete(key);
          }
        }
      }

      for (const t of layout.labs) {
        const lab = labs.find((l) => l.id === t.id)!;
        const el = get(`lab:${t.id}`, div("data-lab-name", t.id));
        const breached = lab.status === "breached";
        put(el, textCss(t, INK, "font-weight:700"));
        if (el.childElementCount !== 2) {
          el.replaceChildren(document.createElement("div"), document.createElement("div"));
        }
        const [name, status] = [el.children[0] as HTMLElement, el.children[1] as HTMLElement];
        put(name, "", t.lines[0]);
        put(status, `font-weight:400;font-size:${(t.fontSize * 0.83).toFixed(2)}px;letter-spacing:${(t.fontSize * 0.16).toFixed(2)}px;color:${breached ? PINK_TEXT : GREEN}`, t.lines[1]);
        el.dataset.status = breached ? "breached" : "held";
      }
      for (const t of layout.links) {
        const link = links.find((l) => l.index === t.index)!;
        const color = link.lit === "crossed" ? PINK_TEXT : link.lit === "held" ? GREEN : BLUE;
        put(get(`link:${t.index}`, div("data-link-name", String(t.index))), textCss(t, color), t.text);
      }
      if (layout.outside) put(get("outside", div("data-outside", "")), textCss(layout.outside, PINK_TEXT), layout.outside.text);
      for (const m of markers) {
        const el = get(`marker:${m.n}`, () => {
          const b = document.createElement("button");
          b.type = "button";
          b.dataset.stepMarker = String(m.n);
          b.addEventListener("click", () => onPick(m.n));
          return b;
        }) as HTMLButtonElement;
        put(el, `${markerStyle(m.selected, false)};left:${m.x.toFixed(1)}px;top:${m.y.toFixed(1)}px`, String(m.n));
        el.setAttribute("aria-label", `Marker ${m.n}, tick ${m.tick}${m.step ? `: ${m.step.title}` : ""}`);
        el.setAttribute("aria-pressed", String(m.selected));
      }
    },
    dispose() {
      root.remove();
      els.clear();
    },
  };
}
