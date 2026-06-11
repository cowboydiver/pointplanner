import { describe, it, expect } from 'vitest';
import { slugify, findFreeRow, occupied, placeNewStation } from './placement';
import type { Station } from '../types';

function makeStation(id: string, col: number, row: number): Station {
  return {
    id, name: id, lines: ['design'], col, row, lp: 'top',
    status: 'locked', desc: '', owner: '', role: '', due: '', est: '', tags: [],
  };
}

describe('slugify', () => {
  it('basic name → slug', () => {
    const byId: Record<string, Station> = {};
    expect(slugify('My Task', byId)).toBe('my-task');
  });

  it('strips leading/trailing dashes', () => {
    const byId: Record<string, Station> = {};
    expect(slugify('  hello  ', byId)).toBe('hello');
  });

  it('duplicate slug gets -2 suffix', () => {
    const byId: Record<string, Station> = { 'my-task': makeStation('my-task', 0, 0) };
    expect(slugify('My Task', byId)).toBe('my-task-2');
  });

  it('triplicate gets -3 suffix', () => {
    const byId: Record<string, Station> = {
      'my-task': makeStation('my-task', 0, 0),
      'my-task-2': makeStation('my-task-2', 0, 1),
    };
    expect(slugify('My Task', byId)).toBe('my-task-3');
  });

  it('empty name becomes "task"', () => {
    const byId: Record<string, Station> = {};
    expect(slugify('', byId)).toBe('task');
  });

  it('special characters are stripped', () => {
    const byId: Record<string, Station> = {};
    expect(slugify('Hello & World!', byId)).toBe('hello-world');
  });
});

describe('occupied', () => {
  it('returns true when station at col/row exists', () => {
    const stations = [makeStation('a', 3, 2)];
    expect(occupied(3, 2, stations)).toBe(true);
  });

  it('returns false when no station at col/row', () => {
    const stations = [makeStation('a', 3, 2)];
    expect(occupied(3, 3, stations)).toBe(false);
  });
});

describe('findFreeRow', () => {
  it('returns the row itself if empty', () => {
    expect(findFreeRow(0, 2, [])).toBe(2);
  });

  it('finds next free row below when target occupied', () => {
    const stations = [makeStation('a', 0, 2)];
    expect(findFreeRow(0, 2, stations)).toBe(3);
  });

  it('finds row above when below is also occupied', () => {
    const stations = [makeStation('a', 0, 2), makeStation('b', 0, 3)];
    const row = findFreeRow(0, 2, stations);
    expect(row).toBe(1);
  });

  it('avoids negative rows', () => {
    // row 0 occupied, so it tries row+1 first, then row-1 but -1 is invalid
    const stations = [makeStation('a', 0, 0)];
    const row = findFreeRow(0, 0, stations);
    expect(row).toBeGreaterThanOrEqual(0);
    expect(row).toBe(1);
  });
});

describe('placeNewStation', () => {
  it('no prereqs → places at col 0, row 0', () => {
    const pos = placeNewStation('design', [], {}, []);
    expect(pos.col).toBe(0);
    expect(pos.row).toBe(0);
  });

  it('places one column right of prereq', () => {
    const prereq = makeStation('a', 3, 2);
    const pos = placeNewStation('design', ['a'], { a: prereq }, [prereq]);
    expect(pos.col).toBe(4);
  });

  it('inherits row from same-line prereq', () => {
    const prereq = makeStation('a', 3, 2);
    prereq.lines = ['design'];
    const pos = placeNewStation('design', ['a'], { a: prereq }, [prereq]);
    expect(pos.row).toBe(2);
  });

  it('avoids collision with existing station', () => {
    const prereq = makeStation('a', 3, 2);
    prereq.lines = ['design'];
    const blocker = makeStation('b', 4, 2);
    const pos = placeNewStation('design', ['a'], { a: prereq }, [prereq, blocker]);
    expect(pos.col).toBe(4);
    expect(pos.row).not.toBe(2);
  });
});
