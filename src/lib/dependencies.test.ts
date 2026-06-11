import { describe, it, expect } from 'vitest';
import { recompute } from './dependencies';
import type { Station } from '../types';

function makeStation(id: string, status: Station['status']): Station {
  return {
    id, name: id, lines: ['design'], col: 0, row: 0, lp: 'top',
    status, desc: '', owner: '', role: '', due: '', est: '', tags: [],
  };
}

describe('recompute', () => {
  it('task with all prereqs done becomes available', () => {
    const stations = [
      makeStation('a', 'done'),
      makeStation('b', 'locked'),
    ];
    const prereqs: Record<string, string[]> = { b: ['a'] };
    const result = recompute(stations, prereqs);
    expect(result.find(s => s.id === 'b')?.status).toBe('available');
  });

  it('task with no prereqs becomes available', () => {
    const stations = [makeStation('a', 'locked')];
    const prereqs: Record<string, string[]> = {};
    const result = recompute(stations, prereqs);
    expect(result.find(s => s.id === 'a')?.status).toBe('available');
  });

  it('task with incomplete prereq stays locked', () => {
    const stations = [
      makeStation('a', 'active'),
      makeStation('b', 'locked'),
    ];
    const prereqs: Record<string, string[]> = { b: ['a'] };
    const result = recompute(stations, prereqs);
    expect(result.find(s => s.id === 'b')?.status).toBe('locked');
  });

  it('done tasks are not changed', () => {
    const stations = [makeStation('a', 'done')];
    const result = recompute(stations, {});
    expect(result.find(s => s.id === 'a')?.status).toBe('done');
  });

  it('active tasks are not changed', () => {
    const stations = [makeStation('a', 'active')];
    const result = recompute(stations, {});
    expect(result.find(s => s.id === 'a')?.status).toBe('active');
  });

  it('cascade: complete a task makes downstream available', () => {
    // a→b→c; a and b are done; c was locked with b as prereq
    const stations = [
      makeStation('a', 'done'),
      makeStation('b', 'done'),
      makeStation('c', 'locked'),
    ];
    const prereqs: Record<string, string[]> = { b: ['a'], c: ['b'] };
    const result = recompute(stations, prereqs);
    expect(result.find(s => s.id === 'c')?.status).toBe('available');
  });

  it('reopen cascade: reopening a done task locks downstream', () => {
    // a is now active (was done, reopened), b had a as prereq → should go back to locked
    const stations = [
      makeStation('a', 'active'), // reopened
      makeStation('b', 'available'), // was available because a was done — now should lock
    ];
    const prereqs: Record<string, string[]> = { b: ['a'] };
    const result = recompute(stations, prereqs);
    expect(result.find(s => s.id === 'b')?.status).toBe('locked');
  });

  it('multiple prereqs: all must be done', () => {
    const stations = [
      makeStation('a', 'done'),
      makeStation('b', 'active'),
      makeStation('c', 'locked'),
    ];
    const prereqs: Record<string, string[]> = { c: ['a', 'b'] };
    const result = recompute(stations, prereqs);
    expect(result.find(s => s.id === 'c')?.status).toBe('locked');
  });

  it('returns new array (immutable)', () => {
    const stations = [makeStation('a', 'locked')];
    const result = recompute(stations, {});
    expect(result).not.toBe(stations);
  });
});
