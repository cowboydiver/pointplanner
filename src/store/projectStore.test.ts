import { describe, it, expect } from 'vitest';
import { reducer, resolveReadOnly, type StoreState } from './reducer';
import type { Line, Station, Edge } from '../types';

const LINES: Line[] = [
  { id: 'a', name: 'Alpha Line', color: '#D8392F', short: 'AL' },
  { id: 'b', name: 'Bravo Line', color: '#2563C9', short: 'BR' },
];

function station(id: string, col: number, row: number, status: Station['status'], lines = ['a']): Station {
  return {
    id, name: id, lines, col, row, lp: 'top', status,
    desc: 'd', owner: 'o', role: 'r', due: '—', est: '—', tags: [],
  };
}

// a(done) -> b -> c   (single chain on the Alpha line)
function makeState(): StoreState {
  const stations: Station[] = [
    station('a', 0, 0, 'done'),
    station('b', 1, 0, 'available'),
    station('c', 2, 0, 'locked'),
  ];
  const edges: Edge[] = [
    { from: 'a', to: 'b', line: 'a' },
    { from: 'b', to: 'c', line: 'a' },
  ];
  return {
    project: { name: 'P', subtitle: 'S' },
    lines: LINES,
    stations,
    edges,
    selectedId: 'c',
    highlightLine: null,
    theme: 'light',
    labelAngle: 0,
    labelPivot: 'center',
    modalOpen: true,
    modalOpenCount: 1,
    modalMode: 'edit',
    editId: 'c',
    modalPreset: null,
  };
}

