/**
 * PROTOTYPE — throwaway. Answers: "what's the best way to de-clutter dense
 * maps?", focused on clutter problems #1 (lines drawing on top of each other)
 * and #2 (lines crossing over unrelated stations).
 *
 * Four rendering strategies over the SAME real map (the cowboydiver/homesweathome
 * mirror, 35 stations / 50 edges), switchable from the floating bottom bar or
 * `?variant=`:
 *
 *   A — Baseline (current)        the mess exactly as it ships today
 *   B — Bundled + cased           #1: spread coincident lines, white casing at crossings
 *   C — Routed around stations    #2: detour segments around unrelated stations
 *   D — Combined                  #1 + #2 together (the candidate target state)
 *
 * Positions are NOT changed — every variant is a pure render-time treatment of
 * the production layout, so the comparison is honest. Reached only via
 * `?proto=map-clutter` (see main.tsx). Delete with the fixture when a direction
 * is chosen.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Edge, Line, Station } from '../types';
import {
  px, py, routePoints, pointsToPath, resolveRouting, CORNER_RADIUS, type Point,
} from '../lib/routing';
import { computeBounds } from '../lib/bounds';
import { FIXTURE_STATIONS, FIXTURE_EDGES, FIXTURE_LINES } from './homesweathome.fixture';

const STROKE_W = 7;       // colored line width
const CASING_W = 13;      // white under-stroke width
const GAP = 5;            // perpendicular spacing between bundled lines
const STATION_R = 12;
const JOG = 26;           // how far a detour hops over a station
const CLEAR = 22;         // how far before/after a station the detour starts
const NEAR = 18;          // a station this close to a run (px) counts as "on" it

type VariantKey = 'A' | 'B' | 'C' | 'D';
interface VariantDef {
  key: VariantKey;
  name: string;
  blurb: string;
  offset: boolean;
  casing: boolean;
  detour: boolean;
}

const VARIANTS: VariantDef[] = [
  { key: 'A', name: 'Baseline (current)', blurb: 'Exactly what ships today: solid strokes, no casing, no offset. Coincident lines stack and lines run straight through unrelated stations.', offset: false, casing: false, detour: false },
  { key: 'B', name: 'Bundled + cased (#1)', blurb: 'Lines sharing a corridor are spread apart; a white casing makes every crossing read as over/under instead of a merge.', offset: true, casing: true, detour: false },
  { key: 'C', name: 'Routed around stations (#2)', blurb: 'When a segment would pass through an unrelated station it detours around it, so a station is never sitting on a line it is not part of.', offset: false, casing: true, detour: true },
  { key: 'D', name: 'Combined (#1 + #2)', blurb: 'Bundling + casing + detours together — the candidate target state.', offset: true, casing: true, detour: true },
];

interface Run { axis: 'H' | 'V'; fixed: number; lo: number; hi: number }

/** Longest axis-aligned segment of a routed polyline — the part that visibly
 * shares a corridor with other lines. Diagonal-only edges return null. */
function primaryRun(pts: Point[]): Run | null {
  let best: Run | null = null;
  let bestLen = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const dxh = Math.abs(x1 - x0);
    const dyv = Math.abs(y1 - y0);
    if (dyv < 0.5 && dxh > bestLen) {
      bestLen = dxh;
      best = { axis: 'H', fixed: Math.round(y0), lo: Math.min(x0, x1), hi: Math.max(x0, x1) };
    } else if (dxh < 0.5 && dyv > bestLen) {
      bestLen = dyv;
      best = { axis: 'V', fixed: Math.round(x0), lo: Math.min(y0, y1), hi: Math.max(y0, y1) };
    }
  }
  return best;
}

/** Per-edge perpendicular offset so lines sharing an overlapping corridor fan
 * apart symmetrically around the original centre line. */
function computeOffsets(runs: (Run | null)[]): number[] {
  const offsets = new Array<number>(runs.length).fill(0);
  const buckets = new Map<string, number[]>();
  runs.forEach((r, i) => {
    if (!r) return;
    const key = `${r.axis}:${r.fixed}`;
    const list = buckets.get(key);
    if (list) list.push(i);
    else buckets.set(key, [i]);
  });

  for (const idxs of buckets.values()) {
    idxs.sort((a, b) => runs[a]!.lo - runs[b]!.lo || a - b);
    let cluster: number[] = [];
    let clusterHi = -Infinity;
    const flush = () => {
      const n = cluster.length;
      cluster.forEach((idx, j) => { offsets[idx] = (j - (n - 1) / 2) * GAP; });
      cluster = [];
      clusterHi = -Infinity;
    };
    for (const idx of idxs) {
      const r = runs[idx]!;
      if (cluster.length && r.lo > clusterHi) flush();
      cluster.push(idx);
      clusterHi = Math.max(clusterHi, r.hi);
    }
    flush();
  }
  return offsets;
}

