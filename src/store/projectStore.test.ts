import { describe, it, expect } from 'vitest';
import { reducer, type StoreState } from './projectStore';
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
});
