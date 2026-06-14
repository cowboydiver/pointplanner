/**
 * Unit tests for src/lib/legacyMaps.ts
 *
 * All tests use a plain object as the Storage-like mock — no real localStorage
 * is touched here.
 */
import { describe, it, expect } from 'vitest';
import { detectLegacyMaps } from './legacyMaps';
import type { MapData } from './maps';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMapData(name = 'Test Map'): MapData {
  return {
    project: { name, subtitle: '' },
    lines: [{ id: 'main', name: 'Main Line', color: '#2563C9', short: 'ML' }],
    stations: [],
    edges: [],
  };
}

/** Build a minimal fake Storage from a plain record. */
function fakeStorage(entries: Record<string, string>): Pick<Storage, 'getItem'> {
  return {
    getItem(key: string): string | null {
      return Object.prototype.hasOwnProperty.call(entries, key)
        ? entries[key]!
        : null;
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('detectLegacyMaps — returns empty for absent keys', () => {
  it('returns [] when storage is empty', () => {
    expect(detectLegacyMaps(fakeStorage({}))).toEqual([]);
  });

  it('returns [] when only current-app keys are present', () => {
    const storage = fakeStorage({
      'pointplanner.activeMapId': 'map-1',
      'pointplanner.committed-seeded': '["roadmap"]',
    });
    expect(detectLegacyMaps(storage)).toEqual([]);
  });
});

describe('detectLegacyMaps — reads from pointplanner.index + map keys', () => {
  it('returns one map when index has one valid entry', () => {
    const data = makeMapData('Alpha');
    const storage = fakeStorage({
      'pointplanner.index': JSON.stringify({ activeMapId: 'map-1', maps: [{ id: 'map-1', name: 'Alpha' }] }),
      'pointplanner.map.map-1': JSON.stringify(data),
    });
    const result = detectLegacyMaps(storage);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('map-1');
    expect(result[0]!.name).toBe('Alpha');
    expect(result[0]!.data.project.name).toBe('Alpha');
  });

  it('returns multiple maps from index', () => {
    const storage = fakeStorage({
      'pointplanner.index': JSON.stringify({
        activeMapId: 'map-1',
        maps: [
          { id: 'map-1', name: 'Alpha' },
          { id: 'map-2', name: 'Beta' },
        ],
      }),
      'pointplanner.map.map-1': JSON.stringify(makeMapData('Alpha')),
      'pointplanner.map.map-2': JSON.stringify(makeMapData('Beta')),
    });
    const result = detectLegacyMaps(storage);
    expect(result).toHaveLength(2);
    expect(result.map(m => m.id)).toEqual(['map-1', 'map-2']);
  });

  it('skips entries whose data key is missing', () => {
    const storage = fakeStorage({
      'pointplanner.index': JSON.stringify({
        activeMapId: 'map-1',
        maps: [
          { id: 'map-1', name: 'Alpha' },
          { id: 'map-2', name: 'Missing' },  // no data key
        ],
      }),
      'pointplanner.map.map-1': JSON.stringify(makeMapData('Alpha')),
    });
    const result = detectLegacyMaps(storage);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('map-1');
  });

  it('skips entries whose data key contains corrupt JSON', () => {
    const storage = fakeStorage({
      'pointplanner.index': JSON.stringify({ maps: [{ id: 'map-1', name: 'Alpha' }] }),
      'pointplanner.map.map-1': 'NOT_JSON{{{',
    });
    expect(detectLegacyMaps(storage)).toEqual([]);
  });

  it('skips entries whose data is valid JSON but not MapData shape', () => {
    const storage = fakeStorage({
      'pointplanner.index': JSON.stringify({ maps: [{ id: 'map-1', name: 'Alpha' }] }),
      'pointplanner.map.map-1': JSON.stringify({ foo: 'bar' }),
    });
    expect(detectLegacyMaps(storage)).toEqual([]);
  });

  it('skips index entries with non-string id or name', () => {
    const storage = fakeStorage({
      'pointplanner.index': JSON.stringify({ maps: [{ id: 42, name: 'Alpha' }] }),
      'pointplanner.map.42': JSON.stringify(makeMapData('Alpha')),
    });
    expect(detectLegacyMaps(storage)).toEqual([]);
  });

  it('does not return duplicate ids even if index lists the same id twice', () => {
    const storage = fakeStorage({
      'pointplanner.index': JSON.stringify({
        maps: [
          { id: 'map-1', name: 'Alpha' },
          { id: 'map-1', name: 'Alpha again' },
        ],
      }),
      'pointplanner.map.map-1': JSON.stringify(makeMapData('Alpha')),
    });
    const result = detectLegacyMaps(storage);
    expect(result).toHaveLength(1);
  });
});

describe('detectLegacyMaps — handles corrupt pointplanner.index JSON', () => {
  it('returns [] when pointplanner.index is not valid JSON', () => {
    const storage = fakeStorage({
      'pointplanner.index': 'NOT_JSON',
    });
    expect(detectLegacyMaps(storage)).toEqual([]);
  });

  it('returns [] when pointplanner.index is valid JSON but not the expected shape', () => {
    const storage = fakeStorage({
      'pointplanner.index': '"just a string"',
    });
    expect(detectLegacyMaps(storage)).toEqual([]);
  });
});

describe('detectLegacyMaps — handles pointplanner.v1 single-map key', () => {
  it('returns one map from pointplanner.v1 when index is absent', () => {
    const data = makeMapData('Old Map');
    const storage = fakeStorage({
      'pointplanner.v1': JSON.stringify(data),
    });
    const result = detectLegacyMaps(storage);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('v1');
    expect(result[0]!.name).toBe('Old Map');
  });

  it('uses project.name as the map name for v1', () => {
    const data = makeMapData('My Project');
    const storage = fakeStorage({
      'pointplanner.v1': JSON.stringify(data),
    });
    expect(detectLegacyMaps(storage)[0]!.name).toBe('My Project');
  });

  it('falls back to "My Map" when project.name is empty in v1', () => {
    const data = makeMapData('');
    const storage = fakeStorage({
      'pointplanner.v1': JSON.stringify(data),
    });
    expect(detectLegacyMaps(storage)[0]!.name).toBe('My Map');
  });

  it('skips pointplanner.v1 when its data is corrupt', () => {
    const storage = fakeStorage({
      'pointplanner.v1': 'INVALID',
    });
    expect(detectLegacyMaps(storage)).toEqual([]);
  });

  it('returns both index maps and v1 map when both are present', () => {
    const storage = fakeStorage({
      'pointplanner.index': JSON.stringify({ maps: [{ id: 'map-1', name: 'Alpha' }] }),
      'pointplanner.map.map-1': JSON.stringify(makeMapData('Alpha')),
      'pointplanner.v1': JSON.stringify(makeMapData('V1 Map')),
    });
    const result = detectLegacyMaps(storage);
    expect(result).toHaveLength(2);
    expect(result.map(m => m.id)).toContain('map-1');
    expect(result.map(m => m.id)).toContain('v1');
  });
});
