import { describe, it, expect } from 'vitest';
import { layoutStations, relayoutStations, type LayoutNode } from './layout';
import type { Edge, Station } from '../types';

function makeStation(id: string, lines: string[], overrides: Partial<Station> = {}): Station {
  return {
    id, name: id, lines, col: 99, row: 99, lp: 'bottom',
    status: 'locked', desc: 'd', owner: 'o', role: 'r', due: '-', est: '-', tags: ['t'],
    ...overrides,
  };
}

describe('layoutStations', () => {
  it('assigns col by topological depth (roots at 0, dependents one column right)', () => {
    const nodes: LayoutNode[] = [
      { id: 'a', lineId: 'l1' },
      { id: 'b', lineId: 'l1' },
      { id: 'c', lineId: 'l1' },
    ];
    // a -> b -> c
    const prereqs = { b: ['a'], c: ['b'] };
    const out = layoutStations(nodes, prereqs);
    expect(out.a.col).toBe(0);
    expect(out.b.col).toBe(1);
    expect(out.c.col).toBe(2);
  });

  it('places a dependent of two prereqs one column right of the DEEPEST', () => {
    const nodes: LayoutNode[] = [
      { id: 'a', lineId: 'l1' }, // depth 0
      { id: 'b', lineId: 'l1' }, // depth 1 (after a)
      { id: 'c', lineId: 'l1' }, // depth 0 (no prereqs)
      { id: 'd', lineId: 'l1' }, // depends on b (depth 1) and c (depth 0)
    ];
    const prereqs = { b: ['a'], d: ['b', 'c'] };
    const out = layoutStations(nodes, prereqs);
    expect(out.a.col).toBe(0);
    expect(out.b.col).toBe(1);
    expect(out.c.col).toBe(0);
    // deepest prereq is b at col 1 → d sits at col 2 (not col 1 from c).
    expect(out.d.col).toBe(2);
  });

  it('packs rows per line band in first-appearance order', () => {
    const nodes: LayoutNode[] = [
      { id: 'a', lineId: 'l1' },
      { id: 'b', lineId: 'l2' },
      { id: 'c', lineId: 'l3' },
    ];
    // No deps → all col 0, each on its own line band → distinct rows.
    const out = layoutStations(nodes, {});
    expect(out.a.row).toBe(0);
    expect(out.b.row).toBe(1);
    expect(out.c.row).toBe(2);
    // All at col 0.
    expect([out.a.col, out.b.col, out.c.col]).toEqual([0, 0, 0]);
  });

  it('bumps row deterministically when two stations collide on the same col/row', () => {
    const nodes: LayoutNode[] = [
      { id: 'a', lineId: 'l1' },
      { id: 'b', lineId: 'l1' }, // same line, same col → collides with a
      { id: 'c', lineId: 'l1' }, // collides again
    ];
    // No deps → all want col 0, band 0.
    const out = layoutStations(nodes, {});
    expect(out.a).toMatchObject({ col: 0, row: 0 });
    expect(out.b).toMatchObject({ col: 0, row: 1 });
    expect(out.c).toMatchObject({ col: 0, row: 2 });
  });

  it('is deterministic: identical input yields identical output', () => {
    const nodes: LayoutNode[] = [
      { id: 'a', lineId: 'l1' },
      { id: 'b', lineId: 'l1' },
      { id: 'c', lineId: 'l2' },
    ];
    const prereqs = { b: ['a'], c: ['a'] };
    const first = layoutStations(nodes, prereqs);
    const second = layoutStations(nodes, prereqs);
    expect(first).toEqual(second);
  });

  it('applies the lp heuristic (row >= 3 → bottom, else top)', () => {
    // Five nodes on one line band, all col 0 → rows 0..4, bands climb.
    const nodes: LayoutNode[] = [
      { id: 'r0', lineId: 'l1' },
      { id: 'r1', lineId: 'l1' },
      { id: 'r2', lineId: 'l1' },
      { id: 'r3', lineId: 'l1' },
      { id: 'r4', lineId: 'l1' },
    ];
    const out = layoutStations(nodes, {});
    expect(out.r0).toMatchObject({ row: 0, lp: 'top' });
    expect(out.r2).toMatchObject({ row: 2, lp: 'top' });
    expect(out.r3).toMatchObject({ row: 3, lp: 'bottom' });
    expect(out.r4).toMatchObject({ row: 4, lp: 'bottom' });
  });

  it('ignores prereqs that are not stations in the node set', () => {
    const nodes: LayoutNode[] = [{ id: 'a', lineId: 'l1' }];
    // a depends on a closed/excluded issue not present as a node.
    const out = layoutStations(nodes, { a: ['ghost'] });
    expect(out.a.col).toBe(0);
  });

  it('bumps an unrelated station off a line that would run straight through it', () => {
    // a→b→c chain plus a long a→c edge. Initially a(0,0), b(1,0), c(2,0): the
    // a→c run passes straight through b at (1,0). Clearance must move b off row 0.
    const nodes: LayoutNode[] = [
      { id: 'a', lineId: 'l1' },
      { id: 'b', lineId: 'l1' },
      { id: 'c', lineId: 'l1' },
    ];
    const prereqs = { b: ['a'], c: ['b', 'a'] };
    const out = layoutStations(nodes, prereqs);
    expect(out.a).toMatchObject({ col: 0, row: 0 });
    expect(out.c).toMatchObject({ col: 2, row: 0 });
    // b is bumped down so the a→c line no longer crosses it.
    expect(out.b.col).toBe(1);
    expect(out.b.row).not.toBe(0);
  });

  it('clearance is deterministic and leaves a clear case untouched', () => {
    const nodes: LayoutNode[] = [
      { id: 'a', lineId: 'l1' },
      { id: 'b', lineId: 'l1' },
      { id: 'c', lineId: 'l1' },
    ];
    const prereqs = { b: ['a'], c: ['b', 'a'] };
    expect(layoutStations(nodes, prereqs)).toEqual(layoutStations(nodes, prereqs));
    // A simple chain has no crossing, so nothing is bumped.
    const chain = layoutStations(
      [
        { id: 'a', lineId: 'l1' },
        { id: 'b', lineId: 'l1' },
        { id: 'c', lineId: 'l1' },
      ],
      { b: ['a'], c: ['b'] },
    );
    expect(chain.a.row).toBe(0);
    expect(chain.b.row).toBe(0);
    expect(chain.c.row).toBe(0);
  });

  it('does not infinite-loop on a stray cycle', () => {
    const nodes: LayoutNode[] = [
      { id: 'a', lineId: 'l1' },
      { id: 'b', lineId: 'l1' },
    ];
    // a -> b -> a (should not happen, but guard defensively).
    const prereqs = { a: ['b'], b: ['a'] };
    const out = layoutStations(nodes, prereqs);
    expect(out.a).toBeDefined();
    expect(out.b).toBeDefined();
    // Coordinates are finite numbers.
    expect(Number.isFinite(out.a.col)).toBe(true);
    expect(Number.isFinite(out.b.col)).toBe(true);
  });

  it('orders bands so a connected line clusters next to its partner', () => {
    // Lines appear l1, l2, l3. l1 only connects to l3 (a→c); l2 is unconnected.
    // First-appearance order would put l3 two bands from l1; adjacency ordering
    // pulls l3 to the band right after l1 and pushes the unconnected l2 last.
    const nodes: LayoutNode[] = [
      { id: 'a', lineId: 'l1' }, // col 0
      { id: 'b', lineId: 'l2' }, // col 0, unconnected
      { id: 'c', lineId: 'l3' }, // col 1, depends on a (cross-line l1→l3)
    ];
    const out = layoutStations(nodes, { c: ['a'] });
    expect(out.a.row).toBe(0); // l1 → band 0
    expect(out.c.row).toBe(1); // l3 clustered into band 1, adjacent to l1
    expect(out.b.row).toBe(2); // l2 (unconnected) pushed to the last band
  });

  it('orders same-band column collisions by prerequisite barycentre', () => {
    // Two l1 sources stacked at rows 0 and 1; two l1 targets collide in col 1.
    // Node order is [top, bot, t1, t2] where t1 depends on the BOTTOM source and
    // t2 on the TOP source. Barycentre ordering places each target on its
    // source's row (t2 row 0, t1 row 1) instead of crossing.
    const nodes: LayoutNode[] = [
      { id: 'top', lineId: 'l1' },
      { id: 'bot', lineId: 'l1' },
      { id: 't1', lineId: 'l1' },
      { id: 't2', lineId: 'l1' },
    ];
    const out = layoutStations(nodes, { t1: ['bot'], t2: ['top'] });
    expect(out.top).toMatchObject({ col: 0, row: 0 });
    expect(out.bot).toMatchObject({ col: 0, row: 1 });
    expect(out.t2).toMatchObject({ col: 1, row: 0 }); // follows top, no crossing
    expect(out.t1).toMatchObject({ col: 1, row: 1 }); // follows bot, no crossing
  });
});