describe('UPDATE_TASK', () => {
  it('rewires prerequisites and drops the old incoming edge', () => {
    const next = reducer(makeState(), {
      type: 'UPDATE_TASK',
      id: 'c',
      data: { name: 'c', lines: ['a'], prereqs: ['a'] },
    });

    const toC = next.edges.filter(e => e.to === 'c');
    expect(toC).toHaveLength(1);
    expect(toC[0].from).toBe('a');
    // the untouched a->b edge survives
    expect(next.edges.some(e => e.from === 'a' && e.to === 'b')).toBe(true);
  });

  it('auto re-places to the right of its new prerequisite', () => {
    const next = reducer(makeState(), {
      type: 'UPDATE_TASK',
      id: 'c',
      data: { name: 'c', lines: ['a'], prereqs: ['a'] },
    });
    const c = next.stations.find(s => s.id === 'c')!;
    // prereq a is at col 0 -> task moves to col 1
    expect(c.col).toBe(1);
  });

  it('recomputes availability after the prereq change', () => {
    // c now depends only on a (done) -> should unlock to available
    const next = reducer(makeState(), {
      type: 'UPDATE_TASK',
      id: 'c',
      data: { name: 'c', lines: ['a'], prereqs: ['a'] },
    });
    expect(next.stations.find(s => s.id === 'c')!.status).toBe('available');
  });

  it('updates metadata, tags and line membership', () => {
    const next = reducer(makeState(), {
      type: 'UPDATE_TASK',
      id: 'b',
      data: {
        name: 'Renamed', lines: ['a', 'b'], prereqs: ['a'],
        owner: 'Maya', desc: 'new desc', tags: ['x', 'y'],
      },
    });
    const b = next.stations.find(s => s.id === 'b')!;
    expect(b.name).toBe('Renamed');
    expect(b.owner).toBe('Maya');
    expect(b.desc).toBe('new desc');
    expect(b.tags).toEqual(['x', 'y']);
    expect(b.lines).toEqual(['a', 'b']);
  });

  it('creates a new line inline and adds it to the task', () => {
    const next = reducer(makeState(), {
      type: 'UPDATE_TASK',
      id: 'b',
      data: {
        name: 'b', lines: ['a'], prereqs: ['a'],
        newLine: { name: 'Charlie Line', color: '#1E9C55', short: '' },
      },
    });
    expect(next.lines.some(l => l.name === 'Charlie Line')).toBe(true);
    const newId = next.lines.find(l => l.name === 'Charlie Line')!.id;
    expect(next.stations.find(s => s.id === 'b')!.lines).toContain(newId);
  });

  it('closes the modal and keeps the task selected', () => {
    const next = reducer(makeState(), {
      type: 'UPDATE_TASK',
      id: 'c',
      data: { name: 'c', lines: ['a'], prereqs: ['b'] },
    });
    expect(next.modalOpen).toBe(false);
    expect(next.modalMode).toBe('create');
    expect(next.editId).toBeNull();
    expect(next.selectedId).toBe('c');
  });

  it('recolors edges when the primary line changes, keeping the structural position', () => {
    // b sits on [a]; make it an interchange on both lines, then swap the primary
    // to "b" while keeping the same set. Positioning is structural now, so the
    // station does not move — but its incident edges follow the new primary line.
    const interchange = reducer(makeState(), {
      type: 'UPDATE_TASK',
      id: 'b',
      data: { name: 'b', lines: ['a', 'b'], prereqs: ['a'] },
    });
    const before = interchange.stations.find(s => s.id === 'b')!;

    const swapped = reducer(interchange, {
      type: 'UPDATE_TASK',
      id: 'b',
      data: { name: 'b', lines: ['b', 'a'], prereqs: ['a'] },
    });
    const after = swapped.stations.find(s => s.id === 'b')!;
    expect(after.lines).toEqual(['b', 'a']);
    // A pure primary-line swap doesn't change the dependency graph, so the
    // position is unchanged…
    expect([after.col, after.row]).toEqual([before.col, before.row]);
    // …the rebuilt incoming edge takes the new primary line ("b")…
    expect(swapped.edges.find(e => e.from === 'a' && e.to === 'b')!.line).toBe('b');
    // …while the outgoing edge keeps "a", which is still in b's line set.
    expect(swapped.edges.find(e => e.from === 'b' && e.to === 'c')!.line).toBe('a');
  });

  it('does NOT move the station on a metadata-only edit (prereqs unchanged)', () => {
    // b currently depends on a; keep that and only rename it.
    const next = reducer(makeState(), {
      type: 'UPDATE_TASK',
      id: 'b',
      data: { name: 'Renamed', lines: ['a'], prereqs: ['a'] },
    });
    const b = next.stations.find(s => s.id === 'b')!;
    expect(b.name).toBe('Renamed');
    expect([b.col, b.row]).toEqual([1, 0]);
  });

  it('does NOT teleport a no-prerequisite root task to col 0', () => {
    const state = makeState();
    // a is a root (no incoming edges); park it away from the origin.
    state.stations = state.stations.map(s => (s.id === 'a' ? { ...s, col: 5, row: 2 } : s));
    const next = reducer(state, {
      type: 'UPDATE_TASK',
      id: 'a',
      data: { name: 'Renamed root', lines: ['a'], prereqs: [] },
    });
    const a = next.stations.find(s => s.id === 'a')!;
    expect([a.col, a.row]).toEqual([5, 2]);
  });

  it('remaps outgoing edges off a line the task no longer sits on', () => {
    // Move b onto line "b" only; its outgoing edge b->c was colored "a".
    const next = reducer(makeState(), {
      type: 'UPDATE_TASK',
      id: 'b',
      data: { name: 'b', lines: ['b'], prereqs: ['a'] },
    });
    const outgoing = next.edges.find(e => e.from === 'b' && e.to === 'c')!;
    expect(outgoing.line).toBe('b');
    // incoming edge is rebuilt on the new primary line too
    expect(next.edges.find(e => e.from === 'a' && e.to === 'b')!.line).toBe('b');
  });

  it('drops prerequisites that would create a cycle (descendant or self)', () => {
    // c is downstream of b (b->c); selecting it as b's prereq must be ignored.
    const next = reducer(makeState(), {
      type: 'UPDATE_TASK',
      id: 'b',
      data: { name: 'b', lines: ['a'], prereqs: ['c', 'b'] },
    });
    expect(next.edges.some(e => e.from === 'c' && e.to === 'b')).toBe(false);
    expect(next.edges.some(e => e.from === 'b' && e.to === 'b')).toBe(false);
    expect(next.edges.filter(e => e.to === 'b')).toHaveLength(0);
  });
});

describe('CREATE_TASK', () => {
  it('lays the new station out by dependency depth, not a frozen guess', () => {
    // New task depends on c (col 2) → it lands one column right, at col 3.
    const next = reducer(makeState(), {
      type: 'CREATE_TASK',
      data: { name: 'Deploy', line: 'a', prereqs: ['c'] },
    });
    const d = next.stations.find(s => s.id === 'deploy')!;
    expect(d.col).toBe(3);
    // The whole chain stays straight on one row.
    expect(next.stations.map(s => s.row)).toEqual([0, 0, 0, 0]);
  });
});

describe('DELETE_TASK', () => {
  it('re-flows survivors so a deleted mid-line station closes the gap', () => {
    // Delete b from a→b→c. spliceStation bridges a→c; relayout pulls c left.
    const next = reducer(makeState(), { type: 'DELETE_TASK', id: 'b' });
    expect(next.stations.map(s => s.id)).toEqual(['a', 'c']);
    const c = next.stations.find(s => s.id === 'c')!;
    // c was at col 2 behind b; with b gone it sits directly right of a at col 1.
    expect(c.col).toBe(1);
    expect(next.edges).toEqual([{ from: 'a', to: 'c', line: 'a' }]);
  });
});

