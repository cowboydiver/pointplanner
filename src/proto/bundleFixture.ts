import type { Project, Line, Station, Edge } from '../types';
import type { MapData } from '../lib/maps';

/**
 * THROWAWAY prototype fixture for the parallel-lane bundling experiment.
 *
 * Stations are placed at explicit (col,row) — NOT via layoutStations — so we can
 * deliberately force the residual collinear cross-line overlaps that bundling is
 * meant to disambiguate. It exercises every code path:
 *
 *  - row 1: a long 2-line (red+blue) horizontal bundle with interior stations,
 *    ending at the red/blue interchange `m1` (taper masked by the marker).
 *  - row 4: a "corridor" where green, orange, teal and purple legs pile onto one
 *    row over *different* column ranges → 3-lane and 4-lane spans plus a clean
 *    mid-run peel-in (purple enters via a diagonal, so its run starts between
 *    stations) and several taper-at-station boundaries (g2/o2/t2).
 *  - col 11: a 2-line (red+teal) *vertical* bundle.
 *
 * Note: diagonal cross-line bundles are effectively impossible here — with
 * COL=152 ≠ ROW=94, two grid stations almost never put their 45° legs on the
 * same pixel diagonal — so the fixture (and the real data) only show H/V bundles.
 */

const PROJECT: Project = {
  name: 'Bundling Prototype',
  subtitle: 'synthetic residual-overlap stress fixture',
};

const LINES: Line[] = [
  { id: 'red',    name: 'Red Line',    color: '#D8392F', short: 'RD' },
  { id: 'blue',   name: 'Blue Line',   color: '#2563C9', short: 'BL' },
  { id: 'green',  name: 'Green Line',  color: '#1E9C55', short: 'GR' },
  { id: 'orange', name: 'Orange Line', color: '#E0962A', short: 'OR' },
  { id: 'teal',   name: 'Teal Line',   color: '#0E9AA7', short: 'TL' },
  { id: 'purple', name: 'Purple Line', color: '#7A4DD0', short: 'PU' },
];

type LP = Station['lp'];
type SS = Station['status'];

function st(id: string, lines: string[], col: number, row: number, lp: LP, status: SS): Station {
  return {
    id,
    name: id,
    lines,
    col,
    row,
    lp,
    status,
    desc: '',
    owner: '',
    role: '',
    due: '',
    est: '',
    tags: [],
  };
}

const STATIONS: Station[] = [
  // ---- red (top horizontal bundle + right vertical bundle) ----
  st('r0', ['red'], 0, 1, 'top', 'done'),
  st('r1', ['red'], 2, 1, 'top', 'done'),
  st('m1', ['red', 'blue'], 9, 1, 'top', 'active'), // interchange / merge
  st('r2', ['red'], 11, 1, 'top', 'locked'),
  st('r3', ['red'], 11, 6, 'bottom', 'locked'),
  st('r4', ['red'], 13, 6, 'bottom', 'locked'),

  // ---- blue (shares row 1 with red) ----
  st('b0', ['blue'], 0, 2, 'top', 'done'),
  st('b1', ['blue'], 4, 1, 'top', 'done'),
  st('bm', ['blue'], 6, 1, 'top', 'active'),
  st('b2', ['blue'], 11, 2, 'top', 'locked'),
  st('b3', ['blue'], 13, 2, 'top', 'locked'),

  // ---- green (corridor source off-row → target on row 4) ----
  st('g0', ['green'], 0, 3, 'top', 'done'),
  st('g1', ['green'], 2, 3, 'top', 'active'),
  st('g2', ['green'], 8, 4, 'bottom', 'locked'),
  st('g3', ['green'], 12, 3, 'top', 'locked'),

  // ---- orange (corridor) ----
  st('o0', ['orange'], 0, 5, 'bottom', 'done'),
  st('o1', ['orange'], 2, 5, 'bottom', 'active'),
  st('o2', ['orange'], 9, 4, 'bottom', 'locked'),
  st('o3', ['orange'], 12, 5, 'bottom', 'locked'),

  // ---- teal (corridor on row 4 + vertical bundle on col 11) ----
  st('t1', ['teal'], 2, 4, 'top', 'available'),
  st('t2', ['teal'], 10, 4, 'bottom', 'locked'),
  st('t3', ['teal'], 11, 3, 'top', 'locked'),
  st('t4', ['teal'], 11, 8, 'bottom', 'locked'),
  st('t5', ['teal'], 13, 8, 'bottom', 'locked'),

  // ---- purple (mid-run peel-in via diagonal entry) ----
  st('p0', ['purple'], 4, 6, 'bottom', 'available'),
  st('p1', ['purple'], 11, 4, 'bottom', 'locked'),
  st('p2', ['purple'], 13, 4, 'bottom', 'locked'),
];

const EDGES: Edge[] = [
  // red
  { from: 'r0', to: 'r1', line: 'red' },
  { from: 'r1', to: 'm1', line: 'red' },
  { from: 'm1', to: 'r2', line: 'red' },
  { from: 'r2', to: 'r3', line: 'red' }, // vertical col 11
  { from: 'r3', to: 'r4', line: 'red' },
  // blue
  { from: 'b0', to: 'b1', line: 'blue' },
  { from: 'b1', to: 'bm', line: 'blue' },
  { from: 'bm', to: 'm1', line: 'blue' },
  { from: 'm1', to: 'b2', line: 'blue' },
  { from: 'b2', to: 'b3', line: 'blue' },
  // green
  { from: 'g0', to: 'g1', line: 'green' },
  { from: 'g1', to: 'g2', line: 'green' }, // diagonal-first → horizontal on row 4
  { from: 'g2', to: 'g3', line: 'green' },
  // orange
  { from: 'o0', to: 'o1', line: 'orange' },
  { from: 'o1', to: 'o2', line: 'orange' }, // diagonal-first → horizontal on row 4
  { from: 'o2', to: 'o3', line: 'orange' },
  // teal
  { from: 't1', to: 't2', line: 'teal' }, // straight horizontal on row 4
  { from: 't2', to: 't3', line: 'teal' },
  { from: 't3', to: 't4', line: 'teal' }, // vertical col 11
  { from: 't4', to: 't5', line: 'teal' },
  // purple
  { from: 'p0', to: 'p1', line: 'purple' }, // diagonal entry → peels into row 4 mid-run
  { from: 'p1', to: 'p2', line: 'purple' },
];

export const bundleFixture: MapData = {
  project: PROJECT,
  lines: LINES,
  stations: STATIONS,
  edges: EDGES,
};
