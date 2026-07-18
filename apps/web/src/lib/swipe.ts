// Phase 8.27 — shared, RTL-aware carousel-navigation math for the product
// gallery and the DocumentViewer lightbox (docs/image-handling.md §4).

/** Minimum horizontal travel for a drag to count as a swipe. */
export const SWIPE_THRESHOLD_PX = 40;

/**
 * Effective text direction at an element. The locale layout stamps
 * `<html dir>`, so the nearest `[dir]` ancestor is authoritative; computed
 * style is the fallback for detached/overridden subtrees.
 */
export function isRtl(el: Element): boolean {
  const withDir = el.closest('[dir]');
  if (withDir) return withDir.getAttribute('dir')?.toLowerCase() === 'rtl';
  return typeof getComputedStyle === 'function' && getComputedStyle(el).direction === 'rtl';
}

/**
 * Selection delta of a completed horizontal drag: +1 = next, -1 = previous,
 * 0 = not a swipe (below the threshold, or the vertical travel dominates —
 * page scrolling must stay untouched). Swiping towards the text start
 * (left in LTR, right in RTL) advances.
 */
export function swipeDelta(el: Element, dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dx) <= Math.abs(dy)) return 0;
  const delta = dx < 0 ? 1 : -1;
  return isRtl(el) ? (-delta as -1 | 1) : (delta as -1 | 1);
}

/**
 * Selection delta of an Arrow key press (WAI-ARIA carousel pattern):
 * the arrow pointing towards the text end advances.
 */
export function arrowKeyDelta(el: Element, key: string): -1 | 0 | 1 {
  const delta = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0;
  if (delta === 0) return 0;
  return isRtl(el) ? (-delta as -1 | 1) : (delta as -1 | 1);
}
