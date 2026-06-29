import { describe, it, expect } from 'vitest';
import {
  legLine,
  paramOf,
  pointAt,
  laneOffset,
  bundleRegions,
  offsetCollinearLegs,
} from './bundling';
import type { Point } from './routing';
import type { Edge } from '../types';

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const samePoint = (p: Point, q: Point, eps = 1e-6) => near(p[0], q[0], eps) && near(p[1], q[1], eps);

describe('legLine — host-line canonicalization', () => {
  it('horizontal leg → family h, perpendicular normal', () => {
    const ll = legLine([0, 100], [300, 100])!;
    expect(ll.family).toBe('h');
    expect(ll.normal).toEqual([0, 1]);
  });

  it('vertical leg → family v', () => {
    const ll = legLine([50, 0], [50, 200])!;
    expect(ll.family).toBe('v');
    expect(ll.normal).toEqual([1, 0]);
  });

  it('slope +1 → d+, slope −1 → d-', () => {
    expect(legLine([0, 0], [10, 10])!.family).toBe('d+');
    expect(legLine([0, 0], [10, -10])!.family).toBe('d-');
  });

  it('degenerate (zero-length) leg → null', () => {
    expect(legLine([5, 5], [5, 5])).toBeNull();
  });

  it('same row hashes equal, adjacent rows do not', () => {
    expect(legLine([0, 100], [9, 100])!.key).toBe(legLine([20, 100], [30, 100])!.key);
    expect(legLine([0, 100], [9, 100])!.key).not.toBe(legLine([0, 101], [9, 101])!.key);
  });
});

describe('paramOf / pointAt — round-trip for every family', () => {
  const cases: Array<[string, Point, Point]> = [
    ['h', [0, 100], [300, 100]],
    ['v', [50, 0], [50, 200]],
    ['d+', [0, 0], [40, 40]],
    ['d-', [0, 0], [40, -40]],
  ];
  for (const [name, a, b] of cases) {
    it(`${name}: pointAt(paramOf(p)) === p for both endpoints`, () => {
      const ll = legLine(a, b)!;
      expect(samePoint(pointAt(ll, paramOf(ll, a)), a)).toBe(true);
      expect(samePoint(pointAt(ll, paramOf(ll, b)), b)).toBe(true);
    });
  }
});

describe('laneOffset — trunk fixed, others flank both sides', () => {
  it('rank 0 (trunk) stays on the centerline', () => {
    expect(laneOffset(0, 16)).toBe(0);
  });
  it('ranks alternate sides: +1, −1, +2, −2 …', () => {
    expect(laneOffset(1, 16)).toBe(16);
    expect(laneOffset(2, 16)).toBe(-16);
    expect(laneOffset(3, 16)).toBe(32);
    expect(laneOffset(4, 16)).toBe(-32);
  });
});

describe('bundleRegions — overlap detection + trunk assignment', () => {
  const laneRank = (order: string[]) => (line: string) => order.indexOf(line);

  it('finds the overlap interval and gives the first-in-order line offset 0', () => {
    const ll = legLine([0, 100], [1, 100])!;
    const legs = [
      { a: [0, 100] as Point, b: [300, 100] as Point, line: 'A' },
      { a: [100, 100] as Point, b: [400, 100] as Point, line: 'B' },
    ];
    const regions = bundleRegions(legs, ll, laneRank(['A', 'B']), 16);
    expect(regions).toHaveLength(1);
    expect(regions[0].lo).toBe(100);
    expect(regions[0].hi).toBe(300);
    expect(regions[0].offsetByLine.get('A')).toBe(0); // trunk
    expect(regions[0].offsetByLine.get('B')).toBe(16);
  });

  it('a single line on the host produces no region', () => {
    const ll = legLine([0, 100], [1, 100])!;
    const legs = [
      { a: [0, 100] as Point, b: [300, 100] as Point, line: 'A' },
      { a: [100, 100] as Point, b: [400, 100] as Point, line: 'A' },
    ];
    expect(bundleRegions(legs, ll, laneRank(['A']), 16)).toHaveLength(0);
  });
});

// --- offsetCollinearLegs ---------------------------------------------------

const edge = (from: string, to: string, line: string): Edge => ({ from, to, line });
type Routed = { edge: Edge; points: Point[] };

