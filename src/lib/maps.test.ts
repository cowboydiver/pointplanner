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
  mapMetaKey,
} from './maps';
import type { MapIndex, MapMeta } from './maps';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OWNER_A = 'uid-owner-a';
const OWNER_B = 'uid-owner-b';

function makeIndex(ids: string[], activeKey: string | null = null): MapIndex {
  return {
    activeKey,
    maps: ids.map(id => makeMeta(id)),
  };
}

function makeMeta(id: string, name = `Map ${id}`, owner = OWNER_A): MapMeta {
  return { key: mapMetaKey(owner, id), id, owner, name, readOnly: false };
}

function makeSharedMeta(id: string, name = `Map ${id}`, owner = OWNER_B): MapMeta {
  return { key: mapMetaKey(owner, id), id, owner, name, readOnly: true };
}

// ---------------------------------------------------------------------------
// mapMetaKey
// ---------------------------------------------------------------------------

describe('mapMetaKey', () => {
  it('returns owner|id format', () => {
    expect(mapMetaKey('uid-abc', 'my-map')).toBe('uid-abc|my-map');
  });

  it('is unambiguous (owner and id never contain |)', () => {
    const key = mapMetaKey('uid-123', 'roadmap');
    expect(key.split('|')).toHaveLength(2);
    expect(key.split('|')[0]).toBe('uid-123');
    expect(key.split('|')[1]).toBe('roadmap');
  });
});

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
    const index = makeIndex(['a', 'b'], mapMetaKey(OWNER_A, 'a'));
    const result = addMap(index, makeMeta('c'));
    expect(result.maps.map(m => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('sets activeKey to the new meta key', () => {
    const index = makeIndex(['a'], mapMetaKey(OWNER_A, 'a'));
    const newMeta = makeMeta('b');
    const result = addMap(index, newMeta);
    expect(result.activeKey).toBe(newMeta.key);
  });

  it('does not mutate the original index', () => {
    const index = makeIndex(['a'], mapMetaKey(OWNER_A, 'a'));
    const originalMaps = index.maps;
    addMap(index, makeMeta('b'));
    expect(index.maps).toBe(originalMaps);
    expect(index.maps.length).toBe(1);
    expect(index.activeKey).toBe(mapMetaKey(OWNER_A, 'a'));
  });

  it('works on an empty index', () => {
    const index = makeIndex([], null);
    const newMeta = makeMeta('first');
    const result = addMap(index, newMeta);
    expect(result.maps.length).toBe(1);
    expect(result.activeKey).toBe(newMeta.key);
  });
});

// ---------------------------------------------------------------------------
// switchMap
// ---------------------------------------------------------------------------

describe('switchMap', () => {
  it('switches to an existing map by key', () => {
    const metaA = makeMeta('a');
    const metaB = makeMeta('b');
    const metaC = makeMeta('c');
    const index: MapIndex = { activeKey: metaA.key, maps: [metaA, metaB, metaC] };
    const result = switchMap(index, metaC.key);
    expect(result.activeKey).toBe(metaC.key);
  });

  it('returns the same index reference for an unknown key', () => {
    const index = makeIndex(['a', 'b'], mapMetaKey(OWNER_A, 'a'));
    const result = switchMap(index, 'nonexistent');
    expect(result).toBe(index);
  });

  it('does not mutate the original index', () => {
    const metaA = makeMeta('a');
    const metaB = makeMeta('b');
    const index: MapIndex = { activeKey: metaA.key, maps: [metaA, metaB] };
    switchMap(index, metaB.key);
    expect(index.activeKey).toBe(metaA.key);
  });

  it('switching to current key is a no-op (still returns same or equal)', () => {
    const metaA = makeMeta('a');
    const metaB = makeMeta('b');
    const index: MapIndex = { activeKey: metaA.key, maps: [metaA, metaB] };
    const result = switchMap(index, metaA.key);
    expect(result.activeKey).toBe(metaA.key);
  });

  it('handles shared map keys (owner B maps)', () => {
    const owned = makeMeta('roadmap');
    const shared = makeSharedMeta('roadmap'); // same id, different owner
    const index: MapIndex = { activeKey: owned.key, maps: [owned, shared] };
    const result = switchMap(index, shared.key);
    expect(result.activeKey).toBe(shared.key);
  });
});

