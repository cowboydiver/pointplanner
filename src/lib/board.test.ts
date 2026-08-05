import { describe, it, expect } from 'vitest';
import { buildBoardModel, stopsOnLine, waitingLabel } from './board';
import { buildIndexes } from './indexes';
import type { Edge, Line, Station } from '../types';

const LINES: Line[] = [
  { id: 'design', name: 'Design Line', color: '#D8392F', short: 'DS' },
  { id: 'build', name: 'Build Line', color: '#2563C9', short: 'BD' },
];

function makeStation(
  id: string,
  status: Station['status'],
  extra: Partial<Station> = {},
): Station {
  return {
    id, name: id, lines: ['design'], col: 0, row: 0, lp: 'top',
    status, desc: '', owner: '', role: '', due: '', est: '', tags: [],
    ...extra,
  };
}

function model(stations: Station[], edges: Edge[] = []) {
  return buildBoardModel(stations, LINES, buildIndexes(stations, LINES, edges));
}

describe('buildBoardModel', () => {
  it('groups stations by status', () => {
    const m = model([
      makeStation('a', 'done'),
      makeStation('b', 'active'),
      makeStation('c', 'available'),
      makeStation('d', 'locked'),
    ]);
    expect(m.done.map(e => e.station.id)).toEqual(['a']);
    expect(m.active.map(e => e.station.id)).toEqual(['b']);
    expect(m.available.map(e => e.station.id)).toEqual(['c']);
    expect(m.locked.map(e => e.station.id)).toEqual(['d']);
    expect(m.total).toBe(4);
  });

  it('counts direct dependents', () => {
    const m = model(
      [makeStation('a', 'available'), makeStation('b', 'locked'), makeStation('c', 'locked')],
      [
        { from: 'a', to: 'b', line: 'design' },
        { from: 'a', to: 'c', line: 'design' },
      ],
    );
    expect(m.byId.a.dependents).toBe(2);
    expect(m.byId.b.dependents).toBe(0);
  });

  it('counts transitive downstream stations, excluding itself', () => {
    const m = model(
      [
        makeStation('a', 'available'),
        makeStation('b', 'locked'),
        makeStation('c', 'locked'),
      ],
      [
        { from: 'a', to: 'b', line: 'design' },
        { from: 'b', to: 'c', line: 'design' },
      ],
    );
    expect(m.byId.a.downstream).toBe(2);
    expect(m.byId.b.downstream).toBe(1);
    expect(m.byId.c.downstream).toBe(0);
  });

  it('counts a diamond dependent only once', () => {
    const m = model(
      [
        makeStation('a', 'available'),
        makeStation('left', 'locked'),
        makeStation('right', 'locked'),
        makeStation('merge', 'locked'),
      ],
      [
        { from: 'a', to: 'left', line: 'design' },
        { from: 'a', to: 'right', line: 'design' },
        { from: 'left', to: 'merge', line: 'design' },
        { from: 'right', to: 'merge', line: 'design' },
      ],
    );
    expect(m.byId.a.downstream).toBe(3);
  });

  it('lists only prereqs that are not done as waitingOn', () => {
    const m = model(
      [
        makeStation('done-prereq', 'done'),
        makeStation('open-prereq', 'active'),
        makeStation('target', 'locked'),
      ],
      [
        { from: 'done-prereq', to: 'target', line: 'design' },
        { from: 'open-prereq', to: 'target', line: 'design' },
      ],
    );
    expect(m.byId.target.waitingOn.map(s => s.id)).toEqual(['open-prereq']);
  });

  it('orders available stations by downstream depth, deepest first', () => {
    const m = model(
      [
        makeStation('shallow', 'available'),
        makeStation('deep', 'available'),
        makeStation('mid', 'locked'),
        makeStation('tail', 'locked'),
      ],
      [
        { from: 'deep', to: 'mid', line: 'design' },
        { from: 'mid', to: 'tail', line: 'design' },
      ],
    );
    expect(m.available.map(e => e.station.id)).toEqual(['deep', 'shallow']);
  });

  it('breaks ties on direct dependents, then name', () => {
    const m = model(
      [
        makeStation('zebra', 'available'),
        makeStation('alpha', 'available'),
        makeStation('forked', 'available'),
        makeStation('x', 'locked'),
        makeStation('y', 'locked'),
      ],
      [
        // `forked` has 2 dependents but the same downstream depth (2) as none of
        // the others, so it leads; `alpha` and `zebra` tie at 0 and sort by name.
        { from: 'forked', to: 'x', line: 'design' },
        { from: 'forked', to: 'y', line: 'design' },
      ],
    );
    expect(m.available.map(e => e.station.id)).toEqual(['forked', 'alpha', 'zebra']);
  });

  it('leaves done stations in map order rather than ranking them', () => {
    const m = model([
      makeStation('second', 'done'),
      makeStation('first', 'done'),
    ]);
    expect(m.done.map(e => e.station.id)).toEqual(['second', 'first']);
  });

  it('resolves the primary line for the accent colour', () => {
    const m = model([makeStation('ix', 'available', { lines: ['build', 'design'] })]);
    expect(m.byId.ix.line?.id).toBe('build');
  });

  it('leaves the line undefined when the station references a missing line', () => {
    const m = model([makeStation('orphan', 'available', { lines: ['gone'] })]);
    expect(m.byId.orphan.line).toBeUndefined();
  });
});

describe('stopsOnLine', () => {
  it('returns a line\'s stops in map order', () => {
    const m = model([
      makeStation('third', 'locked', { col: 2, row: 0 }),
      makeStation('first', 'done', { col: 0, row: 0 }),
      makeStation('second', 'available', { col: 1, row: 0 }),
      makeStation('elsewhere', 'locked', { lines: ['build'], col: 0, row: 1 }),
    ]);
    expect(stopsOnLine(m, 'design').map(e => e.station.id)).toEqual([
      'first', 'second', 'third',
    ]);
  });

  it('includes an interchange on every line it serves', () => {
    const m = model([
      makeStation('ix', 'available', { lines: ['design', 'build'] }),
    ]);
    expect(stopsOnLine(m, 'design').map(e => e.station.id)).toEqual(['ix']);
    expect(stopsOnLine(m, 'build').map(e => e.station.id)).toEqual(['ix']);
  });

  it('orders same-column stops by row', () => {
    const m = model([
      makeStation('lower', 'locked', { col: 1, row: 3 }),
      makeStation('upper', 'locked', { col: 1, row: 1 }),
    ]);
    expect(stopsOnLine(m, 'design').map(e => e.station.id)).toEqual(['upper', 'lower']);
  });
});

describe('waitingLabel', () => {
  it('names a station with no dependents a terminus', () => {
    expect(waitingLabel(0)).toBe('terminus');
  });

  it('counts the stations waiting behind it', () => {
    expect(waitingLabel(1)).toBe('1 waiting on this');
    expect(waitingLabel(4)).toBe('4 waiting on this');
  });
});