describe('offsetCollinearLegs — trunk-fixed lane offsetting', () => {
  it('leaves the trunk (first in order) untouched and offsets the other line', () => {
    const routed: Routed[] = [
      { edge: edge('a0', 'a1', 'A'), points: [[0, 100], [300, 100]] },
      { edge: edge('b0', 'b1', 'B'), points: [[100, 100], [400, 100]] },
    ];
    const out = offsetCollinearLegs(routed, { lanePitch: 16 }, ['A', 'B']);

    expect(out.has(0)).toBe(false); // trunk A unchanged → omitted
    const b = out.get(1)!;
    expect(b).toBeDefined();
    // starts and ends at the original endpoints (connectivity invariant)
    expect(samePoint(b[0], [100, 100])).toBe(true);
    expect(samePoint(b[b.length - 1], [400, 100])).toBe(true);
    // the interior runs in the +16 lane (below the centerline y=100)
    expect(b.some(p => near(p[1], 116))).toBe(true);
  });

  it('same-line overlap is not offset', () => {
    const routed: Routed[] = [
      { edge: edge('a0', 'a1', 'A'), points: [[0, 100], [300, 100]] },
      { edge: edge('a1', 'a2', 'A'), points: [[100, 100], [400, 100]] },
    ];
    expect(offsetCollinearLegs(routed, { lanePitch: 16 }, ['A']).size).toBe(0);
  });

  it('trunk is whichever line is first in lineOrder', () => {
    const routed: Routed[] = [
      { edge: edge('a0', 'a1', 'A'), points: [[0, 100], [300, 100]] },
      { edge: edge('b0', 'b1', 'B'), points: [[100, 100], [400, 100]] },
    ];
    // B declared first → B is the trunk, A gets a lane.
    const out = offsetCollinearLegs(routed, { lanePitch: 16 }, ['B', 'A']);
    expect(out.has(1)).toBe(false); // B unchanged
    expect(out.has(0)).toBe(true);  // A offset
  });

  it('a continuing line stays in its lane past where the other line ends — no center-in at the boundary', () => {
    // A (trunk) ends at x=200; B runs on to x=400. B must NOT peel back to the
    // centerline at x=200 (the region boundary) — it stays offset until its own
    // station, passing straight through. (The purple-touches-t2 regression.)
    const routed: Routed[] = [
      { edge: edge('a0', 'a1', 'A'), points: [[0, 100], [200, 100]] },
      { edge: edge('b0', 'b1', 'B'), points: [[0, 100], [400, 100]] },
    ];
    const b = offsetCollinearLegs(routed, { lanePitch: 16 }, ['A', 'B']).get(1)!;
    // Endpoints on the centerline (its own stations), everything between in-lane.
    expect(near(b[0][1], 100)).toBe(true);
    expect(near(b[b.length - 1][1], 100)).toBe(true);
    const interior = b.slice(1, -1);
    expect(interior.length).toBeGreaterThan(0);
    expect(interior.every(p => near(p[1], 116))).toBe(true);
    // No interior point sits back on the centerline at the old boundary x≈200.
    expect(interior.some(p => p[0] > 150 && p[0] < 250 && near(p[1], 100))).toBe(false);
  });

  it('a non-trunk line touches its own station on a shared run (notch to centre)', () => {
    // A trunk on the whole row; B has a station at x=200 mid-run (two edges
    // meeting there). B should return to the centerline exactly at x=200.
    const routed: Routed[] = [
      { edge: edge('a0', 'a1', 'A'), points: [[0, 100], [400, 100]] },
      { edge: edge('b0', 'b1', 'B'), points: [[0, 100], [200, 100]] },
      { edge: edge('b1', 'b2', 'B'), points: [[200, 100], [400, 100]] },
    ];
    const out = offsetCollinearLegs(routed, { lanePitch: 16 }, ['A', 'B']);
    const first = out.get(1)!;
    const second = out.get(2)!;
    // both B edges meet the shared station (200,100) on the centerline
    expect(samePoint(first[first.length - 1], [200, 100])).toBe(true);
    expect(samePoint(second[0], [200, 100])).toBe(true);
  });

  it('returns an empty map when nothing overlaps', () => {
    const routed: Routed[] = [
      { edge: edge('a0', 'a1', 'A'), points: [[0, 100], [300, 100]] },
      { edge: edge('b0', 'b1', 'B'), points: [[0, 200], [300, 200]] },
    ];
    expect(offsetCollinearLegs(routed, { lanePitch: 16 }, ['A', 'B']).size).toBe(0);
  });
});

describe('offsetCollinearLegs — join geometry', () => {
  it('a station notch is an exact 45° diagonal (along-run length === |offset|)', () => {
    const routed: Routed[] = [
      { edge: edge('a0', 'a1', 'A'), points: [[0, 100], [400, 100]] },
      { edge: edge('b0', 'b1', 'B'), points: [[0, 100], [400, 100]] },
    ];
    const b = offsetCollinearLegs(routed, { lanePitch: 16 }, ['A', 'B']).get(1)!;
    // [ [0,100], [16,116], [384,116], [400,100] ] — the notch spans 16px along x
    // to reach the 16px offset: a true 45°.
    expect(b).toHaveLength(4);
    expect(near(b[1][0] - b[0][0], 16)).toBe(true);
    expect(near(b[1][1] - b[0][1], 16)).toBe(true);
  });
});
