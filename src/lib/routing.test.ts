import { describe, it, expect } from 'vitest';
import { routePoints, pointsToPath, px, py, PAD_X, PAD_Y, COL, ROW } from './routing';
import type { Station } from '../types';

function makeStation(id: string, col: number, row: number): Station {
  return {
    id, name: id, lines: ['design'], col, row, lp: 'top',
    status: 'locked', desc: '', owner: '', role: '', due: '', est: '', tags: [],
  };
}

describe('px / py helpers', () => {
  it('col 0 = PAD_X', () => {
    expect(px(0)).toBe(PAD_X);
  });
  it('col 1 = PAD_X + COL', () => {
    expect(px(1)).toBe(PAD_X + COL);
  });
  it('row 0 = PAD_Y', () => {
    expect(py(0)).toBe(PAD_Y);
  });
  it('row 2 = PAD_Y + 2*ROW', () => {
    expect(py(2)).toBe(PAD_Y + 2 * ROW);
  });
});

describe('routePoints — straight (same row or same col)', () => {
  it('same row returns 2 points with identical y', () => {
    const a = makeStation('a', 0, 0);
    const b = makeStation('b', 2, 0);
    const pts = routePoints({ from: 'a', to: 'b', line: 'design' }, { a, b });
    expect(pts).toHaveLength(2);
    expect(pts[0][1]).toBe(pts[1][1]);
  });

  it('same col returns 2 points with identical x', () => {
    const a = makeStation('a', 1, 0);
    const b = makeStation('b', 1, 3);
    const pts = routePoints({ from: 'a', to: 'b', line: 'design' }, { a, b });
    expect(pts).toHaveLength(2);
    expect(pts[0][0]).toBe(pts[1][0]);
  });
});

describe('routePoints — diagonal-first (df=true)', () => {
  it('produces 3 waypoints', () => {
    const a = makeStation('a', 0, 0);
    const b = makeStation('b', 2, 3);
    const pts = routePoints({ from: 'a', to: 'b', line: 'design', df: true }, { a, b });
    expect(pts).toHaveLength(3);
  });

  it('first segment is diagonal (dx == dy)', () => {
    const a = makeStation('a', 0, 0);
    const b = makeStation('b', 2, 3);
    const pts = routePoints({ from: 'a', to: 'b', line: 'design', df: true }, { a, b });
    const dxSeg1 = Math.abs(pts[1][0] - pts[0][0]);
    const dySeg1 = Math.abs(pts[1][1] - pts[0][1]);
    expect(dxSeg1).toBe(dySeg1);
  });

  it('endpoint matches target station coordinates', () => {
    const a = makeStation('a', 1, 2);
    const b = makeStation('b', 3, 4);
    const pts = routePoints({ from: 'a', to: 'b', line: 'design', df: true }, { a, b });
    expect(pts[pts.length - 1][0]).toBeCloseTo(px(3));
    expect(pts[pts.length - 1][1]).toBeCloseTo(py(4));
  });
});

describe('routePoints — straight-first (df=false)', () => {
  it('produces 3 waypoints when both dx and dy are nonzero', () => {
    const a = makeStation('a', 0, 0);
    const b = makeStation('b', 3, 1);
    const pts = routePoints({ from: 'a', to: 'b', line: 'design', df: false }, { a, b });
    expect(pts).toHaveLength(3);
  });

  it('when dx > dy: first segment is horizontal (same y)', () => {
    const a = makeStation('a', 0, 0);
    const b = makeStation('b', 3, 1);
    const pts = routePoints({ from: 'a', to: 'b', line: 'design', df: false }, { a, b });
    // straight first → pts[0] and pts[1] share the same y
    expect(pts[0][1]).toBe(pts[1][1]);
  });

  it('when dy > dx: first segment is vertical (same x)', () => {
    const a = makeStation('a', 0, 0);
    const b = makeStation('b', 1, 3);
    const pts = routePoints({ from: 'a', to: 'b', line: 'design', df: false }, { a, b });
    // straight first vertically → pts[0] and pts[1] share the same x
    expect(pts[0][0]).toBe(pts[1][0]);
  });
});

describe('pointsToPath', () => {
  it('two points → M...L... string', () => {
    const d = pointsToPath([[0, 0], [100, 0]], 18);
    expect(d).toContain('M');
    expect(d).toContain('0 0');
    expect(d).toContain('100 0');
  });

  it('three points with radius → contains Q (quadratic bezier)', () => {
    const d = pointsToPath([[0, 0], [100, 0], [100, 100]], 18);
    expect(d).toContain('Q');
  });

  it('zero radius → straight lines only (no Q)', () => {
    const d = pointsToPath([[0, 0], [100, 0], [100, 100]], 0);
    expect(d).not.toContain('Q');
  });
});
