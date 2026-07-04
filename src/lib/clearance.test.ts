import { describe, it, expect } from 'vitest';
import { clearPassedStations, clearLeg } from './clearance';
import { legLine, paramOf } from './bundling';
import { px, py, INTERCHANGE_MARKER_RADIUS, type Point } from './routing';
import type { Station, Edge } from '../types';

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const samePoint = (p: Point, q: Point, eps = 1e-6) => near(p[0], q[0], eps) && near(p[1], q[1], eps);

function mk(id: string, col: number, row: number, lines: string[]): Station {
  return {
    id, name: id, lines, col, row, lp: 'top',
    status: 'locked', desc: '', owner: '', role: '', due: '', est: '', tags: [],
  };
}

const edge = (from: string, to: string, line: string): Edge => ({ from, to, line });
type Routed = { edge: Edge; points: Point[] };

/** Shortest distance from point p to a polyline. */
function distToPath(p: Point, pts: Point[]): number {
  let min = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((p[0] - ax) * dx + (p[1] - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    min = Math.min(min, Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy)));
  }
  return min;
}

/** Linear-interpolated y of a polyline at x (first spanning segment). */
function yAt(pts: Point[], x: number): number {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    if (x >= Math.min(x0, x1) - 1e-9 && x <= Math.max(x0, x1) + 1e-9 && Math.abs(x1 - x0) > 1e-9) {
      return y0 + (y1 - y0) * ((x - x0) / (x1 - x0));
    }
  }
  return NaN;
}

const PARAMS = { clearance: 16, markerRadius: INTERCHANGE_MARKER_RADIUS };

describe('clearPassedStations — steps a line around stops it does not serve', () => {
  it('bumps a horizontal edge around an unrelated station it ran through', () => {
    // a(0,0)—c(2,0) on the qa line, straight through design-only b(1,0).
    const stations = [
      mk('a', 0, 0, ['design', 'qa']),
      mk('b', 1, 0, ['design']),
      mk('c', 2, 0, ['design', 'qa']),
    ];
    const routed: Routed[] = [
      { edge: edge('a', 'c', 'qa'), points: [[px(0), py(0)], [px(2), py(0)]] },
    ];
    const out = clearPassedStations(routed, stations, PARAMS);
    const pts = out.get(0)!;
    expect(pts).toBeDefined();

    const bCentre: Point = [px(1), py(0)];
    // ran straight through before (distance 0); now clears the marker.
    expect(distToPath(bCentre, [[px(0), py(0)], [px(2), py(0)]])).toBe(0);
    expect(distToPath(bCentre, pts)).toBeGreaterThan(PARAMS.markerRadius);
    // endpoints preserved (connectivity invariant).
    expect(samePoint(pts[0], [px(0), py(0)])).toBe(true);
    expect(samePoint(pts[pts.length - 1], [px(2), py(0)])).toBe(true);
  });

  it('leaves a line passing a station it DOES serve alone (legitimate stop)', () => {
    // Same geometry, but the crossing edge is the design line and b is a design
    // stop — the line correctly stops there, so no detour.
    const stations = [
      mk('a', 0, 0, ['design']),
      mk('b', 1, 0, ['design']),
      mk('c', 2, 0, ['design']),
    ];
    const routed: Routed[] = [
      { edge: edge('a', 'c', 'design'), points: [[px(0), py(0)], [px(2), py(0)]] },
    ];
    expect(clearPassedStations(routed, stations, PARAMS).size).toBe(0);
  });

  it('does not touch an edge whose endpoints are the only stations on its run', () => {
    const stations = [mk('a', 0, 0, ['qa']), mk('c', 2, 0, ['qa'])];
    const routed: Routed[] = [
      { edge: edge('a', 'c', 'qa'), points: [[px(0), py(0)], [px(2), py(0)]] },
    ];
    expect(clearPassedStations(routed, stations, PARAMS).size).toBe(0);
  });

  it('ignores a station that is near the run but off the line (a real crossing, not a stop)', () => {
    // b sits a full row away — the qa line only crosses it, never overlaps its marker.
    const stations = [
      mk('a', 0, 0, ['qa']),
      mk('b', 1, 1, ['design']),
      mk('c', 2, 0, ['qa']),
    ];
    const routed: Routed[] = [
      { edge: edge('a', 'c', 'qa'), points: [[px(0), py(0)], [px(2), py(0)]] },
    ];
    expect(clearPassedStations(routed, stations, PARAMS).size).toBe(0);
  });

  it('does not re-bump an already-offset (bundled) leg that clears the marker', () => {
    // Points sit LANE_PITCH (16) above the marker row — a bundled lane. 16 > 13,
    // so it is not a crossing and must be left as-is.
    const stations = [
      mk('a', 0, 0, ['qa']),
      mk('b', 1, 0, ['design']),
      mk('c', 2, 0, ['qa']),
    ];
    const y = py(0) - 16;
    const routed: Routed[] = [
      { edge: edge('a', 'c', 'qa'), points: [[px(0), y], [px(2), y]] },
    ];
    expect(clearPassedStations(routed, stations, PARAMS).size).toBe(0);
  });

  it('bumps a vertical edge around an unrelated station', () => {
    const stations = [
      mk('a', 0, 0, ['qa']),
      mk('b', 0, 1, ['design']),
      mk('d', 0, 2, ['qa']),
    ];
    const routed: Routed[] = [
      { edge: edge('a', 'd', 'qa'), points: [[px(0), py(0)], [px(0), py(2)]] },
    ];
    const pts = clearPassedStations(routed, stations, PARAMS).get(0)!;
    expect(pts).toBeDefined();
    expect(distToPath([px(0), py(1)], pts)).toBeGreaterThan(PARAMS.markerRadius);
  });

  it('clears every unrelated station on a longer run', () => {
    // qa a→e crosses design b, d (both unserved) and serves nothing between.
    const stations = [
      mk('a', 0, 0, ['qa']),
      mk('b', 1, 0, ['design']),
      mk('d', 2, 0, ['design']),
      mk('e', 3, 0, ['qa']),
    ];
    const routed: Routed[] = [
      { edge: edge('a', 'e', 'qa'), points: [[px(0), py(0)], [px(3), py(0)]] },
    ];
    const pts = clearPassedStations(routed, stations, PARAMS).get(0)!;
    expect(distToPath([px(1), py(0)], pts)).toBeGreaterThan(PARAMS.markerRadius);
    expect(distToPath([px(2), py(0)], pts)).toBeGreaterThan(PARAMS.markerRadius);
  });

  it('a plateau ramp is an exact 45° diagonal', () => {
    const stations = [
      mk('a', 0, 0, ['qa']),
      mk('b', 1, 0, ['design']),
      mk('c', 2, 0, ['qa']),
    ];
    const routed: Routed[] = [
      { edge: edge('a', 'c', 'qa'), points: [[px(0), py(0)], [px(2), py(0)]] },
    ];
    const pts = clearPassedStations(routed, stations, PARAMS).get(0)!;
    // first bend is the ramp up: equal |dx| and |dy|.
    const dx = Math.abs(pts[1][0] - pts[0][0]);
    // find the first point that leaves the centreline
    const off = pts.find(p => !near(p[1], py(0)))!;
    expect(off).toBeDefined();
    // ramp rises 16 over 16 px (45°)
    expect(near(Math.abs(off[1] - py(0)), 16)).toBe(true);
    expect(dx).toBeGreaterThan(0);
  });

  it('returns an empty map when nothing crosses', () => {
    const stations = [mk('a', 0, 0, ['qa']), mk('c', 2, 0, ['qa'])];
    const routed: Routed[] = [
      { edge: edge('a', 'c', 'qa'), points: [[px(0), py(0)], [px(2), py(0)]] },
    ];
    expect(clearPassedStations(routed, stations, PARAMS).size).toBe(0);
  });
});

