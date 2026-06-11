import type { Edge, Station } from '../types';

export const PAD_X = 96;
export const COL = 152;
export const PAD_Y = 92;
export const ROW = 94;
export const CORNER_RADIUS = 18;

export function px(col: number): number {
  return PAD_X + col * COL;
}

export function py(row: number): number {
  return PAD_Y + row * ROW;
}

export type Point = [number, number];

/**
 * Compute the waypoints for a transit-style 45° routed edge.
 * df=true  → diagonal first, then straight along the longer axis
 * df=false → straight first along the longer axis, then 45° diagonal into target
 */
export function routePoints(edge: Edge, stationById: Record<string, Station>): Point[] {
  const a = stationById[edge.from];
  const b = stationById[edge.to];
  const x1 = px(a.col), y1 = py(a.row);
  const x2 = px(b.col), y2 = py(b.row);
  const dx = x2 - x1, dy = y2 - y1;
  const adx = Math.abs(dx), ady = Math.abs(dy);

  if (adx < 1 || ady < 1) return [[x1, y1], [x2, y2]]; // straight

  const sx = Math.sign(dx), sy = Math.sign(dy);
  const diag = Math.min(adx, ady);

  if (edge.df) {
    // diagonal first, then straight along the longer axis
    const mx = x1 + sx * diag;
    const my = y1 + sy * diag;
    return [[x1, y1], [mx, my], [x2, y2]];
  } else {
    // straight first along longer axis, then 45° diagonal into target
    if (adx >= ady) {
      const bx = x2 - sx * diag;
      return [[x1, y1], [bx, y1], [x2, y2]];
    } else {
      const by = y2 - sy * diag;
      return [[x1, y1], [x1, by], [x2, y2]];
    }
  }
}

export function norm(a: Point, b: Point): Point {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
}

export function dist(a: Point, b: Point): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/**
 * Convert an array of waypoints to an SVG path string with rounded corners.
 */
export function pointsToPath(pts: Point[], radius: number): string {
  if (pts.length < 3 || !radius) {
    return 'M' + pts.map(p => p[0] + ' ' + p[1]).join(' L ');
  }

  let d = 'M ' + pts[0][0] + ' ' + pts[0][1];

  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
    const v1 = norm(p1, p0), v2 = norm(p1, p2);
    const len1 = dist(p0, p1), len2 = dist(p1, p2);
    const r = Math.min(radius, len1 / 2, len2 / 2);
    const aIn: Point  = [p1[0] + v1[0] * r, p1[1] + v1[1] * r];
    const aOut: Point = [p1[0] + v2[0] * r, p1[1] + v2[1] * r];
    d += ' L ' + aIn[0] + ' ' + aIn[1];
    d += ' Q ' + p1[0] + ' ' + p1[1] + ' ' + aOut[0] + ' ' + aOut[1];
  }

  const last = pts[pts.length - 1];
  d += ' L ' + last[0] + ' ' + last[1];
  return d;
}
