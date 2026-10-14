/**
 * Measures the Box's scene as Chromium drew it, for `shot-box.mjs` and `smoke-box.mjs`: the scene
 * slot, every visible scene label and marker button with its drawn box, the pairs that touch, the
 * boxes the slot's edge cuts, and the labs (centre and outer ring, from `__swarm.box.labs`) that
 * are not wholly inside the slot. All CSS px of the page.
 */

export const SCENE_TEXT = "[data-ring], [data-marker], [data-trail], [data-lab-name], [data-link-name], [data-outside], [data-step-marker]";

export async function measureScene(page) {
  return page.evaluate((selector) => {
    // The engine keeps hidden copies of the map text while the page draws it; hidden text overlaps nothing.
    const q = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden");
    const slotRect = document.querySelector("[data-scene-slot]")?.getBoundingClientRect() ?? null;
    const slot = slotRect ? { left: slotRect.left, top: slotRect.top, right: slotRect.right, bottom: slotRect.bottom, width: slotRect.width, height: slotRect.height } : null;
    const boxes = q(selector).map((e) => {
      const r = e.getBoundingClientRect();
      return { text: e.textContent, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    });
    const clashes = [];
    boxes.forEach((a, i) => {
      for (const b of boxes.slice(i + 1)) {
        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) clashes.push(`"${a.text}" / "${b.text}"`);
      }
    });
    // A pixel of tolerance: the engine rounds its positions and a clamped box can sit on the edge.
    const T = 1;
    const cut = slot ? boxes.filter((b) => b.left < slot.left - T || b.right > slot.right + T || b.top < slot.top - T || b.bottom > slot.bottom + T).map((b) => `"${b.text}"`) : [];
    const labs = (window.__swarm?.box?.labs ?? []).map((l) => ({ id: l.id, x: l.x, y: l.y, r: l.r }));
    const labsCut = slot ? labs.filter((l) => l.x - l.r < slot.left - T || l.x + l.r > slot.right + T || l.y - l.r < slot.top - T || l.y + l.r > slot.bottom + T).map((l) => l.id) : labs.map((l) => l.id);
    return { slot, boxes, clashes, cut, labs, labsCut };
  }, SCENE_TEXT);
}
