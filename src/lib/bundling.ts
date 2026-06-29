import type { Edge } from '../types';
import { dist, type Point } from './routing';

/**
 * Render-time disambiguation of *residual collinear cross-line overlap*.
 *
 * Layout (ADR 0006) positions stations so lines rarely coincide, but a few
 * segments where two or more DIFFERENT lines run along the identical grid run
 * still draw on top of each other. This module nudges those overlapping runs
 * sideways into parallel "lanes" so they run alongside each other instead.
 *
 * The model is **trunk-fixed**: within a run shared by several lines, the
 * *trunk* — the line earliest in the global line order — stays exactly on the
 * original track and never moves. Every other line is pushed into a fixed
 * parallel lane beside it (flanking both sides: +1, −1, +2, −2 … by line order)
 * and connects to the trunk's track with a 45° diagonal at each end of its run.
 * Those joins fillet with the same `CORNER_RADIUS` as every routing bend (in
 * `pointsToPath`), so they read as ordinary corners — there is no separate sharp
 * corner. Because each line keeps ONE fixed lane for the whole shared region, a
 * line never changes lane mid-run — the only bends are its own 45° joins, so there
 * are no "recentering" wobbles.
 *
 * It is purely geometric and pixel-space (no React, no layout changes). The unit
 * of work is a *leg* — one straight run between consecutive routed waypoints
 * (horizontal, vertical, or exactly 45° diagonal, the only shapes `routePoints`
 * emits). Same-line overlap collapses onto one lane and is left alone.
 *
 * Where a bundled line meets a real *station* (an edge endpoint, always at a grid
 * centre) it returns to offset 0 with a 45° notch — the line visibly touches its
 * stop. Where it meets an interior routing *bend* (the turn where it joins or leaves
 * the corridor) it stays in its lane: the bend is shifted sideways onto the lane and
 * the adjacent non-collinear leg is dragged to that shifted point, so the line slides
 * straight into its lane instead of spiking up to the centerline first. The result is
 * just a waypoint list per edge; every corner (routing bend and lane join alike) is
 * filleted with the one shared `CORNER_RADIUS` by `pointsToPath`.
 */

const SQRT1_2 = Math.SQRT1_2; // 1/√2
const QUANT = 0.5; // px — collapse float noise when grouping collinear legs
const EPS = 1e-6;

export interface BundleParams {
  /** Centre-to-centre distance between adjacent lanes, in px. Shipped value is
   *  `LANE_PITCH = 16` (routing.ts): large enough that the innermost lane clears a
   *  passing-station marker (see ADR 0007), so don't tune it below that blindly. */
  lanePitch: number;
}


/** One straight run between two consecutive routed waypoints, tagged with its source. */
interface Leg {
  a: Point;
  b: Point;
  line: string;
}

type Family = 'h' | 'v' | 'd+' | 'd-';

/** Canonical identity of the infinite line a leg lies on, plus its 1-D param frame. */
export interface LegLine {
  key: string;
  family: Family;
  /** Line constant: y for h, x for v, (y−x) for d+, (x+y) for d-. */
  c: number;
  /** Unit perpendicular along which a lane offset is applied. */
  normal: Point;
}

const q = (v: number) => Math.round(v / QUANT) * QUANT;

/**
 * Canonicalize the infinite line that the leg a→b lies on. Returns null for a
 * degenerate (zero-length) leg. Legs are only ever horizontal, vertical, or 45°.
 */
export function legLine(a: Point, b: Point): LegLine | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx < EPS && ady < EPS) return null;

  if (ady < EPS) {
    const c = a[1];
    return { key: `h:${q(c)}`, family: 'h', c, normal: [0, 1] };
  }
  if (adx < EPS) {
    const c = a[0];
    return { key: `v:${q(c)}`, family: 'v', c, normal: [1, 0] };
  }
  if (Math.sign(dx) === Math.sign(dy)) {
    // slope +1 → line y − x = c
    const c = a[1] - a[0];
    return { key: `d+:${q(c)}`, family: 'd+', c, normal: [SQRT1_2, -SQRT1_2] };
  }
  // slope −1 → line x + y = c
  const c = a[0] + a[1];
  return { key: `d-:${q(c)}`, family: 'd-', c, normal: [SQRT1_2, SQRT1_2] };
}

/** Scalar coordinate of a point along the host line (monotone along the run). */
export function paramOf(ll: LegLine, p: Point): number {
  switch (ll.family) {
    case 'h': return p[0];
    case 'v': return p[1];
    case 'd+': return (p[0] + p[1]) / 2;
    case 'd-': return (p[0] - p[1]) / 2;
  }
}

