import { describe, it, expect } from 'vitest';
import { LINES, STATIONS } from '../data/seed';
import {
  genMapId,
  createSeedMapData,
  createBlankMapData,
  cloneMapData,
  addMap,
  switchMap,
  renameMap,
  deleteMap,
  duplicateMap,
} from './maps';
import type { MapIndex, MapMeta } from './maps';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIndex(ids: string[], activeId: string | null = null): MapIndex {
  return {
    activeMapId: activeId,
    maps: ids.map(id => ({ id, name: `Map ${id}` })),
  };
}

function makeMeta(id: string, name = `Map ${id}`): MapMeta {
  return { id, name };
}

// ---------------------------------------------------------------------------
// genMapId
// ---------------------------------------------------------------------------

describe('genMapId', () => {
  it('returns base when not in existing list', () => {
    expect(genMapId([], 'project')).toBe('project');
  });

  it('returns "map" when no base provided and list is empty', () => {
    expect(genMapId([])).toBe('map');
  });

  it('appends -2 on first collision', () => {
    expect(genMapId(['project'], 'project')).toBe('project-2');
  });

  it('appends -3 on second collision', () => {
    expect(genMapId(['project', 'project-2'], 'project')).toBe('project-3');
  });

  it('slugifies the base: uppercase → lowercase', () => {
    expect(genMapId([], 'MyProject')).toBe('myproject');
  });

  it('slugifies the base: spaces and punctuation → dashes', () => {
    expect(genMapId([], 'Hello World!')).toBe('hello-world');
  });

  it('strips leading and trailing dashes', () => {
    expect(genMapId([], '--hello--')).toBe('hello');
  });

  it('empty string base falls back to "map"', () => {
    expect(genMapId([], '')).toBe('map');
  });

  it('garbage-only base (all special chars) falls back to "map"', () => {
    expect(genMapId([], '!!!---!!!')).toBe('map');
  });

  it('collision on slugified base', () => {
    expect(genMapId(['hello-world'], 'Hello World!')).toBe('hello-world-2');
  });

  it('collision on fallback "map"', () => {
    expect(genMapId(['map'])).toBe('map-2');
  });

  it('does not mutate the existing array', () => {
    const existing = ['a', 'b'];
    genMapId(existing, 'c');
    expect(existing).toEqual(['a', 'b']);
  });
});

// ---------------------------------------------------------------------------
// createSeedMapData
// ---------------------------------------------------------------------------

describe('createSeedMapData', () => {
  it('returns the same number of lines as the seed', () => {
    const data = createSeedMapData();
    expect(data.lines.length).toBe(LINES.length);
  });

  it('returns the same number of stations as the seed', () => {
    const data = createSeedMapData();
    expect(data.stations.length).toBe(STATIONS.length);
  });

  it('is a deep clone: mutating a station does not affect the seed', () => {
    const data = createSeedMapData();
    const originalFirstName = STATIONS[0].name;
    data.stations[0].name = '__mutated__';
    // Re-read seed directly
    expect(STATIONS[0].name).toBe(originalFirstName);
  });

  it('is a deep clone: calling twice produces independent objects', () => {
    const a = createSeedMapData();
    const b = createSeedMapData();
    a.stations[0].name = '__a_mutated__';
    expect(b.stations[0].name).not.toBe('__a_mutated__');
  });

  it('is a deep clone: mutating lines does not affect the seed', () => {
    const data = createSeedMapData();
    const originalColor = LINES[0].color;
    data.lines[0].color = '#000000';
    expect(LINES[0].color).toBe(originalColor);
  });
});

// ---------------------------------------------------------------------------
// createBlankMapData
// ---------------------------------------------------------------------------

