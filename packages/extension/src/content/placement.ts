/** Where to put a popup so it never covers the chat box. Pure math, unit tested. */

export interface Rect { top: number; bottom: number; left: number; right: number }
export interface Placement { left: number; top: number; width: number; maxHeight: number }

const GAP = 10;
const EDGE = 12;
const MIN_HEIGHT = 120;

export function computePlacement(anchor: Rect, viewW: number, viewH: number, boxH: number, boxW = 420): Placement {
  const width = Math.min(boxW, viewW - EDGE * 2);
  const left = Math.max(EDGE, Math.min(anchor.right - width, viewW - width - EDGE));
  const below = anchor.bottom + GAP;
  const spaceBelow = viewH - EDGE - below;
  const spaceAbove = anchor.top - GAP - EDGE;

  if (boxH <= spaceBelow) return { left, width, top: below, maxHeight: spaceBelow };
  if (boxH <= spaceAbove) return { left, width, top: anchor.top - GAP - boxH, maxHeight: spaceAbove };
  // Doesn't fit whole on either side: use the roomier side and let the popup scroll inside.
  if (spaceBelow >= spaceAbove) return { left, width, top: below, maxHeight: Math.max(spaceBelow, MIN_HEIGHT) };
  const maxHeight = Math.max(spaceAbove, MIN_HEIGHT);
  return { left, width, top: Math.max(EDGE, anchor.top - GAP - Math.min(boxH, maxHeight)), maxHeight };
}

/**
 * The visible chat box is often bigger than the text field inside it (a rounded
 * container with buttons). Use the enclosing form when there is a sensible one.
 */
export function visualBounds(el: Element): Rect {
  const own = el.getBoundingClientRect();
  const form = el.closest("form");
  if (form) {
    const f = form.getBoundingClientRect();
    if (f.height > 0 && f.height < window.innerHeight * 0.6) {
      return { top: Math.min(own.top, f.top), bottom: Math.max(own.bottom, f.bottom), left: Math.min(own.left, f.left), right: Math.max(own.right, f.right) };
    }
  }
  return own;
}
