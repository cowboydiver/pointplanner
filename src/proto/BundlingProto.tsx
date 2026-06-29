import { useMemo, useState } from 'react';
import type { Point } from '../lib/routing';
import { resolveRouting, routePoints, pointsToPath, CORNER_RADIUS } from '../lib/routing';
import { computeBounds } from '../lib/bounds';
import { offsetCollinearLegs } from '../lib/bundling';
import { bundleFixture } from './bundleFixture';

/**
 * THROWAWAY dev harness for the parallel-lane bundling experiment.
 * Reachable at /proto.html under `npm run dev`. Renders its own minimal SVG so it
 * needs no Supabase / auth / store — just the pure routing + bundling functions.
 */
export function BundlingProto() {
  const [on, setOn] = useState(true);
  const [lanePitch, setLanePitch] = useState(20);
  const [radius, setRadius] = useState(CORNER_RADIUS);

  const { stations, edges, lines } = bundleFixture;

  const stationById = useMemo(
    () => Object.fromEntries(stations.map(s => [s.id, s])),
    [stations],
  );
  const lineById = useMemo(
    () => Object.fromEntries(lines.map(l => [l.id, l])),
    [lines],
  );
  const lineOrder = useMemo(() => lines.map(l => l.id), [lines]);

  const routed = useMemo(() => {
    const re = resolveRouting(edges, stationById);
    return re.map(edge => ({ edge, points: routePoints(edge, stationById) }));
  }, [edges, stationById]);

  const bundled = useMemo(
    () => (on ? offsetCollinearLegs(routed, { lanePitch }, lineOrder) : new Map<number, Point[]>()),
    [on, routed, lanePitch, lineOrder],
  );

  const bounds = useMemo(() => computeBounds(stations), [stations]);
  const viewBox = `${bounds.vx} ${bounds.vy} ${bounds.vw} ${bounds.vh}`;

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#faf8f2', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          gap: 24,
          alignItems: 'center',
          padding: '12px 18px',
          borderBottom: '1px solid #e6e2d6',
          font: '14px/1.2 Hanken Grotesk, system-ui, sans-serif',
          color: '#14161c',
          flex: '0 0 auto',
        }}
      >
        <strong style={{ fontWeight: 800 }}>Bundling prototype</strong>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={on} onChange={e => setOn(e.target.checked)} />
          bundling {on ? 'ON' : 'OFF (current behavior)'}
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', opacity: on ? 1 : 0.4 }}>
          lane pitch
          <input type="range" min={0} max={28} step={1} value={lanePitch} disabled={!on}
            onChange={e => setLanePitch(Number(e.target.value))} />
          <span style={{ width: 26, textAlign: 'right' }}>{lanePitch}px</span>
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          turn radius
          <input type="range" min={0} max={40} step={1} value={radius}
            onChange={e => setRadius(Number(e.target.value))} />
          <span style={{ width: 26, textAlign: 'right' }}>{radius}px</span>
        </label>
        <span style={{ marginLeft: 'auto', color: '#5b5f6a' }}>
          {bundled.size} edge{bundled.size === 1 ? '' : 's'} re-routed into lanes
        </span>
      </div>

      <svg viewBox={viewBox} preserveAspectRatio="xMidYMid meet" style={{ flex: '1 1 auto', width: '100%', height: '100%' }}>
        <g>
          {routed.map(({ edge }, i) => {
            const lineObj = lineById[edge.line];
            if (!lineObj) return null;
            const pts = bundled.get(i) ?? routed[i].points;
            const d = pointsToPath(pts, radius);
            return (
              <path
                key={`${edge.from}-${edge.to}-${i}`}
                d={d}
                fill="none"
                stroke={lineObj.color}
                strokeWidth={9}
                strokeLinecap="round"
                strokeLinejoin="round"
                data-line={edge.line}
              />
            );
          })}
        </g>
        <g>
          {stations.map(s => {
            const interchange = s.lines.length > 1;
            const cx = 96 + s.col * 152;
            const cy = 92 + s.row * 94;
            const r = interchange ? 13 : 11;
            const done = s.status === 'done';
            return (
              <g key={s.id}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill={done ? '#1e9c55' : '#fff'}
                  stroke={interchange ? '#14161c' : done ? '#1e9c55' : '#9aa0ab'}
                  strokeWidth={interchange ? 5 : 3.5}
                />
                <text
                  x={cx}
                  y={s.lp === 'bottom' ? cy + r + 15 : cy - r - 7}
                  textAnchor="middle"
                  style={{ font: '600 12px Hanken Grotesk, system-ui, sans-serif', fill: '#14161c' }}
                >
                  {s.id}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
