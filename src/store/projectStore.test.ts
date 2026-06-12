import { describe, it, expect } from 'vitest';
import { reducer, type StoreState } from './reducer';
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
