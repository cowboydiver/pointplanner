import { describe, it, expect } from 'vitest';
import { committedSourceId, reimportCommittedMapData } from './committedReimport';
import type { CommittedMap } from '../lib/committedMaps';
import type { MapData } from '../lib/maps';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMapData(name: string, stationName: string): MapData {
  return {
    project: { name, subtitle: 'sub' },
    lines: [{ id: 'a', name: 'Alpha', color: '#D8392F', short: 'AL' }],
    stations: [
      {
        id: 'issue-1',
        name: stationName,
        lines: ['a'],
        col: 0,
        row: 0,
        lp: 'top',
        status: 'available',
        desc: 'd',
        owner: 'o',
        role: 'r',
        due: '—',
        est: '—',
        tags: [],
      },
    ],
    edges: [],
  };
}

function makeCommitted(): CommittedMap {
  return { id: 'roadmap', name: 'Roadmap', data: makeMapData('Roadmap', 'File station') };
}

// Minimal Storage double recording the last setItem.
function makeStorage() {
  const store = new Map<string, string>();
  return {
    store,
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

describe('committedSourceId', () => {
  it('returns the committed file id for a committed-backed map id', () => {
    expect(committedSourceId('committed-roadmap')).toBe('roadmap');
  });

  it('returns null for a non-committed map id', () => {
    expect(committedSourceId('seed-roadmap')).toBeNull();
    expect(committedSourceId('blank-123')).toBeNull();
  });
});

describe('reimportCommittedMapData', () => {
  it('overwrites the map data key with a clone of the committed file (file wins)', () => {
    const storage = makeStorage();
    const mapId = 'committed-roadmap';
    // Pre-seed a divergent local copy.
    storage.setItem(
      'pointplanner.map.' + mapId,
      JSON.stringify(makeMapData('Roadmap', 'Local edit')),
    );

    reimportCommittedMapData(storage, mapId, makeCommitted());

    const written = JSON.parse(storage.store.get('pointplanner.map.' + mapId)!) as MapData;
    // Local edit is replaced by the committed file's contents.
    expect(written.stations[0].name).toBe('File station');
  });

  it('writes a clone, not a reference to the committed data', () => {
    const storage = makeStorage();
    const committed = makeCommitted();

    reimportCommittedMapData(storage, 'committed-roadmap', committed);

    // Mutating the committed source afterwards must not affect what was written.
    committed.data.stations[0].name = 'Mutated';
    const written = JSON.parse(
      storage.store.get('pointplanner.map.committed-roadmap')!,
    ) as MapData;
    expect(written.stations[0].name).toBe('File station');
  });

  it('only touches its own map data key, leaving other keys untouched', () => {
    const storage = makeStorage();
    storage.setItem('pointplanner.index', '{"activeMapId":"x","maps":[]}');
    storage.setItem('pointplanner.committed-seeded', '["roadmap"]');

    reimportCommittedMapData(storage, 'committed-roadmap', makeCommitted());

    expect(storage.store.get('pointplanner.index')).toBe('{"activeMapId":"x","maps":[]}');
    expect(storage.store.get('pointplanner.committed-seeded')).toBe('["roadmap"]');
  });
});