// ---------------------------------------------------------------------------
// renameMap
// ---------------------------------------------------------------------------

describe('renameMap', () => {
  it('renames the target map by key', () => {
    const metaA = makeMeta('a');
    const metaB = makeMeta('b');
    const metaC = makeMeta('c');
    const index: MapIndex = { activeKey: metaA.key, maps: [metaA, metaB, metaC] };
    const result = renameMap(index, metaB.key, 'Brand New Name');
    expect(result.maps.find(m => m.key === metaB.key)?.name).toBe('Brand New Name');
  });

  it('does not change other maps', () => {
    const metaA = makeMeta('a');
    const metaB = makeMeta('b');
    const metaC = makeMeta('c');
    const index: MapIndex = { activeKey: metaA.key, maps: [metaA, metaB, metaC] };
    const result = renameMap(index, metaB.key, 'Brand New Name');
    expect(result.maps.find(m => m.key === metaA.key)?.name).toBe('Map a');
    expect(result.maps.find(m => m.key === metaC.key)?.name).toBe('Map c');
  });

  it('does not change activeKey', () => {
    const metaA = makeMeta('a');
    const metaB = makeMeta('b');
    const index: MapIndex = { activeKey: metaA.key, maps: [metaA, metaB] };
    const result = renameMap(index, metaB.key, 'New Name');
    expect(result.activeKey).toBe(metaA.key);
  });

  it('does not mutate the original index', () => {
    const metaA = makeMeta('a');
    const metaB = makeMeta('b');
    const index: MapIndex = { activeKey: metaA.key, maps: [metaA, metaB] };
    const originalName = index.maps[1]!.name;
    renameMap(index, metaB.key, 'Changed');
    expect(index.maps[1]!.name).toBe(originalName);
  });

  it('is a no-op for unknown key (maps unchanged)', () => {
    const metaA = makeMeta('a');
    const metaB = makeMeta('b');
    const index: MapIndex = { activeKey: metaA.key, maps: [metaA, metaB] };
    const result = renameMap(index, 'unknown-key', 'Name');
    expect(result.maps).toEqual(index.maps);
  });
});

// ---------------------------------------------------------------------------
// deleteMap
// ---------------------------------------------------------------------------

describe('deleteMap', () => {
  it('(a) deleting active map picks the AFTER neighbor', () => {
    const metaA = makeMeta('a');
    const metaB = makeMeta('b');
    const metaC = makeMeta('c');
    const index: MapIndex = { activeKey: metaB.key, maps: [metaA, metaB, metaC] };
    const result = deleteMap(index, metaB.key);
    expect(result.activeKey).toBe(metaC.key);
    expect(result.maps.map(m => m.id)).toEqual(['a', 'c']);
  });

  it('(b) deleting active that is LAST in list picks the BEFORE neighbor', () => {
    const metaA = makeMeta('a');
    const metaB = makeMeta('b');
    const metaC = makeMeta('c');
    const index: MapIndex = { activeKey: metaC.key, maps: [metaA, metaB, metaC] };
    const result = deleteMap(index, metaC.key);
    expect(result.activeKey).toBe(metaB.key);
    expect(result.maps.map(m => m.id)).toEqual(['a', 'b']);
  });

  it('(c) deleting the only map → empty maps + activeKey null', () => {
    const metaOnly = makeMeta('only');
    const index: MapIndex = { activeKey: metaOnly.key, maps: [metaOnly] };
    const result = deleteMap(index, metaOnly.key);
    expect(result.maps).toEqual([]);
    expect(result.activeKey).toBeNull();
  });

  it('(d) deleting a non-active map keeps activeKey unchanged', () => {
    const metaA = makeMeta('a');
    const metaB = makeMeta('b');
    const metaC = makeMeta('c');
    const index: MapIndex = { activeKey: metaA.key, maps: [metaA, metaB, metaC] };
    const result = deleteMap(index, metaC.key);
    expect(result.activeKey).toBe(metaA.key);
    expect(result.maps.map(m => m.id)).toEqual(['a', 'b']);
  });

  it('(e) unknown key is a no-op (returns same reference)', () => {
    const metaA = makeMeta('a');
    const metaB = makeMeta('b');
    const index: MapIndex = { activeKey: metaA.key, maps: [metaA, metaB] };
    const result = deleteMap(index, 'zzz-unknown-key');
    expect(result).toBe(index);
  });

  it('deleting active first map picks the AFTER neighbor (not the before)', () => {
    const metaA = makeMeta('a');
    const metaB = makeMeta('b');
    const metaC = makeMeta('c');
    const index: MapIndex = { activeKey: metaA.key, maps: [metaA, metaB, metaC] };
    const result = deleteMap(index, metaA.key);
    expect(result.activeKey).toBe(metaB.key);
  });

  it('does not mutate the original index', () => {
    const metaA = makeMeta('a');
    const metaB = makeMeta('b');
    const metaC = makeMeta('c');
    const index: MapIndex = { activeKey: metaB.key, maps: [metaA, metaB, metaC] };
    const originalMaps = index.maps;
    deleteMap(index, metaB.key);
    expect(index.maps).toBe(originalMaps);
    expect(index.maps.length).toBe(3);
    expect(index.activeKey).toBe(metaB.key);
  });

  it('correctly deletes by composite key when two maps share the same slug id', () => {
    const owned = makeMeta('roadmap');           // key = uid-owner-a|roadmap
    const shared = makeSharedMeta('roadmap');    // key = uid-owner-b|roadmap
    const index: MapIndex = { activeKey: owned.key, maps: [owned, shared] };
    const result = deleteMap(index, shared.key);
    expect(result.maps).toHaveLength(1);
    expect(result.maps[0]!.key).toBe(owned.key);
    // owned was not the active one that got deleted; shared was deleted but active stays
    expect(result.activeKey).toBe(owned.key);
  });
});

