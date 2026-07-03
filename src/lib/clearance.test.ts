import { describe, it, expect } from 'vitest';
import { clearPassedStations } from './clearance';
import { px, py, type Point } from './routing';
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

const PARAMS = { clearance: 16, markerRadius: 13 };

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