/** Inverse of {@link paramOf}: the on-centerline point at a given param. */
export function pointAt(ll: LegLine, param: number): Point {
  switch (ll.family) {
    case 'h': return [param, ll.c];
    case 'v': return [ll.c, param];
    case 'd+': return [param - ll.c / 2, param + ll.c / 2];
    case 'd-': return [param + ll.c / 2, ll.c / 2 - param];
  }
}

/**
 * Screen distance covered per unit of param along the host line — 1 for the
 * axis-aligned families, √2 for the diagonals (param there is (x±y)/2). Used to
 * size a 45° join so its *screen* along-length matches the perpendicular offset.
 */
function screenPerParam(family: Family): number {
  return family === 'h' || family === 'v' ? 1 : Math.SQRT2;
}

/**
 * Signed lane offset (px) for a line at `rank` within a region. Trunk (rank 0)
 * stays on the centerline; the rest flank both sides in line order:
 * rank 1 → +1·pitch, 2 → −1, 3 → +2, 4 → −2, …
 */
export function laneOffset(rank: number, lanePitch: number): number {
  if (rank === 0) return 0;
  const k = Math.ceil(rank / 2);
  const sign = rank % 2 === 1 ? 1 : -1;
  return sign * k * lanePitch;
}

/** A maximal interval of a host line where ≥2 distinct lines coincide. */
export interface Region {
  lo: number;
  hi: number;
  /** Fixed lane offset (px) for every line appearing anywhere in the region. */
  offsetByLine: Map<string, number>;
}

/**
 * Sweep the legs on one host line and return its maximal bundle regions — the
 * intervals where 2+ distinct lines overlap. Each line that appears anywhere in a
 * region is assigned a single fixed lane offset (by global lane rank), so a line
 * never shifts lane within the region.
 */
export function bundleRegions(
  legs: Leg[],
  ll: LegLine,
  laneRank: (line: string) => number,
  lanePitch: number,
): Region[] {
  const intervals = legs.map(l => {
    const p1 = paramOf(ll, l.a);
    const p2 = paramOf(ll, l.b);
    return { lo: Math.min(p1, p2), hi: Math.max(p1, p2), line: l.line };
  });

  const bps = Array.from(new Set(intervals.flatMap(i => [i.lo, i.hi]))).sort((x, y) => x - y);

  // Elementary sub-intervals, each tagged with the distinct lines covering it.
  const subs: Array<{ lo: number; hi: number; lines: Set<string> }> = [];
  for (let i = 0; i < bps.length - 1; i++) {
    const s = bps[i];
    const e = bps[i + 1];
    if (e - s < EPS) continue;
    const mid = (s + e) / 2;
    const here = new Set<string>();
    for (const iv of intervals) {
      if (iv.lo <= mid && mid <= iv.hi) here.add(iv.line);
    }
    subs.push({ lo: s, hi: e, lines: here });
  }

  // Group contiguous "bundled" (≥2 lines) sub-intervals into maximal regions.
  const regions: Region[] = [];
  let cur: { lo: number; hi: number; lines: Set<string> } | null = null;
  const flush = () => {
    if (!cur) return;
    const sorted = [...cur.lines].sort((a, b) => laneRank(a) - laneRank(b));
    const offsetByLine = new Map<string, number>();
    sorted.forEach((line, rank) => offsetByLine.set(line, laneOffset(rank, lanePitch)));
    regions.push({ lo: cur.lo, hi: cur.hi, offsetByLine });
    cur = null;
  };
  for (const sub of subs) {
    if (sub.lines.size >= 2) {
      if (cur && Math.abs(cur.hi - sub.lo) < EPS) {
        cur.hi = sub.hi;
        sub.lines.forEach(l => cur!.lines.add(l));
      } else {
        flush();
        cur = { lo: sub.lo, hi: sub.hi, lines: new Set(sub.lines) };
      }
    } else {
      flush();
    }
  }
  flush();
  return regions;
}

interface ControlPoint {
  param: number;
  off: number;
}

interface LegResult {
  pts: Point[];
  changed: boolean;
}

/**
 * Rewrite one leg into an offset polyline.
 *
 * The line slides into its lane and stays there, passing any station it doesn't
 * serve in a straight line. It returns to the centerline (offset 0) ONLY at a real
 * *station* (`startZero`/`endZero`, an edge endpoint), with a 45° notch so it visibly
 * touches its stop. At an end that is an interior bend it stays in its lane (endpoint
 * pixel = lane point; the caller drags the adjacent leg onto it).
 *
 * A leg can cross more than one bundle region (e.g. several dependencies converging
 * into a merge corridor), and this line's lane may differ between them. The leg is
 * therefore split at region boundaries and each span carries its own region lane; a
 * gap with no region inherits (carries) the nearest region's lane rather than dropping
 * to the centerline. So the line changes lane mid-leg with a 45° lane-to-lane join but
 * never peels back to the centerline mid-leg — which both keeps every region's overlap
 * separated and avoids dipping to touch a passing station that merely marks where the
 * *other* lines left. Legs too short to fit their station notch(es) stay on the centerline.
 */
