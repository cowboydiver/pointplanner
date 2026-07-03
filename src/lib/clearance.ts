import type { Edge, Station } from '../types';
import { legLine, paramOf, pointAt, type LegLine } from './bundling';
import { px, py, dist, type Point } from './routing';

/**
 * Route edges clear of the station markers they merely pass over.
 *
 * Layout (ADR 0006) keeps most lines strand-like, but ordering alone does not
 * *guarantee* a straight run never clips an unrelated station — the residual case
 * 0006 accepted verbatim: a transitive `a→b→c` plus a direct `a→c`, where `b`
 * lands on the `a→c` run. With no white casing (lines are continuous colored
 * strokes and stations are filled markers), a colored line passing dead-centre
 * through a marker reads as *stopping* there — a false stop.
 *
 * This is the compaction-aware, render-time follow-up 0006 left open, and the
 * sibling of the bundling pass (ADR 0007): a pure pixel-space rewrite of the
 * already-routed waypoints that layout keeps untouched. Where an edge's straight
 * leg crosses a station its own line does NOT serve, the leg is nudged into a
 * short parallel plateau — a 45° ramp up, a flat run clear of the marker, a 45°
 * ramp back — so the line visibly steps around the stop instead of through it.
 * The plateau shares the routing corner radius (via `pointsToPath`), so it reads
 * as ordinary bends, exactly like a bundling lane join.
 *
 * A line passing through a station it *does* serve is a legitimate stop and is
 * left alone (that station carries this line via its own edges), which is also
 * why a same-line `a→c` that coincides with `a→b→c` is never disturbed — those
 * legs are collinear same-line overlap, not a false stop.
 *
 * It runs AFTER bundling on each edge's effective waypoints: a bundled non-trunk
 * lane already sits a marker-clearing `LANE_PITCH` off the centre, so only the
 * trunk / un-bundled legs that still run through a marker are rewritten here.
 */

const EPS = 1e-6;

export interface ClearanceParams {
  /** Perpendicular plateau offset (px). Must exceed a station marker's radius so
   *  the flat run clears it; the shipped value is `LANE_PITCH` (16), the same
   *  marker-clearing distance a bundled lane uses (ADR 0007). */
  clearance: number;
  /** A station whose centre is within this many px of a leg (perpendicular) counts
   *  as crossed. Set to the largest marker radius (the interchange marker, 13) so a
   *  bundled lane sitting `clearance` (16) away is never mistaken for a crossing. */
  markerRadius: number;
}

/**
 * Screen distance covered per unit of param along the host line — 1 axis-aligned,
 * √2 for the diagonals (their param is (x±y)/2). Sizing the ramp and plateau in
 * param by `offset / spp` keeps their *screen* length equal to the offset, so a
 * ramp is an exact 45° and reads as one shared corner (mirrors `bundling.ts`).
 */
function screenPerParam(family: LegLine['family']): number {
  return family === 'h' || family === 'v' ? 1 : Math.SQRT2;
}

interface ControlPoint {
  param: number;
  off: number;
}

/**
 * Rewrite one leg so it steps around the given crossed-station params. The leg
 * returns to the centreline (offset 0) at both ends — its endpoints are shared
 * routing bends / real stops and must not move — so each leg is independent and
 * the caller can splice the results with no boundary reconciliation.
 *
 * Returns null if the leg is unchanged (no reachable crossings).
 */