// These two paths are load-bearing but can't arise from the current grid — a
// horizontal run spaces crossings ≥152px apart and a vertical one ≥94px, both far
// wider than the 4*unit (64px) merge window, and no two grid centres land on the
// same 45° line. Exercise them directly against `clearLeg` so the geometry is
// still guarded (per ADR 0008's "merged when too close" claim + diagonal support).
describe('clearLeg — merge-when-too-close and diagonal-host geometry', () => {
  it('merges two crossings closer than the dip window into one flat plateau', () => {
    const a: Point = [0, 100];
    const b: Point = [400, 100];
    const ll = legLine(a, b)!;
    // 20px apart, below 4*unit = 64px for a horizontal leg → a single merged span.
    const pts = clearLeg(a, b, ll, [190, 210], 16)!;
    expect(pts).toBeDefined();
    // one span → 6 waypoints (two spans would be 10); i.e. no dip back to centre.
    expect(pts).toHaveLength(6);
    // both markers cleared…
    expect(distToPath([190, 100], pts)).toBeGreaterThan(13);
    expect(distToPath([210, 100], pts)).toBeGreaterThan(13);
    // …and the line stays on the raised plateau (y=84) BETWEEN them, never at y=100.
    expect(near(yAt(pts, 200), 84)).toBe(true);
    expect(pts.filter(p => p[0] > 160 && p[0] < 240 && near(p[1], 100))).toHaveLength(0);
  });

  it('keeps two well-separated crossings as separate plateaus (contrast: no merge)', () => {
    const a: Point = [0, 100];
    const b: Point = [400, 100];
    const ll = legLine(a, b)!;
    // 200px apart → two independent spans, dipping back to centre between them.
    const pts = clearLeg(a, b, ll, [100, 300], 16)!;
    expect(pts).toHaveLength(10);
    expect(near(yAt(pts, 200), 100)).toBe(true); // back on the centreline mid-run
  });

  it('steps a diagonal (d+) leg around a crossing and holds clearance off-axis', () => {
    const a: Point = [0, 0];
    const b: Point = [200, 200]; // slope +1 → d+ host line
    const ll = legLine(a, b)!;
    const centre: Point = [100, 100]; // exactly on the leg
    const pts = clearLeg(a, b, ll, [paramOf(ll, centre)], 16)!;
    expect(pts).toBeDefined();
    expect(distToPath(centre, [a, b])).toBe(0);          // ran through the marker before
    expect(distToPath(centre, pts)).toBeGreaterThan(13); // cleared after stepping aside
    // endpoints preserved (connectivity invariant).
    expect(samePoint(pts[0], a)).toBe(true);
    expect(samePoint(pts[pts.length - 1], b)).toBe(true);
  });
});
