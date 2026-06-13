import { describe, it, expect } from 'vitest';
import {
  IDENTITY,
  MIN_SCALE,
  MAX_SCALE,
  clampScale,
  zoomAt,
  panBy,
  toTransform,
} from './panzoom';

describe('clampScale', () => {
  it('keeps values within [MIN_SCALE, MAX_SCALE]', () => {
    expect(clampScale(1)).toBe(1);
    expect(clampScale(0.01)).toBe(MIN_SCALE);
    expect(clampScale(100)).toBe(MAX_SCALE);
  });
});

describe('zoomAt', () => {
  it('keeps the anchor point fixed in viewBox space', () => {
    const px = 300, py = 150;
    const next = zoomAt(IDENTITY, 2, px, py);
    // The content coord under the anchor maps back to the same viewBox point.
    const screenX = next.k * ((px - IDENTITY.x) / IDENTITY.k) + next.x;
    const screenY = next.k * ((py - IDENTITY.y) / IDENTITY.k) + next.y;
    expect(screenX).toBeCloseTo(px);
    expect(screenY).toBeCloseTo(py);
  });

  it('respects clamping when zooming out past the minimum', () => {
    const next = zoomAt({ k: MIN_SCALE, x: 0, y: 0 }, 0.5, 100, 100);
    expect(next.k).toBe(MIN_SCALE);
  });

  it('respects clamping when zooming in past the maximum', () => {
    const next = zoomAt({ k: MAX_SCALE, x: 0, y: 0 }, 2, 100, 100);
    expect(next.k).toBe(MAX_SCALE);
  });
});

describe('panBy', () => {
  it('adds the delta to the translation and leaves scale untouched', () => {
    expect(panBy({ k: 1.5, x: 10, y: 20 }, 5, -8)).toEqual({ k: 1.5, x: 15, y: 12 });
  });
});

describe('toTransform', () => {
  it('serializes to an SVG transform string', () => {
    expect(toTransform({ k: 2, x: 10, y: -5 })).toBe('translate(10 -5) scale(2)');
  });
});