function applyOffset(pts: Point[], run: Run | null, off: number): Point[] {
  if (!run || !off) return pts;
  return run.axis === 'H'
    ? pts.map(([x, y]) => [x, y + off] as Point)
    : pts.map(([x, y]) => [x + off, y] as Point);
}

/** Expand one axis-aligned segment so it hops over any blocking obstacle. */
function bumpSegment(p0: Point, p1: Point, obstacles: Point[]): Point[] {
  const [x0, y0] = p0;
  const [x1, y1] = p1;
  const horizontal = Math.abs(y1 - y0) < 0.5 && Math.abs(x1 - x0) > 0.5;
  const vertical = Math.abs(x1 - x0) < 0.5 && Math.abs(y1 - y0) > 0.5;
  if (!horizontal && !vertical) return [p1];

  const out: Point[] = [];
  if (horizontal) {
    const dir = Math.sign(x1 - x0);
    const hits = obstacles
      .filter(([ox, oy]) => Math.abs(oy - y0) < NEAR
        && (ox - x0) * dir > CLEAR && (x1 - ox) * dir > CLEAR)
      .sort((a, b) => (a[0] - b[0]) * dir);
    for (const [ox] of hits) {
      out.push([ox - dir * CLEAR, y0], [ox - dir * CLEAR, y0 - JOG], [ox + dir * CLEAR, y0 - JOG], [ox + dir * CLEAR, y0]);
    }
  } else {
    const dir = Math.sign(y1 - y0);
    const hits = obstacles
      .filter(([ox, oy]) => Math.abs(ox - x0) < NEAR
        && (oy - y0) * dir > CLEAR && (y1 - oy) * dir > CLEAR)
      .sort((a, b) => (a[1] - b[1]) * dir);
    for (const [, oy] of hits) {
      out.push([x0, oy - dir * CLEAR], [x0 - JOG, oy - dir * CLEAR], [x0 - JOG, oy + dir * CLEAR], [x0, oy + dir * CLEAR]);
    }
  }
  out.push(p1);
  return out;
}

function detour(pts: Point[], edge: Edge, stations: Station[]): Point[] {
  const obstacles: Point[] = stations
    .filter(s => s.id !== edge.from && s.id !== edge.to)
    .map(s => [px(s.col), py(s.row)] as Point);
  const out: Point[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    out.push(...bumpSegment(pts[i], pts[i + 1], obstacles));
  }
  return out;
}