// ---------------------------------------------------------------------------
// duplicateMap
// ---------------------------------------------------------------------------

describe('duplicateMap', () => {
  it('inserts newMeta immediately after the source', () => {
    const metaA = makeMeta('a');
    const metaB = makeMeta('b');
    const metaC = makeMeta('c');
    const index: MapIndex = { activeKey: metaA.key, maps: [metaA, metaB, metaC] };
    const bCopy = makeMeta('b-copy');
    const result = duplicateMap(index, metaB.key, bCopy);
    expect(result.maps.map(m => m.id)).toEqual(['a', 'b', 'b-copy', 'c']);
  });

  it('sets activeKey to the new meta key', () => {
    const metaA = makeMeta('a');
    const metaB = makeMeta('b');
    const index: MapIndex = { activeKey: metaA.key, maps: [metaA, metaB] };
    const aCopy = makeMeta('a-copy');
    const result = duplicateMap(index, metaA.key, aCopy);
    expect(result.activeKey).toBe(aCopy.key);
  });

  it('appends at end if sourceKey not found', () => {
    const metaA = makeMeta('a');
    const metaB = makeMeta('b');
    const index: MapIndex = { activeKey: metaA.key, maps: [metaA, metaB] };
    const newMeta = makeMeta('new');
    const result = duplicateMap(index, 'zzz-not-a-key', newMeta);
    expect(result.maps.map(m => m.id)).toEqual(['a', 'b', 'new']);
  });

  it('inserts after last element when source is the last map', () => {
    const metaA = makeMeta('a');
    const metaB = makeMeta('b');
    const index: MapIndex = { activeKey: metaA.key, maps: [metaA, metaB] };
    const bCopy = makeMeta('b-copy');
    const result = duplicateMap(index, metaB.key, bCopy);
    expect(result.maps.map(m => m.id)).toEqual(['a', 'b', 'b-copy']);
  });

  it('inserts after first element when source is the first map', () => {
    const metaA = makeMeta('a');
    const metaB = makeMeta('b');
    const metaC = makeMeta('c');
    const index: MapIndex = { activeKey: metaB.key, maps: [metaA, metaB, metaC] };
    const aCopy = makeMeta('a-copy');
    const result = duplicateMap(index, metaA.key, aCopy);
    expect(result.maps.map(m => m.id)).toEqual(['a', 'a-copy', 'b', 'c']);
  });

  it('does not mutate the original index', () => {
    const metaA = makeMeta('a');
    const metaB = makeMeta('b');
    const index: MapIndex = { activeKey: metaA.key, maps: [metaA, metaB] };
    const originalMaps = index.maps;
    duplicateMap(index, metaA.key, makeMeta('a-copy'));
    expect(index.maps).toBe(originalMaps);
    expect(index.maps.length).toBe(2);
    expect(index.activeKey).toBe(metaA.key);
  });
});