describe('AUTO_ARRANGE', () => {
  it('re-derives every position from the graph and is idempotent', () => {
    const messy = makeState();
    // Scatter the stations off their canonical positions.
    messy.stations = messy.stations.map(s => ({ ...s, col: 7, row: 5 }));

    const once = reducer(messy, { type: 'AUTO_ARRANGE' });
    expect(once.stations.map(s => [s.col, s.row])).toEqual([[0, 0], [1, 0], [2, 0]]);

    const twice = reducer(once, { type: 'AUTO_ARRANGE' });
    expect(twice.stations).toEqual(once.stations);
  });

  it('leaves statuses untouched', () => {
    const next = reducer(makeState(), { type: 'AUTO_ARRANGE' });
    expect(next.stations.map(s => s.status)).toEqual(['done', 'available', 'locked']);
  });
});

describe('SET_DATA', () => {
  it('replaces the whole persisted blob in place', () => {
    const data = {
      project: { name: 'New', subtitle: 'live' },
      lines: [LINES[0]],
      stations: [station('x', 0, 0, 'available')],
      edges: [] as Edge[],
    };
    const next = reducer(makeState(), { type: 'SET_DATA', data });
    expect(next.project).toEqual({ name: 'New', subtitle: 'live' });
    expect(next.stations.map(s => s.id)).toEqual(['x']);
    expect(next.lines).toEqual([LINES[0]]);
    expect(next.edges).toEqual([]);
  });

  it('keeps the selection when it still resolves, clears it otherwise', () => {
    const base = makeState(); // selectedId 'c'
    const keep = reducer(base, {
      type: 'SET_DATA',
      data: { project: base.project, lines: base.lines, stations: base.stations, edges: base.edges },
    });
    expect(keep.selectedId).toBe('c');

    const drop = reducer(base, {
      type: 'SET_DATA',
      data: {
        project: base.project,
        lines: base.lines,
        stations: [station('z', 0, 0, 'available')],
        edges: [],
      },
    });
    expect(drop.selectedId).toBeNull();
  });

  it('preserves view-only state (theme, modal)', () => {
    const base = makeState(); // theme light, modalOpen true
    const next = reducer(base, {
      type: 'SET_DATA',
      data: { project: base.project, lines: base.lines, stations: base.stations, edges: base.edges },
    });
    expect(next.theme).toBe('light');
    expect(next.modalOpen).toBe(true);
  });
});

describe('SET_LABEL_ANGLE', () => {
  it('stores the label angle as view-only state, not in the saved project', () => {
    const next = reducer(makeState(), { type: 'SET_LABEL_ANGLE', angle: 45 });
    expect(next.labelAngle).toBe(45);
    // It must not leak into the persisted map content.
    expect(next.project).not.toHaveProperty('labelAngle');
    expect(next.project.name).toBe('P');
    expect(next.project.subtitle).toBe('S');
  });

  it('can reset the angle back to 0', () => {
    const rotated = reducer(makeState(), { type: 'SET_LABEL_ANGLE', angle: 45 });
    const reset = reducer(rotated, { type: 'SET_LABEL_ANGLE', angle: 0 });
    expect(reset.labelAngle).toBe(0);
  });

  it('supports the negative preset', () => {
    const next = reducer(makeState(), { type: 'SET_LABEL_ANGLE', angle: -45 });
    expect(next.labelAngle).toBe(-45);
  });
});

describe('SET_LABEL_PIVOT', () => {
  it('stores the pivot as view-only state, not in the saved project', () => {
    const next = reducer(makeState(), { type: 'SET_LABEL_PIVOT', pivot: 'left' });
    expect(next.labelPivot).toBe('left');
    expect(next.project).not.toHaveProperty('labelPivot');
  });
});

describe('resolveReadOnly', () => {
  it('is true for a Viewer share regardless of mirror flag', () => {
    expect(resolveReadOnly('viewer', false)).toBe(true);
    expect(resolveReadOnly('viewer', true)).toBe(true);
  });

  it('is true for a mirror even when the caller owns it', () => {
    expect(resolveReadOnly('owner', true)).toBe(true);
    expect(resolveReadOnly('editor', true)).toBe(true);
  });

  it('is false for an editable owner/editor of a non-mirror map', () => {
    expect(resolveReadOnly('owner', false)).toBe(false);
    expect(resolveReadOnly('editor', false)).toBe(false);
  });
});
