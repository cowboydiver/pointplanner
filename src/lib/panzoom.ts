/**
 * Pure pan/zoom math for the transit map. The map is an SVG with a fixed
 * `viewBox`; pan/zoom is applied as a `translate(x y) scale(k)` transform on a
 * wrapper <g>, so all coordinates here live in *viewBox units* (the same space
 * computeBounds produces), not screen pixels.
 */

export interface ViewTransform {
  /** scale factor */
  k: number;
  /** translation x, in viewBox units */
  x: number;
  /** translation y, in viewBox units */
  y: number;
}

export const MIN_SCALE = 0.4;
export const MAX_SCALE = 4;
export const IDENTITY: ViewTransform = { k: 1, x: 0, y: 0 };

export function clampScale(k: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, k));
}

/**
 * Zoom by `factor`, keeping the viewBox point (px, py) anchored under the same
 * screen position. With content coord c mapped to viewBox via `k*c + (x,y)`,
 * solving for the new translation that fixes (px, py) gives the formula below.
 */
export function zoomAt(t: ViewTransform, factor: number, px: number, py: number): ViewTransform {
  const k = clampScale(t.k * factor);
  const realFactor = k / t.k; // may differ from `factor` once clamped
  return {
    k,
    x: px * (1 - realFactor) + realFactor * t.x,
    y: py * (1 - realFactor) + realFactor * t.y,
  };
}

/** Pan by a delta expressed in viewBox units. */
export function panBy(t: ViewTransform, dx: number, dy: number): ViewTransform {
  return { k: t.k, x: t.x + dx, y: t.y + dy };
}

/** Serialize to an SVG transform attribute. */
export function toTransform(t: ViewTransform): string {
  return `translate(${t.x} ${t.y}) scale(${t.k})`;
}
