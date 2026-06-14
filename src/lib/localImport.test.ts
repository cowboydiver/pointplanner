import { describe, it, expect } from 'vitest';
import {
  detectLocalMaps,
  hasImportRun,
  markImportRun,
  importDoneKey,
} from './localImport';
import type { MapData } from './maps';

// ---------------------------------------------------------------------------
// In-memory Storage double
// ---------------------------------------------------------------------------

function makeStorage(initial: Record<string, string> = {}): Storage {
  const m = new Map<string, string>(Object.entries(initial));
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    removeItem: (k: string) => m.delete(k),
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
  };
}

function makeMapData(name: string): MapData {
  return {
    project: { name, subtitle: '' },
    lines: [],
    stations: [],
    edges: [],
  };
}

function seedOld(maps: { id: string; name?: string; data?: MapData }[]): Storage {
  const initial: Record<string, string> = {
    'pointplanner.index': JSON.stringify({
      activeMapId: maps[0]?.id ?? null,
      maps: maps.map(m => ({ id: m.id, name: m.name })),
    }),
  };
  for (const m of maps) {
    if (m.data !== undefined) {
      initial['pointplanner.map.' + m.id] = JSON.stringify(m.data);
    }
  }
  return makeStorage(initial);
}

// ---------------------------------------------------------------------------
// detectLocalMaps
// ---------------------------------------------------------------------------

describe('detectLocalMaps', () => {
  it('returns the maps from the index + per-map blobs, using stored names', () => {
    const storage = seedOld([
      { id: 'alpha', name: 'Alpha Plan', data: makeMapData('alpha-internal') },
      { id: 'beta', name: 'Beta Plan', data: makeMapData('beta-internal') },
    ]);

    const result = detectLocalMaps(storage);

    expect(result).toHaveLength(2);
    expect(result.map(r => r.name)).toEqual(['Alpha Plan', 'Beta Plan']);
    expect(result[0].data.project.name).toBe('alpha-internal');
  });

  it('falls back to data.project.name when the index has no name', () => {
    const storage = seedOld([{ id: 'a', data: makeMapData('From Project') }]);
    const result = detectLocalMaps(storage);
    expect(result).toEqual([{ name: 'From Project', data: makeMapData('From Project') }]);
  });

  it('skips entries whose data key is missing', () => {
    const storage = seedOld([
      { id: 'good', name: 'Good', data: makeMapData('g') },
      { id: 'missing', name: 'Missing' }, // no per-map blob written
    ]);
    const result = detectLocalMaps(storage);
    expect(result.map(r => r.name)).toEqual(['Good']);
  });

  it('skips entries whose data blob is malformed JSON or wrong shape', () => {
    const storage = makeStorage({
      'pointplanner.index': JSON.stringify({
        activeMapId: 'a',
        maps: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }],
      }),
      'pointplanner.map.a': '{ not valid json',
      'pointplanner.map.b': JSON.stringify({ project: { name: 'x' } }), // missing arrays
      'pointplanner.map.c': JSON.stringify(makeMapData('ok')),
    });
    const result = detectLocalMaps(storage);
    expect(result.map(r => r.name)).toEqual(['C']);
  });

  it('returns [] when the index is absent', () => {
    expect(detectLocalMaps(makeStorage())).toEqual([]);
  });

  it('returns [] when the index is unparseable', () => {
    const storage = makeStorage({ 'pointplanner.index': 'not json at all' });
    expect(detectLocalMaps(storage)).toEqual([]);
  });

  it('returns [] when the index has no maps array', () => {
    const storage = makeStorage({ 'pointplanner.index': JSON.stringify({ activeMapId: null }) });
    expect(detectLocalMaps(storage)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// hasImportRun / markImportRun
// ---------------------------------------------------------------------------

describe('import-done flag', () => {
  it('is false before and true after markImportRun', () => {
    const storage = makeStorage();
    expect(hasImportRun(storage, 'user-1')).toBe(false);
    markImportRun(storage, 'user-1');
    expect(hasImportRun(storage, 'user-1')).toBe(true);
  });

  it('is namespaced by user id (two users are independent)', () => {
    const storage = makeStorage();
    markImportRun(storage, 'user-1');
    expect(hasImportRun(storage, 'user-1')).toBe(true);
    expect(hasImportRun(storage, 'user-2')).toBe(false);
  });

  it('importDoneKey includes the user id', () => {
    expect(importDoneKey('abc')).toBe('pointplanner.imported.abc');
    expect(importDoneKey('xyz')).not.toBe(importDoneKey('abc'));
  });
});