function clearLeg(
  a: Point,
  b: Point,
  ll: LegLine,
  targets: number[],
  clearance: number,
): Point[] | null {
  const pa = paramOf(ll, a);
  const pb = paramOf(ll, b);
  const lo = Math.min(pa, pb);
  const hi = Math.max(pa, pb);
  const flip = pa > pb;

  const spp = screenPerParam(ll.family);
  const unit = clearance / spp; // ramp length and plateau half-width, in param

  // A plateau (with its ramps) around a crossed station spans `2*unit` of ramp
  // plus `2*unit` of flat top. Keep only stations with room to host that inside
  // the leg; grid spacing (≥94px) dwarfs the footprint (≥4*clearance), so an
  // interior crossing always fits — this just guards degenerate short legs.
  const inside = targets
    .filter(p => p > lo + EPS && p < hi - EPS && p - 2 * unit > lo - EPS && p + 2 * unit < hi + EPS)
    .sort((x, y) => x - y);
  if (!inside.length) return null;

  // Merge crossings whose plateaus touch, or are too close to dip back to the
  // centreline between them (< a ramp down + a ramp up), into one flat span.
  const spans: Array<{ s: number; e: number }> = [];
  for (const p of inside) {
    const s = p - unit;
    const e = p + unit;
    const last = spans[spans.length - 1];
    if (last && s - last.e < 2 * unit) last.e = e;
    else spans.push({ s, e });
  }

  const cps: ControlPoint[] = [];
  const push = (cp: ControlPoint) => {
    const prev = cps[cps.length - 1];
    if (prev && Math.abs(prev.param - cp.param) < EPS && Math.abs(prev.off - cp.off) < EPS) return;
    cps.push(cp);
  };
  // Plateaus flank the centreline on one fixed side (negative normal) — the
  // side never matters for marker clearance (no grid station sits `clearance`
  // off a row/column), so a single deterministic choice keeps it simple.
  const D = -clearance;
  push({ param: lo, off: 0 });
  for (const span of spans) {
    push({ param: span.s - unit, off: 0 });
    push({ param: span.s, off: D });
    push({ param: span.e, off: D });
    push({ param: span.e + unit, off: 0 });
  }
  push({ param: hi, off: 0 });

  let pts: Point[] = cps.map(cp => {
    const base = pointAt(ll, cp.param);
    return [base[0] + ll.normal[0] * cp.off, base[1] + ll.normal[1] * cp.off];
  });
  if (flip) pts = pts.reverse();
  // Snap the endpoints back to the exact originals (float cleanup).
  pts[0] = a;
  pts[pts.length - 1] = b;
  return pts;
}

/**
 * Rewrite every edge whose routed path clips a station its line does not serve.
 *
 * @param routed edges paired with their effective waypoints (post-bundling)
 * @param stations every station, for grid positions and line membership
 * @param params  plateau offset + crossing threshold
 * @returns map of edgeIndex → rewritten waypoints, only for edges that changed;
 *          callers fall back to the input points for the rest. Feed the result to
 *          `pointsToPath` with the shared radius.
 */
export function clearPassedStations(
  routed: { edge: Edge; points: Point[] }[],
  stations: Station[],
  params: ClearanceParams,
): Map<number, Point[]> {
  const { clearance, markerRadius } = params;
  const result = new Map<number, Point[]>();

  routed.forEach(({ edge, points }, ei) => {
    if (points.length < 2) return;

    // Stations this edge could falsely stop at: not its own endpoints, and not on
    // its line (a line passing a stop it serves reads correctly — leave it).
    const others = stations.filter(
      s => s.id !== edge.from && s.id !== edge.to && !s.lines.includes(edge.line),
    );
    if (!others.length) return;
    const centres = others.map(s => [px(s.col), py(s.row)] as Point);

    let changed = false;
    const rewritten: Point[] = [points[0]];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const ll = legLine(a, b);
      let legPts: Point[] | null = null;
      if (ll) {
        // Crossed = on this infinite leg line (perpendicular distance within a
        // marker radius) and between the endpoints in param space.
        const targets: number[] = [];
        for (const c of centres) {
          const param = paramOf(ll, c);
          const foot = pointAt(ll, param);
          if (dist(c, foot) <= markerRadius) targets.push(param);
        }
        if (targets.length) legPts = clearLeg(a, b, ll, targets, clearance);
      }
      const seg = legPts ?? [a, b];
      for (let k = 1; k < seg.length; k++) rewritten.push(seg[k]);
      if (legPts) changed = true;
    }
    if (changed) result.set(ei, rewritten);
  });

  return result;
}
