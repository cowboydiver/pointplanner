import { describe, it, expect } from 'vitest';
import { layoutStations, type LayoutNode } from './layout';

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
});