function offsetLeg(
  leg: Leg,
  ll: LegLine,
  regions: Region[],
  startZero: boolean,
  endZero: boolean,
): LegResult {
  const pa = paramOf(ll, leg.a);
  const pb = paramOf(ll, leg.b);
  const lo = Math.min(pa, pb);
  const hi = Math.max(pa, pb);
  const spp = screenPerParam(ll.family);
  const flip = pa > pb;
  // Re-key the station flags into param space (lo end vs hi end).
  const loZero = flip ? endZero : startZero;
  const hiZero = flip ? startZero : endZero;

  // Split the leg at region boundaries; each span gets this line's lane in the region
  // covering it (or NaN where no region covers it — a gap).
  const cuts = new Set<number>([lo, hi]);
  for (const r of regions) {
    if (r.hi <= lo || r.lo >= hi) continue;
    cuts.add(Math.max(r.lo, lo));
    cuts.add(Math.min(r.hi, hi));
  }
  const xs = [...cuts].filter(x => x >= lo - EPS && x <= hi + EPS).sort((a, b) => a - b);
  const spans: Array<{ s: number; e: number; off: number }> = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const s = xs[i];
    const e = xs[i + 1];
    if (e - s < EPS) continue;
    const mid = (s + e) / 2;
    let off = NaN; // gap (no region) until proven otherwise
    for (const r of regions) {
      if (r.lo - EPS <= mid && mid <= r.hi + EPS && r.offsetByLine.has(leg.line)) {
        off = r.offsetByLine.get(leg.line)!;
        break;
      }
    }
    spans.push({ s, e, off });
  }

  // Carry a region's lane across adjacent gaps so the line holds its lane instead of
  // returning to the centerline mid-leg (forward fill, then backward for a leading gap).
  for (let i = 1; i < spans.length; i++) {
    if (Number.isNaN(spans[i].off)) spans[i].off = spans[i - 1].off;
  }
  for (let i = spans.length - 2; i >= 0; i--) {
    if (Number.isNaN(spans[i].off)) spans[i].off = spans[i + 1].off;
  }
  // Collapse adjacent equal-lane spans so we don't emit redundant joins.
  const merged = spans.filter(s => !Number.isNaN(s.off)).reduce<typeof spans>((acc, s) => {
    const last = acc[acc.length - 1];
    if (last && Math.abs(last.off - s.off) < EPS) last.e = s.e;
    else acc.push({ ...s });
    return acc;
  }, []);
  if (!merged.some(s => Math.abs(s.off) > EPS)) {
    return { pts: [leg.a, leg.b], changed: false };
  }

  // A station end needs a 45° notch back to the centerline; ensure the leg is long
  // enough to host them, else leave it on the centerline.
  const dLo = loZero ? Math.abs(merged[0].off) / spp : 0;
  const dHi = hiZero ? Math.abs(merged[merged.length - 1].off) / spp : 0;
  if (hi - lo < dLo + dHi) return { pts: [leg.a, leg.b], changed: false };

  const cps: ControlPoint[] = [];
  const push = (cp: ControlPoint) => {
    const prev = cps[cps.length - 1];
    if (prev && Math.abs(prev.param - cp.param) < EPS && Math.abs(prev.off - cp.off) < EPS) return;
    cps.push(cp);
  };

  // lo end: notch from the centerline if it is a station, else start in-lane.
  if (loZero) {
    push({ param: lo, off: 0 });
    push({ param: lo + dLo, off: merged[0].off });
  } else {
    push({ param: lo, off: merged[0].off });
  }
  // Interior lane-to-lane joins, centred on each region boundary (never touch 0).
  for (let i = 0; i < merged.length - 1; i++) {
    const L = merged[i];
    const R = merged[i + 1];
    const b = L.e;
    const delta = Math.abs(R.off - L.off) / spp;
    const dl = Math.min(delta / 2, (L.e - L.s) / 2);
    const dr = Math.min(delta / 2, (R.e - R.s) / 2);
    push({ param: b - dl, off: L.off });
    push({ param: b + dr, off: R.off });
  }
  // hi end: notch back to the centerline if it is a station, else end in-lane.
  if (hiZero) {
    push({ param: hi - dHi, off: merged[merged.length - 1].off });
    push({ param: hi, off: 0 });
  } else {
    push({ param: hi, off: merged[merged.length - 1].off });
  }

  let mapped: Point[] = cps.map(cp => {
    const base = pointAt(ll, cp.param);
    return [base[0] + ll.normal[0] * cp.off, base[1] + ll.normal[1] * cp.off];
  });
  if (flip) mapped = mapped.reverse();

  // Snap a centerline endpoint to the exact original (float cleanup); a lane
  // endpoint is left as computed for the caller to reconcile.
  if (startZero) mapped[0] = leg.a;
  if (endZero) mapped[mapped.length - 1] = leg.b;

  return { pts: mapped, changed: true };
}

