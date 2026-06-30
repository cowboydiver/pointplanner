import { describe, it, expect } from 'vitest';
import { routePoints, pointsToPath, resolveRouting, resolveDf, px, py, PAD_X, PAD_Y, COL, ROW, LANE_PITCH } from './routing';
import type { Station, Edge } from '../types';

function makeStation(id: string, col: number, row: number): Station {
  return {
    id, name: id, lines: ['design'], col, row, lp: 'top',
    status: 'locked', desc: '', owner: '', role: '', due: '', est: '', tags: [],
  };
}

function byId(...stations: Station[]): Record<string, Station> {
  const m: Record<string, Station> = {};
  stations.forEach(s => { m[s.id] = s; });
  return m;
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

describe('LANE_PITCH — bundled-lane spacing constant', () => {
  // Pinned like the other grid constants (CLAUDE.md): a change here is a deliberate
  // visual decision, so it should break a test rather than silently regress lanes.
  it('is the documented 16px', () => {
    expect(LANE_PITCH).toBe(16);
  });

  it('clears a passing station marker yet stays well inside a row', () => {
    // A non-trunk lane sits LANE_PITCH from the centre markers it passes. It must be
    // wide enough to read as separate from a passing marker (~11px radius) and narrow
    // enough that even the ±LANE_PITCH lanes of a 2-line bundle never reach the
    // adjacent grid row (ROW away). Both bounds couple the value to the grid.
    expect(LANE_PITCH).toBeGreaterThanOrEqual(11);
    expect(LANE_PITCH).toBeLessThan(ROW / 2);
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

describe('resolveRouting — derives df from geometry + graph shape', () => {
  it('same-row edge is straight (df=false) regardless of stored flag', () => {
    const a = makeStation('a', 0, 0);
    const b = makeStation('b', 2, 0);
    const edges: Edge[] = [{ from: 'a', to: 'b', line: 'design', df: true }];
    expect(resolveRouting(edges, byId(a, b))[0].df).toBe(false);
  });

  it('simple chain link with a row change stays diagonal-first', () => {
    const a = makeStation('a', 0, 0);
    const b = makeStation('b', 2, 1);
    const edges: Edge[] = [{ from: 'a', to: 'b', line: 'design' }];
    expect(resolveRouting(edges, byId(a, b))[0].df).toBe(true);
  });

  it('edges converging into a merge become straight-first (fan-in)', () => {
    // a and b (different rows) both feed c -> c is a merge
    const a = makeStation('a', 0, 0);
    const b = makeStation('b', 0, 2);
    const c = makeStation('c', 3, 1);
    const edges: Edge[] = [
      { from: 'a', to: 'c', line: 'design', df: true },
      { from: 'b', to: 'c', line: 'design', df: true },
    ];
    const out = resolveRouting(edges, byId(a, b, c));
    expect(out.every(e => e.df === false)).toBe(true);
  });

  it('edges branching out of one source stay diagonal-first (fan-out)', () => {
    // a feeds both b and c on different rows -> a is a branch
    const a = makeStation('a', 0, 1);
    const b = makeStation('b', 2, 0);
    const c = makeStation('c', 2, 2);
    const edges: Edge[] = [
      { from: 'a', to: 'b', line: 'design' },
      { from: 'a', to: 'c', line: 'design' },
    ];
    const out = resolveRouting(edges, byId(a, b, c));
    expect(out.every(e => e.df === true)).toBe(true);
  });

  it('does not mutate the input edges', () => {
    const a = makeStation('a', 0, 0);
    const b = makeStation('b', 2, 0);
    const edges: Edge[] = [{ from: 'a', to: 'b', line: 'design', df: true }];
    resolveRouting(edges, byId(a, b));
    expect(edges[0].df).toBe(true);
  });
});

describe('resolveDf — the single source of the diagonal-first bend rule', () => {
  it('is straight-first only for a pure converging merge (target merge, source not a branch)', () => {
    expect(resolveDf(true, false)).toBe(false);
  });

  it('is diagonal-first otherwise', () => {
    expect(resolveDf(false, false)).toBe(true); // plain chain link
    expect(resolveDf(false, true)).toBe(true); // pure fan-out branch
    expect(resolveDf(true, true)).toBe(true); // merge that is also a branch
  });
});