describe('createBlankMapData', () => {
  it('sets project name correctly', () => {
    const data = createBlankMapData('Sprint One');
    expect(data.project.name).toBe('Sprint One');
  });

  it('sets subtitle to empty string', () => {
    const data = createBlankMapData('Sprint One');
    expect(data.project.subtitle).toBe('');
  });

  it('has exactly one line', () => {
    const data = createBlankMapData('Sprint One');
    expect(data.lines.length).toBe(1);
  });

  it('starter line has id "main"', () => {
    const data = createBlankMapData('Sprint One');
    expect(data.lines[0].id).toBe('main');
  });

  it('starter line has name "Main Line"', () => {
    const data = createBlankMapData('Sprint One');
    expect(data.lines[0].name).toBe('Main Line');
  });

  it('starter line has short "ML"', () => {
    const data = createBlankMapData('Sprint One');
    expect(data.lines[0].short).toBe('ML');
  });

  it('has zero stations', () => {
    const data = createBlankMapData('Sprint One');
    expect(data.stations).toEqual([]);
  });

  it('has zero edges', () => {
    const data = createBlankMapData('Sprint One');
    expect(data.edges).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// cloneMapData
// ---------------------------------------------------------------------------

describe('cloneMapData', () => {
  it('returns an equal but distinct object', () => {
    const original = createBlankMapData('Test');
    const clone = cloneMapData(original);
    expect(clone).toEqual(original);
    expect(clone).not.toBe(original);
  });

  it('stations array is deeply independent', () => {
    const original = createSeedMapData();
    const clone = cloneMapData(original);
    clone.stations[0].name = '__clone_mutated__';
    expect(original.stations[0].name).not.toBe('__clone_mutated__');
  });

  it('lines array is deeply independent', () => {
    const original = createSeedMapData();
    const clone = cloneMapData(original);
    clone.lines[0].color = '#ffffff';
    expect(original.lines[0].color).not.toBe('#ffffff');
  });

  it('project object is deeply independent', () => {
    const original = createBlankMapData('Original');
    const clone = cloneMapData(original);
    clone.project.name = 'Mutated';
    expect(original.project.name).toBe('Original');
  });
});

// ---------------------------------------------------------------------------
// addMap
// ---------------------------------------------------------------------------

describe('addMap', () => {
  it('appends the meta to the maps list', () => {
    const index = makeIndex(['a', 'b'], 'a');
    const result = addMap(index, makeMeta('c'));
    expect(result.maps.map(m => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('sets activeMapId to the new meta id', () => {
    const index = makeIndex(['a'], 'a');
    const result = addMap(index, makeMeta('b'));
    expect(result.activeMapId).toBe('b');
  });

  it('does not mutate the original index', () => {
    const index = makeIndex(['a'], 'a');
    const originalMaps = index.maps;
    addMap(index, makeMeta('b'));
    expect(index.maps).toBe(originalMaps);
    expect(index.maps.length).toBe(1);
    expect(index.activeMapId).toBe('a');
  });

  it('works on an empty index', () => {
    const index = makeIndex([], null);
    const result = addMap(index, makeMeta('first'));
    expect(result.maps.length).toBe(1);
    expect(result.activeMapId).toBe('first');
  });
});

// ---------------------------------------------------------------------------
// switchMap
// ---------------------------------------------------------------------------

describe('switchMap', () => {
  it('switches to an existing map id', () => {
    const index = makeIndex(['a', 'b', 'c'], 'a');
    const result = switchMap(index, 'c');
    expect(result.activeMapId).toBe('c');
  });

  it('returns the same index reference for an unknown id', () => {
    const index = makeIndex(['a', 'b'], 'a');
    const result = switchMap(index, 'nonexistent');
    expect(result).toBe(index);
  });

  it('does not mutate the original index', () => {
    const index = makeIndex(['a', 'b'], 'a');
    switchMap(index, 'b');
    expect(index.activeMapId).toBe('a');
  });

  it('switching to current id is a no-op (still returns same or equal)', () => {
    const index = makeIndex(['a', 'b'], 'a');
    const result = switchMap(index, 'a');
    expect(result.activeMapId).toBe('a');
  });
});

// ---------------------------------------------------------------------------
// renameMap
// ---------------------------------------------------------------------------

describe('renameMap', () => {
  it('renames the target map', () => {
    const index = makeIndex(['a', 'b', 'c'], 'a');
    const result = renameMap(index, 'b', 'Brand New Name');
    expect(result.maps.find(m => m.id === 'b')?.name).toBe('Brand New Name');
  });

  it('does not change other maps', () => {
    const index = makeIndex(['a', 'b', 'c'], 'a');
    const result = renameMap(index, 'b', 'Brand New Name');
    expect(result.maps.find(m => m.id === 'a')?.name).toBe('Map a');
    expect(result.maps.find(m => m.id === 'c')?.name).toBe('Map c');
  });

  it('does not change activeMapId', () => {
    const index = makeIndex(['a', 'b'], 'a');
    const result = renameMap(index, 'b', 'New Name');
    expect(result.activeMapId).toBe('a');
  });

  it('does not mutate the original index', () => {
    const index = makeIndex(['a', 'b'], 'a');
    const originalName = index.maps[1].name;
    renameMap(index, 'b', 'Changed');
    expect(index.maps[1].name).toBe(originalName);
  });

  it('is a no-op for unknown id (maps unchanged)', () => {
    const index = makeIndex(['a', 'b'], 'a');
    const result = renameMap(index, 'zzz', 'Name');
    expect(result.maps).toEqual(index.maps);
  });
});

// ---------------------------------------------------------------------------
// deleteMap
// ---------------------------------------------------------------------------

describe('deleteMap', () => {
  it('(a) deleting active map picks the AFTER neighbor', () => {
    // active = 'b' (index 1), after deletion 'c' is at index 1
    const index = makeIndex(['a', 'b', 'c'], 'b');
    const result = deleteMap(index, 'b');
    expect(result.activeMapId).toBe('c');
    expect(result.maps.map(m => m.id)).toEqual(['a', 'c']);
  });

  it('(b) deleting active that is LAST in list picks the BEFORE neighbor', () => {
    const index = makeIndex(['a', 'b', 'c'], 'c');
    const result = deleteMap(index, 'c');
    expect(result.activeMapId).toBe('b');
    expect(result.maps.map(m => m.id)).toEqual(['a', 'b']);
  });

  it('(c) deleting the only map → empty maps + activeMapId null', () => {
    const index = makeIndex(['only'], 'only');
    const result = deleteMap(index, 'only');
    expect(result.maps).toEqual([]);
    expect(result.activeMapId).toBeNull();
  });

  it('(d) deleting a non-active map keeps activeMapId unchanged', () => {
    const index = makeIndex(['a', 'b', 'c'], 'a');
    const result = deleteMap(index, 'c');
    expect(result.activeMapId).toBe('a');
    expect(result.maps.map(m => m.id)).toEqual(['a', 'b']);
  });

  it('(e) unknown id is a no-op (returns same reference)', () => {
    const index = makeIndex(['a', 'b'], 'a');
    const result = deleteMap(index, 'zzz');
    expect(result).toBe(index);
  });

  it('deleting active first map picks the AFTER neighbor (not the before)', () => {
    const index = makeIndex(['a', 'b', 'c'], 'a');
    const result = deleteMap(index, 'a');
    expect(result.activeMapId).toBe('b');
  });

  it('does not mutate the original index', () => {
    const index = makeIndex(['a', 'b', 'c'], 'b');
    const originalMaps = index.maps;
    deleteMap(index, 'b');
    expect(index.maps).toBe(originalMaps);
    expect(index.maps.length).toBe(3);
    expect(index.activeMapId).toBe('b');
  });
});

// ---------------------------------------------------------------------------
// duplicateMap
// ---------------------------------------------------------------------------

describe('duplicateMap', () => {
  it('inserts newMeta immediately after the source', () => {
    const index = makeIndex(['a', 'b', 'c'], 'a');
    const result = duplicateMap(index, 'b', makeMeta('b-copy'));
    expect(result.maps.map(m => m.id)).toEqual(['a', 'b', 'b-copy', 'c']);
  });

  it('sets activeMapId to the new meta id', () => {
    const index = makeIndex(['a', 'b'], 'a');
    const result = duplicateMap(index, 'a', makeMeta('a-copy'));
    expect(result.activeMapId).toBe('a-copy');
  });

  it('appends at end if sourceId not found', () => {
    const index = makeIndex(['a', 'b'], 'a');
    const result = duplicateMap(index, 'zzz', makeMeta('new'));
    expect(result.maps.map(m => m.id)).toEqual(['a', 'b', 'new']);
  });

  it('inserts after last element when source is the last map', () => {
    const index = makeIndex(['a', 'b'], 'a');
    const result = duplicateMap(index, 'b', makeMeta('b-copy'));
    expect(result.maps.map(m => m.id)).toEqual(['a', 'b', 'b-copy']);
  });

  it('inserts after first element when source is the first map', () => {
    const index = makeIndex(['a', 'b', 'c'], 'b');
    const result = duplicateMap(index, 'a', makeMeta('a-copy'));
    expect(result.maps.map(m => m.id)).toEqual(['a', 'a-copy', 'b', 'c']);
  });

  it('does not mutate the original index', () => {
    const index = makeIndex(['a', 'b'], 'a');
    const originalMaps = index.maps;
    duplicateMap(index, 'a', makeMeta('a-copy'));
    expect(index.maps).toBe(originalMaps);
    expect(index.maps.length).toBe(2);
    expect(index.activeMapId).toBe('a');
  });
});
