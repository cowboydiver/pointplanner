import { describe, it, expect } from 'vitest';
import { validateMapData } from './validateMap';
import type { MapData } from './maps';
import type { Station } from '../types';

function station(id: string, lines: string[]): Station {
  return {
    id,
    name: id,
    lines,
    col: 0,
    row: 0,
    lp: 'top',
    status: 'available',
    desc: '',
    owner: '',
    role: '',
    due: '',
    est: '',
    tags: [],
  };
}

function baseMap(): MapData {
  return {
    project: { name: 'X', subtitle: '' },
    lines: [{ id: 'l1', name: 'L1', color: '#000', short: 'L1' }],
    stations: [station('a', ['l1']), station('b', ['l1'])],
    edges: [{ from: 'a', to: 'b', line: 'l1' }],
  };
}

describe('validateMapData', () => {
  it('accepts a well-formed map', () => {
    expect(validateMapData(baseMap())).toEqual([]);
  });

  it('accepts a valid Backlog-only empty map', () => {
    const map: MapData = {
      project: { name: 'X', subtitle: '' },
      lines: [{ id: 'backlog', name: 'Backlog', color: '#000', short: 'BL' }],
      stations: [],
      edges: [],
    };
    expect(validateMapData(map)).toEqual([]);
  });

  it('rejects a map with no lines', () => {
    const map = baseMap();
    map.lines = [];
    const errors = validateMapData(map);
    expect(errors.some(e => /at least one line/i.test(e))).toBe(true);
  });

  it('rejects an edge referencing a missing station', () => {
    const map = baseMap();
    map.edges = [{ from: 'a', to: 'ghost', line: 'l1' }];
    const errors = validateMapData(map);
    expect(errors.some(e => /missing station "ghost"/i.test(e))).toBe(true);
  });

  it('rejects an edge referencing a missing line', () => {
    const map = baseMap();
    map.edges = [{ from: 'a', to: 'b', line: 'nope' }];
    const errors = validateMapData(map);
    expect(errors.some(e => /missing line "nope"/i.test(e))).toBe(true);
  });

  it('rejects a station referencing a missing line', () => {
    const map = baseMap();
    map.stations = [station('a', ['ghostline']), station('b', ['l1'])];
    map.edges = [];
    const errors = validateMapData(map);
    expect(errors.some(e => /references missing line "ghostline"/i.test(e))).toBe(true);
  });

  it('rejects a cyclic edge graph', () => {
    const map = baseMap();
    map.edges = [
      { from: 'a', to: 'b', line: 'l1' },
      { from: 'b', to: 'a', line: 'l1' },
    ];
    const errors = validateMapData(map);
    expect(errors.some(e => /cycle/i.test(e))).toBe(true);
  });
});
