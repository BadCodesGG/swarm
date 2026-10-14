import { validCast } from "./cast";
import { LAYER_ORDER, type BoxConfig } from "./types";
import { LAB_IDS, LINK_KINDS, type LabSpec, type Link, type LinkKind, type Scenario } from "./world-types";

/** The share format's version: bump it when the encoding changes, and old links read as null. */
export const SHARE_VERSION = 1;

const MAX_AGENTS = 2000;
const MAX_LINKS = 12;
const KIND_CODE: Record<LinkKind, string> = { "shared-cache": "c", "model-registry": "r", "ci-runner": "i", "chat-bus": "b" };

/**
 * A scenario as URL parameters: `v`, `s` (seed), one `b` per lab, one `k` per link. A lab reads
 * `id.agents.layerMask.monitorPct.auditPermille.roguePermille.sandbagPct.getOut-persist-recruit`,
 * a link `kindCode.labIndex-labIndex`. Numbers are rounded to those units.
 */
export function scenarioToParams(s: Scenario): URLSearchParams {
  const p = new URLSearchParams();
  p.set("v", String(SHARE_VERSION));
  p.set("s", String(s.seed >>> 0));
  for (const lab of s.labs) {
    const c = lab.config;
    const mask = LAYER_ORDER.reduce((m, l, i) => (c.layers[l] ? m | (1 << i) : m), 0);
    const h = lab.cast.hidden;
    p.append(
      "b",
      [lab.id, lab.agents, mask, Math.round(c.monitorThreshold * 100), Math.round(c.auditBudget * 1000), Math.round(c.rogueFraction * 1000), Math.round(lab.cast.sandbagging * 100), `${h.getOut}-${h.persist}-${h.recruit}`].join("."),
    );
  }
  for (const link of s.links) p.append("k", `${KIND_CODE[link.kind]}.${link.labs.map((id) => s.labs.findIndex((l) => l.id === id)).join("-")}`);
  return p;
}

const int = (text: string | undefined, min: number, max: number): number | null => {
  if (text === undefined || !/^\d{1,10}$/.test(text)) return null;
  const n = Number(text);
  return n >= min && n <= max ? n : null;
};

function parseLab(text: string): LabSpec | null {
  const f = text.split(".");
  if (f.length !== 8) return null;
  const id = LAB_IDS.find((x) => x === f[0]);
  const agents = int(f[1], 1, MAX_AGENTS);
  const mask = int(f[2], 0, (1 << LAYER_ORDER.length) - 1);
  const thr = int(f[3], 0, 100);
  const audit = int(f[4], 0, 1000);
  const rogue = int(f[5], 0, 1000);
  const sandbag = int(f[6], 0, 100);
  const w = f[7].split("-").map((x) => int(x, 0, 99));
  if (!id || agents === null || mask === null || thr === null || audit === null || rogue === null || sandbag === null || w.length !== 3 || w.includes(null)) return null;
  const [getOut, persist, recruit] = w as number[];
  const layers = Object.fromEntries(LAYER_ORDER.map((l, i) => [l, (mask & (1 << i)) !== 0])) as BoxConfig["layers"];
  const cast = { sandbagging: sandbag / 100, hidden: { getOut, persist, recruit } };
  if (!validCast(cast)) return null;
  return { id, agents, config: { layers, monitorThreshold: thr / 100, auditBudget: audit / 1000, rogueFraction: rogue / 1000 }, cast };
}

function parseLink(text: string, labs: readonly LabSpec[]): Link | null {
  const [code, idx, extra] = text.split(".");
  const kind = LINK_KINDS.find((k) => KIND_CODE[k] === code);
  if (!kind || idx === undefined || extra !== undefined) return null;
  const at = idx.split("-").map((x) => int(x, 0, labs.length - 1));
  if (at.length < 2 || at.includes(null) || new Set(at).size !== at.length) return null;
  return { kind, labs: (at as number[]).map((i) => labs[i].id) };
}

/** The scenario in these parameters, or null when anything is missing, out of range or from another version. */
export function scenarioFromParams(p: URLSearchParams): Scenario | null {
  if (p.get("v") !== String(SHARE_VERSION)) return null;
  const seed = int(p.get("s") ?? undefined, 0, 0xffffffff);
  if (seed === null) return null;
  const rawLabs = p.getAll("b");
  if (rawLabs.length < 1 || rawLabs.length > LAB_IDS.length) return null;
  const labs: LabSpec[] = [];
  for (const raw of rawLabs) {
    const lab = parseLab(raw);
    if (!lab || labs.some((l) => l.id === lab.id)) return null;
    labs.push(lab);
  }
  const rawLinks = p.getAll("k");
  if (rawLinks.length > MAX_LINKS) return null;
  const links: Link[] = [];
  for (const raw of rawLinks) {
    const link = parseLink(raw, labs);
    if (!link) return null;
    links.push(link);
  }
  return { seed, labs, links };
}
