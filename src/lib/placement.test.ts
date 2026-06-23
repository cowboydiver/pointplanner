import { describe, it, expect } from 'vitest';
import { slugify } from './placement';
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