describe('relayoutStations', () => {
  it('writes col/row/lp from the graph onto each station', () => {
    // a → b → c chain; incoming stale coordinates are overwritten by depth.
    const stations = [
      makeStation('a', ['l1']),
      makeStation('b', ['l1']),
      makeStation('c', ['l1']),
    ];
    const edges: Edge[] = [
      { from: 'a', to: 'b', line: 'l1' },
      { from: 'b', to: 'c', line: 'l1' },
    ];
    const out = relayoutStations(stations, edges);
    const byId = Object.fromEntries(out.map(s => [s.id, s]));
    expect(byId.a.col).toBe(0);
    expect(byId.b.col).toBe(1);
    expect(byId.c.col).toBe(2);
    // Same line, no crossing → straight on one row.
    expect([byId.a.row, byId.b.row, byId.c.row]).toEqual([0, 0, 0]);
    expect(byId.a.lp).toBe('top');
  });

  it('preserves every non-position field', () => {
    const stations = [
      makeStation('a', ['l1'], { name: 'Alpha', status: 'done', owner: 'me', tags: ['x', 'y'] }),
    ];
    const [out] = relayoutStations(stations, []);
    expect(out).toMatchObject({
      id: 'a', name: 'Alpha', lines: ['l1'], status: 'done', owner: 'me', tags: ['x', 'y'],
    });
  });

  it('bands an interchange on its primary (first) line', () => {
    // a on l1; b is an interchange [l2, l1]; c on l1. No edges, so bands keep
    // first-appearance order: l1→band 0, l2→band 1. All roots at col 0. The
    // column packs band 0 (l1: a, c) contiguously, then band 1 (l2: b) below.
    const stations = [
      makeStation('a', ['l1']),
      makeStation('b', ['l2', 'l1']),
      makeStation('c', ['l1']),
    ];
    const out = relayoutStations(stations, []);
    const byId = Object.fromEntries(out.map(s => [s.id, s]));
    expect(byId.a.row).toBe(0); // l1 band 0
    expect(byId.c.row).toBe(1); // l1 band 0, next free row
    expect(byId.b.row).toBe(2); // banded on l2 (its first line) → below the l1 pair
  });

  it('is deterministic for identical input', () => {
    const stations = [makeStation('a', ['l1']), makeStation('b', ['l1'])];
    const edges: Edge[] = [{ from: 'a', to: 'b', line: 'l1' }];
    expect(relayoutStations(stations, edges)).toEqual(relayoutStations(stations, edges));
  });

  it('handles an empty map', () => {
    expect(relayoutStations([], [])).toEqual([]);
  });
});