function issueNumber(name: string): string {
  const m = name.match(/#(\d+)/);
  return m ? m[1] : '';
}

function MapVariant({ def }: { def: VariantDef }) {
  const stations = FIXTURE_STATIONS;
  const stationById = useMemo(
    () => Object.fromEntries(stations.map(s => [s.id, s])) as Record<string, Station>,
    [stations],
  );
  const lineById = useMemo(
    () => Object.fromEntries(FIXTURE_LINES.map(l => [l.id, l])) as Record<string, Line>,
    [],
  );
  const bounds = useMemo(() => computeBounds(stations), [stations]);

  const paths = useMemo(() => {
    const routed = resolveRouting(FIXTURE_EDGES, stationById);
    const base = routed.map(e => routePoints(e, stationById));
    const offsets = def.offset ? computeOffsets(base.map(primaryRun)) : base.map(() => 0);
    return routed.map((edge, i) => {
      let pts = base[i];
      if (def.offset) pts = applyOffset(pts, primaryRun(pts), offsets[i]);
      if (def.detour) pts = detour(pts, edge, stations);
      const color = lineById[edge.line]?.color ?? '#888';
      return { d: pointsToPath(pts, CORNER_RADIUS), color, key: `${edge.from}-${edge.to}-${i}` };
    });
  }, [def, stationById, lineById, stations]);

  const viewBox = `${bounds.vx} ${bounds.vy - 20} ${bounds.vw} ${bounds.vh + 40}`;

  return (
    <svg viewBox={viewBox} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%' }}>
      <g>
        {def.casing && paths.map(p => (
          <path key={`c-${p.key}`} d={p.d} fill="none" stroke="var(--proto-paper)" strokeWidth={CASING_W} strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {paths.map(p => (
          <path key={p.key} d={p.d} fill="none" stroke={p.color} strokeWidth={STROKE_W} strokeLinecap="round" strokeLinejoin="round" opacity={0.95} />
        ))}
      </g>
      <g>
        {stations.map(s => {
          const color = lineById[s.lines[0]]?.color ?? '#888';
          const x = px(s.col);
          const y = py(s.row);
          const done = s.status === 'done';
          const labelDy = s.lp === 'top' ? -STATION_R - 6 : STATION_R + 14;
          return (
            <g key={s.id} transform={`translate(${x} ${y})`}>
              <circle r={STATION_R} fill={done ? color : 'var(--proto-paper)'} stroke={color} strokeWidth={3.4} />
              <text textAnchor="middle" y={labelDy} fontSize={12} fontWeight={600} fill="var(--proto-ink)">{issueNumber(s.name)}</text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function Switcher({ current, onChange }: { current: VariantKey; onChange: (k: VariantKey) => void }) {
  const def = VARIANTS.find(v => v.key === current)!;
  const idx = VARIANTS.indexOf(def);
  const go = (delta: number) => onChange(VARIANTS[(idx + delta + VARIANTS.length) % VARIANTS.length].key);
  return (
    <div style={{
      position: 'fixed', bottom: 18, left: '50%', transform: 'translateX(-50%)',
      display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px',
      background: '#111', color: '#fff', borderRadius: 999, boxShadow: '0 6px 24px rgba(0,0,0,.35)',
      font: '600 13px/1.2 system-ui, sans-serif', zIndex: 50,
    }}>
      <button onClick={() => go(-1)} style={btn} aria-label="Previous variant">←</button>
      <span style={{ minWidth: 220, textAlign: 'center' }}>{def.key} — {def.name}</span>
      <button onClick={() => go(1)} style={btn} aria-label="Next variant">→</button>
    </div>
  );
}

const btn: React.CSSProperties = {
  background: '#2a2a2a', color: '#fff', border: 'none', borderRadius: 999,
  width: 30, height: 30, cursor: 'pointer', fontSize: 16, lineHeight: '30px',
};

export function MapClutterPrototype() {
  const initial = (new URLSearchParams(window.location.search).get('variant') as VariantKey) || 'A';
  const [current, setCurrent] = useState<VariantKey>(
    VARIANTS.some(v => v.key === initial) ? initial : 'A',
  );
  const def = VARIANTS.find(v => v.key === current)!;

  const change = (k: VariantKey) => {
    setCurrent(k);
    const url = new URL(window.location.href);
    url.searchParams.set('variant', k);
    window.history.replaceState(null, '', url);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && /^(INPUT|TEXTAREA)$/.test(t.tagName)) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); change(VARIANTS[(VARIANTS.indexOf(def) - 1 + VARIANTS.length) % VARIANTS.length].key); }
      if (e.key === 'ArrowRight') { e.preventDefault(); change(VARIANTS[(VARIANTS.indexOf(def) + 1) % VARIANTS.length].key); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [def]);

  return (
    <div style={{
      // @ts-expect-error CSS custom props
      '--proto-paper': '#fff', '--proto-ink': '#333',
      position: 'fixed', inset: 0, background: '#f6f5f2', overflow: 'hidden',
    }}>
      <div style={{
        position: 'fixed', top: 14, left: 16, right: 16, maxWidth: 560, zIndex: 40,
        background: 'rgba(255,255,255,.9)', borderRadius: 10, padding: '10px 14px',
        boxShadow: '0 2px 10px rgba(0,0,0,.08)', font: '13px/1.4 system-ui, sans-serif', color: '#222',
      }}>
        <strong>PointPlanner clutter prototype</strong> — <code>cowboydiver/homesweathome</code> · 35 stations / 50 edges<br />
        <span style={{ fontWeight: 600 }}>{def.key} — {def.name}.</span> {def.blurb}
      </div>
      <MapVariant def={def} />
      <Switcher current={current} onChange={change} />
    </div>
  );
}