/**
 * Rewrite one edge: offset each of its legs, then reconcile shared interior bends
 * so a leg that stayed on the centerline is dragged onto its neighbour's lane
 * point (the line slides into its lane without spiking to the centerline first).
 * Returns null if nothing changed.
 */
function offsetEdge(points: Point[], line: string, regionsByKey: Map<string, Region[]>): Point[] | null {
  const n = points.length - 1;
  if (n < 1) return null;

  const legs: LegResult[] = [];
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[i + 1];
    const ll = legLine(a, b);
    const regions = ll && regionsByKey.get(ll.key);
    if (!ll || !regions) {
      legs.push({ pts: [a, b], changed: false });
      continue;
    }
    legs.push(offsetLeg({ a, b, line }, ll, regions, i === 0, i === n - 1));
  }

  if (!legs.some(l => l.changed)) return null;

  // Reconcile each interior bend: if one adjacent leg sits in a lane there, pull
  // the other onto the same point so the two legs still meet exactly.
  for (let i = 1; i < n; i++) {
    const left = legs[i - 1];
    const right = legs[i];
    const center = points[i];
    const lp = left.pts[left.pts.length - 1];
    const rp = right.pts[0];
    const lLane = dist(lp, center) > EPS;
    const rLane = dist(rp, center) > EPS;
    let chosen = center;
    if (lLane && rLane) chosen = dist(lp, center) >= dist(rp, center) ? lp : rp;
    else if (lLane) chosen = lp;
    else if (rLane) chosen = rp;
    left.pts[left.pts.length - 1] = chosen;
    right.pts[0] = chosen;
  }

  const merged: Point[] = [];
  legs.forEach((leg, i) => {
    merged.push(...(i === 0 ? leg.pts : leg.pts.slice(1)));
  });
  return merged;
}

/**
 * Offset collinear cross-line legs into parallel lanes (trunk-fixed model).
 *
 * @param routed  edges paired with their routed waypoint lists (`routePoints`)
 * @param params  lane pitch (45° join length is derived from it)
 * @param lineOrder global line-declaration order — the stable lane key; the first
 *                  line present on a run is the trunk and stays put
 * @returns map of edgeIndex → rewritten waypoint list. Only edges whose geometry
 *          actually changed are included; callers fall back to the original points
 *          for the rest. Feed the result to `pointsToPath` with the shared radius.
 */
export function offsetCollinearLegs(
  routed: { edge: Edge; points: Point[] }[],
  params: BundleParams,
  lineOrder: string[],
): Map<number, Point[]> {
  const rankOf = new Map(lineOrder.map((id, i) => [id, i]));
  const laneRank = (line: string) => (rankOf.has(line) ? rankOf.get(line)! : lineOrder.length);

  // 1. Decompose every edge into legs, grouped by their host line.
  const groups = new Map<string, Leg[]>();
  routed.forEach(({ edge, points }) => {
    for (let k = 0; k < points.length - 1; k++) {
      const a = points[k];
      const b = points[k + 1];
      const ll = legLine(a, b);
      if (!ll) continue;
      const leg: Leg = { a, b, line: edge.line };
      const bucket = groups.get(ll.key);
      if (bucket) bucket.push(leg);
      else groups.set(ll.key, [leg]);
    }
  });

  // 2. Per host line carrying ≥2 distinct lines, find the bundle regions.
  const regionsByKey = new Map<string, Region[]>();
  for (const [key, legs] of groups) {
    const distinctLines = new Set(legs.map(l => l.line));
    if (distinctLines.size < 2) continue; // only different lines matter
    const ll = legLine(legs[0].a, legs[0].b)!;
    const regions = bundleRegions(legs, ll, laneRank, params.lanePitch);
    if (regions.length) regionsByKey.set(key, regions);
  }
  if (regionsByKey.size === 0) return new Map();

  // 3. Rewrite each edge whose legs touch a bundle region.
  const result = new Map<number, Point[]>();
  routed.forEach(({ edge, points }, ei) => {
    const offset = offsetEdge(points, edge.line, regionsByKey);
    if (offset) result.set(ei, offset);
  });

  return result;
}
