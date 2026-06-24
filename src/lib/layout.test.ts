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
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
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
      { id: 'a' }, // depth 0
      { id: 'b' }, // depth 1 (after a)
      { id: 'c' }, // a root with no prereqs
      { id: 'd' }, // depends on b (depth 1) and c
    ];
    const prereqs = { b: ['a'], d: ['b', 'c'] };
    const out = layoutStations(nodes, prereqs);
    expect(out.a.col).toBe(0);
    expect(out.b.col).toBe(1);
    // deepest prereq is b at col 1 → d sits at col 2 (not col 1 from c).
    expect(out.d.col).toBe(2);
    // c is a root, so it is pulled right to just left of its only consumer d.
    expect(out.c.col).toBe(1);
  });

  it('packs disconnected roots in array order at column 0', () => {
    const nodes: LayoutNode[] = [
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
    ];
    // No deps → all isolated roots at col 0, packed in array order.
    const out = layoutStations(nodes, {});
    expect(out.a.row).toBe(0);
    expect(out.b.row).toBe(1);
    expect(out.c.row).toBe(2);
    // All at col 0.
    expect([out.a.col, out.b.col, out.c.col]).toEqual([0, 0, 0]);
  });

  it('bumps row deterministically when two stations collide on the same col/row', () => {
    const nodes: LayoutNode[] = [
      { id: 'a' },
      { id: 'b' }, // same line, same col → collides with a
      { id: 'c' }, // collides again
    ];
    // No deps → all isolated roots at col 0.
    const out = layoutStations(nodes, {});
    expect(out.a).toMatchObject({ col: 0, row: 0 });
    expect(out.b).toMatchObject({ col: 0, row: 1 });
    expect(out.c).toMatchObject({ col: 0, row: 2 });
  });

  it('is deterministic: identical input yields identical output', () => {
    const nodes: LayoutNode[] = [
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
    ];
    const prereqs = { b: ['a'], c: ['a'] };
    const first = layoutStations(nodes, prereqs);
    const second = layoutStations(nodes, prereqs);
    expect(first).toEqual(second);
  });

  it('applies the lp heuristic (row >= 3 → bottom, else top)', () => {
    // Five isolated roots, all col 0 → rows 0..4.
    const nodes: LayoutNode[] = [
      { id: 'r0' },
      { id: 'r1' },
      { id: 'r2' },
      { id: 'r3' },
      { id: 'r4' },
    ];
    const out = layoutStations(nodes, {});
    expect(out.r0).toMatchObject({ row: 0, lp: 'top' });
    expect(out.r2).toMatchObject({ row: 2, lp: 'top' });
    expect(out.r3).toMatchObject({ row: 3, lp: 'bottom' });
    expect(out.r4).toMatchObject({ row: 4, lp: 'bottom' });
  });

  it('ignores prereqs that are not stations in the node set', () => {
    const nodes: LayoutNode[] = [{ id: 'a' }];
    // a depends on a closed/excluded issue not present as a node.
    const out = layoutStations(nodes, { a: ['ghost'] });
    expect(out.a.col).toBe(0);
  });

  it('packs a transitive chain onto one straight strand', () => {
    // a→b→c chain plus a direct a→c edge. Strand packing aligns all three on the
    // chain's row (a deterministic, straight strand) rather than fanning them out.
    const nodes: LayoutNode[] = [
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
    ];
    const prereqs = { b: ['a'], c: ['b', 'a'] };
    const out = layoutStations(nodes, prereqs);
    expect(out.a).toMatchObject({ col: 0, row: 0 });
    expect(out.b).toMatchObject({ col: 1, row: 0 });
    expect(out.c).toMatchObject({ col: 2, row: 0 });
  });

  it('is deterministic and keeps a simple chain straight on one row', () => {
    const nodes: LayoutNode[] = [
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
    ];
    const prereqs = { b: ['a'], c: ['b', 'a'] };
    expect(layoutStations(nodes, prereqs)).toEqual(layoutStations(nodes, prereqs));
    const chain = layoutStations(nodes, { b: ['a'], c: ['b'] });
    expect(chain.a.row).toBe(0);
    expect(chain.b.row).toBe(0);
    expect(chain.c.row).toBe(0);
  });

  it('does not infinite-loop on a stray cycle', () => {
    const nodes: LayoutNode[] = [
      { id: 'a' },
      { id: 'b' },
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

  it('aligns a dependent on its prerequisite row so the strand stays straight', () => {
    // a (col 0) → c (col 1); b is an unconnected root at col 0. Strand packing
    // puts c on a's row (a straight a→c strand) and the unconnected b below.
    const nodes: LayoutNode[] = [
      { id: 'a' },
      { id: 'b' }, // unconnected root
      { id: 'c' }, // depends on a
    ];
    const out = layoutStations(nodes, { c: ['a'] });
    expect(out.a).toMatchObject({ col: 0, row: 0 });
    expect(out.c).toMatchObject({ col: 1, row: 0 }); // follows a → straight strand
    expect(out.b).toMatchObject({ col: 0, row: 1 }); // unconnected, packed below a
  });

  it('orders column collisions by prerequisite barycentre', () => {
    // Two l1 sources stacked at rows 0 and 1; two l1 targets collide in col 1.
    // Node order is [top, bot, t1, t2] where t1 depends on the BOTTOM source and
    // t2 on the TOP source. Barycentre ordering places each target on its
    // source's row (t2 row 0, t1 row 1) instead of crossing.
    const nodes: LayoutNode[] = [
      { id: 'top' },
      { id: 'bot' },
      { id: 't1' },
      { id: 't2' },
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

  it('stacks disconnected stations in array order at column 0', () => {
    // No edges → every station is an isolated root at col 0; they pack downward
    // in the (stable) array order the caller provides.
    const stations = [
      makeStation('a', ['l1']),
      makeStation('b', ['l2', 'l1']),
      makeStation('c', ['l1']),
    ];
    const out = relayoutStations(stations, []);
    const byId = Object.fromEntries(out.map(s => [s.id, s]));
    expect(byId.a).toMatchObject({ col: 0, row: 0 });
    expect(byId.b).toMatchObject({ col: 0, row: 1 });
    expect(byId.c).toMatchObject({ col: 0, row: 2 });
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
