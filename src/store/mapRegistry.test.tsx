/**
 * Unit tests for MapRegistryProvider.
 *
 * Both `../lib/mapsRepo` and `../lib/committedMaps` are mocked so no real
 * Supabase connection or bundled map files are needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { MapRow } from '../lib/mapsRepo';
import type { CommittedMap } from '../lib/committedMaps';
import type { MapData } from '../lib/maps';
import type { LegacyMap } from '../lib/legacyMaps';

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock mapsRepo — all functions are vi.fn() resolved by default to happy paths.
const mockListMaps = vi.fn();
const mockGetMap = vi.fn();
const mockCreateMap = vi.fn();
const mockSaveMapData = vi.fn();
const mockOverwriteMapData = vi.fn();
const mockRenameMap = vi.fn();
const mockDeleteMap = vi.fn();
const mockDuplicateMap = vi.fn();

vi.mock('../lib/mapsRepo', () => ({
  listMaps: () => mockListMaps(),
  getMap: (id: string) => mockGetMap(id),
  createMap: (id: string, name: string, data: MapData) => mockCreateMap(id, name, data),
  saveMapData: (id: string, data: MapData, expectedVersion: number) =>
    mockSaveMapData(id, data, expectedVersion),
  overwriteMapData: (id: string, data: MapData) => mockOverwriteMapData(id, data),
  renameMap: (id: string, name: string) => mockRenameMap(id, name),
  deleteMap: (id: string) => mockDeleteMap(id),
  duplicateMap: (sourceId: string, newId: string, newName: string) =>
    mockDuplicateMap(sourceId, newId, newName),
}));

// Mock committedMaps — return no committed maps by default (tests override as needed).
const mockGetCommittedMaps = vi.fn();
const mockGetCommittedMapById = vi.fn();

vi.mock('../lib/committedMaps', () => ({
  getCommittedMaps: () => mockGetCommittedMaps(),
  getCommittedMapById: (id: string) => mockGetCommittedMapById(id),
}));

// Mock legacyMaps — return no legacy maps by default (tests override as needed).
const mockDetectLegacyMaps = vi.fn();
const mockGetLegacyImportDone = vi.fn();
const mockSetLegacyImportDone = vi.fn();

vi.mock('../lib/legacyMaps', () => ({
  detectLegacyMaps: (storage: Pick<Storage, 'getItem'>) => mockDetectLegacyMaps(storage),
  getLegacyImportDone: (userId: string | null | undefined) => mockGetLegacyImportDone(userId),
  setLegacyImportDone: (userId: string | null | undefined) => mockSetLegacyImportDone(userId),
}));

// ── Import subject after mocks ────────────────────────────────────────────────
import { MapRegistryProvider, useMapRegistry } from './mapRegistry';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRow(id: string, name: string, version = 1): MapRow {
  return { id, name, version, updatedAt: '2024-01-01T00:00:00Z', owner: 'uid-owner' };
}

function makeMapData(name: string): MapData {
  return {
    project: { name, subtitle: '' },
    lines: [{ id: 'main', name: 'Main Line', color: '#2563C9', short: 'ML' }],
    stations: [],
    edges: [],
  };
}

function makeCommitted(id: string, name: string): CommittedMap {
  return { id, name, data: makeMapData(name) };
}

function makeLegacyMap(id: string, name: string): LegacyMap {
  return { id, name, data: makeMapData(name) };
}

/** A probe component that renders the registry state as data-testid attributes. */
function RegistryProbe() {
  const {
    index,
    loading,
    activeMeta,
    createMap,
    selectMap,
    renameMapById,
    deleteMapById,
    duplicateMapById,
    reimportSourceFor,
    reimportMapById,
    legacyImport,
    importLegacyMaps,
    dismissLegacyImport,
  } = useMapRegistry();

  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="activeMapId">{index.activeMapId ?? 'null'}</span>
      <span data-testid="mapCount">{index.maps.length}</span>
      <span data-testid="mapNames">{index.maps.map(m => m.name).join(',')}</span>
      <span data-testid="activeName">{activeMeta?.name ?? 'null'}</span>
      <button data-testid="btn-create" onClick={() => createMap('New Map')}>create</button>
      <button data-testid="btn-select" onClick={() => selectMap('map-2')}>select</button>
      <button data-testid="btn-rename" onClick={() => renameMapById('map-1', 'Renamed')}>rename</button>
      <button data-testid="btn-delete" onClick={() => deleteMapById('map-1')}>delete</button>
      <button data-testid="btn-duplicate" onClick={() => duplicateMapById('map-1')}>duplicate</button>
      <span data-testid="reimportSource">{reimportSourceFor('committed-roadmap') ?? 'null'}</span>
      <button data-testid="btn-reimport" onClick={() => reimportMapById('committed-roadmap')}>reimport</button>
      <span data-testid="legacyImportCount">{legacyImport !== null ? String(legacyImport.count) : 'null'}</span>
      <button data-testid="btn-import-legacy" onClick={() => void importLegacyMaps()}>import legacy</button>
      <button data-testid="btn-dismiss-legacy" onClick={() => dismissLegacyImport()}>dismiss legacy</button>
    </div>
  );
}

function renderRegistry() {
  return render(
    <MapRegistryProvider>
      <RegistryProbe />
    </MapRegistryProvider>,
  );
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no committed maps.
  mockGetCommittedMaps.mockReturnValue([]);
  mockGetCommittedMapById.mockReturnValue(null);
  // Default: no legacy maps and import already done (so legacy tests are opt-in).
  mockDetectLegacyMaps.mockReturnValue([]);
  mockGetLegacyImportDone.mockReturnValue(true);
  mockSetLegacyImportDone.mockReturnValue(undefined);
  // Default happy-path implementations.
  mockSaveMapData.mockResolvedValue({ status: 'saved', version: 2 });
  mockOverwriteMapData.mockResolvedValue({ version: 2 });
  mockRenameMap.mockResolvedValue(undefined);
  mockDeleteMap.mockResolvedValue(undefined);
  // Clear localStorage keys used by the registry.
  try {
    localStorage.removeItem('pointplanner.activeMapId');
    localStorage.removeItem('pointplanner.committed-seeded');
  } catch {
    // ignore
  }
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MapRegistryProvider — initial load', () => {
  it('starts in loading state and becomes non-loading after mount', async () => {
    mockListMaps.mockResolvedValue([makeRow('map-1', 'Alpha')]);

    renderRegistry();

    // Immediately after render, loading should be true.
    expect(screen.getByTestId('loading').textContent).toBe('true');

    // After the async boot, loading becomes false.
    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });
  });

  it('populates index from listMaps result', async () => {
    mockListMaps.mockResolvedValue([
      makeRow('map-1', 'Alpha'),
      makeRow('map-2', 'Beta'),
    ]);

    renderRegistry();

    await waitFor(() => {
      expect(screen.getByTestId('mapCount').textContent).toBe('2');
    });
    expect(screen.getByTestId('mapNames').textContent).toBe('Alpha,Beta');
    expect(screen.getByTestId('activeMapId').textContent).toBe('map-1');
  });

  it('creates the seed (demo) map when listMaps returns empty', async () => {
    mockListMaps.mockResolvedValue([]);
    const seedRow = makeRow('pointplanner', 'PointPlanner');
    mockCreateMap.mockResolvedValue(seedRow);

    renderRegistry();

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    // createMap must have been called with the seed data
    expect(mockCreateMap).toHaveBeenCalledOnce();
    // After seeding, the new map becomes active
    expect(screen.getByTestId('mapCount').textContent).toBe('1');
  });

  it('respects the stored active pointer when it matches a fetched map', async () => {
    try {
      localStorage.setItem('pointplanner.activeMapId', 'map-2');
    } catch {
      // ignore
    }
    mockListMaps.mockResolvedValue([
      makeRow('map-1', 'Alpha'),
      makeRow('map-2', 'Beta'),
    ]);

    renderRegistry();

    await waitFor(() => {
      expect(screen.getByTestId('activeMapId').textContent).toBe('map-2');
    });
  });

  it('defaults to first map when the stored pointer is stale', async () => {
    try {
      localStorage.setItem('pointplanner.activeMapId', 'map-99');
    } catch {
      // ignore
    }
    mockListMaps.mockResolvedValue([makeRow('map-1', 'Alpha')]);

    renderRegistry();

    await waitFor(() => {
      expect(screen.getByTestId('activeMapId').textContent).toBe('map-1');
    });
  });
});

describe('MapRegistryProvider — createMap', () => {
  it('calls mapsRepo.createMap and adds the new map as active', async () => {
    mockListMaps.mockResolvedValue([makeRow('map-1', 'Alpha')]);
    const newRow = makeRow('new-map', 'New Map');
    mockCreateMap.mockResolvedValue(newRow);

    renderRegistry();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));

    await act(async () => {
      screen.getByTestId('btn-create').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('activeMapId').textContent).toBe('new-map');
    });
    expect(mockCreateMap).toHaveBeenCalledWith(
      expect.any(String),
      'New Map',
      expect.objectContaining({ project: expect.objectContaining({ name: 'New Map' }) }),
    );
  });
});

describe('MapRegistryProvider — selectMap', () => {
  it('switches the active map without a repo call', async () => {
    mockListMaps.mockResolvedValue([
      makeRow('map-1', 'Alpha'),
      makeRow('map-2', 'Beta'),
    ]);

    renderRegistry();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(screen.getByTestId('activeMapId').textContent).toBe('map-1');

    act(() => {
      screen.getByTestId('btn-select').click();
    });

    expect(screen.getByTestId('activeMapId').textContent).toBe('map-2');
    // No mapsRepo calls beyond the initial listMaps
    expect(mockCreateMap).not.toHaveBeenCalled();
  });
});

describe('MapRegistryProvider — renameMapById', () => {
  it('optimistically renames and calls mapsRepo.renameMap', async () => {
    mockListMaps.mockResolvedValue([makeRow('map-1', 'Alpha')]);
    mockRenameMap.mockResolvedValue(undefined);

    renderRegistry();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));

    act(() => {
      screen.getByTestId('btn-rename').click();
    });

    expect(screen.getByTestId('mapNames').textContent).toBe('Renamed');
    await waitFor(() => {
      expect(mockRenameMap).toHaveBeenCalledWith('map-1', 'Renamed');
    });
  });
});

describe('MapRegistryProvider — deleteMapById', () => {
  it('removes the map and calls mapsRepo.deleteMap', async () => {
    mockListMaps.mockResolvedValue([
      makeRow('map-1', 'Alpha'),
      makeRow('map-2', 'Beta'),
    ]);
    mockDeleteMap.mockResolvedValue(undefined);

    renderRegistry();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));

    act(() => {
      screen.getByTestId('btn-delete').click();
    });

    expect(screen.getByTestId('mapCount').textContent).toBe('1');
    // Deleting the active map should switch to another map
    expect(screen.getByTestId('activeMapId').textContent).toBe('map-2');
    await waitFor(() => {
      expect(mockDeleteMap).toHaveBeenCalledWith('map-1');
    });
  });
});

describe('MapRegistryProvider — duplicateMapById', () => {
  it('calls mapsRepo.duplicateMap and makes the copy active', async () => {
    mockListMaps.mockResolvedValue([makeRow('map-1', 'Alpha')]);
    const copyRow = makeRow('alpha-copy', 'Alpha copy');
    mockDuplicateMap.mockResolvedValue(copyRow);

    renderRegistry();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));

    await act(async () => {
      screen.getByTestId('btn-duplicate').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('activeMapId').textContent).toBe('alpha-copy');
    });
    expect(mockDuplicateMap).toHaveBeenCalledWith(
      'map-1',
      expect.any(String),
      'Alpha copy',
    );
  });
});

describe('MapRegistryProvider — committed maps cloud seeding', () => {
  it('creates cloud rows for committed maps not yet seeded', async () => {
    mockListMaps.mockResolvedValue([]);
    // The seed call for the demo map when list is empty
    const seedRow = makeRow('pointplanner', 'PointPlanner');
    const committedRow = makeRow('committed-roadmap', 'Roadmap');
    // createMap is called once for the committed map, then once for the demo seed.
    mockCreateMap
      .mockResolvedValueOnce(committedRow)
      .mockResolvedValueOnce(seedRow);
    mockGetCommittedMaps.mockReturnValue([makeCommitted('roadmap', 'Roadmap')]);

    renderRegistry();

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    // The committed map should have been seeded as a cloud row.
    expect(mockCreateMap).toHaveBeenCalledWith(
      'committed-roadmap',
      'Roadmap',
      expect.any(Object),
    );
  });

  it('does NOT re-seed a committed map that already has a cloud row', async () => {
    // The cloud row already exists for the committed map.
    mockListMaps.mockResolvedValue([makeRow('committed-roadmap', 'Roadmap')]);
    mockGetCommittedMaps.mockReturnValue([makeCommitted('roadmap', 'Roadmap')]);

    renderRegistry();

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    expect(mockCreateMap).not.toHaveBeenCalled();
  });

  it('does NOT re-seed a committed map already in the device seeded set', async () => {
    try {
      localStorage.setItem('pointplanner.committed-seeded', JSON.stringify(['roadmap']));
    } catch {
      // ignore
    }
    mockListMaps.mockResolvedValue([]);
    // Only the demo seed call (no committed seed call)
    mockCreateMap.mockResolvedValue(makeRow('demo', 'PointPlanner'));
    mockGetCommittedMaps.mockReturnValue([makeCommitted('roadmap', 'Roadmap')]);

    renderRegistry();

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    // createMap should only be called for the demo seed, not committed-roadmap
    const committedCalls = mockCreateMap.mock.calls.filter(
      ([id]) => id === 'committed-roadmap',
    );
    expect(committedCalls).toHaveLength(0);
  });
});

describe('MapRegistryProvider — reimport', () => {
  it('reimportSourceFor returns the committed file id for a committed map', async () => {
    mockListMaps.mockResolvedValue([makeRow('committed-roadmap', 'Roadmap')]);
    mockGetCommittedMaps.mockReturnValue([]);
    mockGetCommittedMapById.mockReturnValue(makeCommitted('roadmap', 'Roadmap'));

    renderRegistry();

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('reimportSource').textContent).toBe('roadmap');
  });

  it('reimportMapById overwrites cloud data (unconditional) and renames the map', async () => {
    mockListMaps.mockResolvedValue([makeRow('committed-roadmap', 'Roadmap')]);
    mockGetCommittedMaps.mockReturnValue([]);
    mockGetCommittedMapById.mockReturnValue(makeCommitted('roadmap', 'Roadmap'));
    mockOverwriteMapData.mockResolvedValue({ version: 2 });
    mockRenameMap.mockResolvedValue(undefined);

    renderRegistry();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));

    await act(async () => {
      screen.getByTestId('btn-reimport').click();
    });

    await waitFor(() => {
      expect(mockOverwriteMapData).toHaveBeenCalledWith(
        'committed-roadmap',
        expect.any(Object),
      );
    });
    expect(mockRenameMap).toHaveBeenCalledWith('committed-roadmap', 'Roadmap');
    // saveMapData must NOT be called — reimport uses overwriteMapData instead.
    expect(mockSaveMapData).not.toHaveBeenCalled();
  });
});

// ── Legacy import ─────────────────────────────────────────────────────────────

describe('MapRegistryProvider — legacy import detection', () => {
  it('exposes legacyImport.count when legacy maps are detected and marker is not set', async () => {
    mockListMaps.mockResolvedValue([makeRow('map-1', 'Alpha')]);
    mockGetLegacyImportDone.mockReturnValue(false);
    mockDetectLegacyMaps.mockReturnValue([
      makeLegacyMap('legacy-1', 'Old Map A'),
      makeLegacyMap('legacy-2', 'Old Map B'),
    ]);

    renderRegistry();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));

    expect(screen.getByTestId('legacyImportCount').textContent).toBe('2');
  });

  it('legacyImport is null when the marker is already set', async () => {
    mockListMaps.mockResolvedValue([makeRow('map-1', 'Alpha')]);
    mockGetLegacyImportDone.mockReturnValue(true);  // already done
    mockDetectLegacyMaps.mockReturnValue([makeLegacyMap('legacy-1', 'Old Map A')]);

    renderRegistry();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));

    expect(screen.getByTestId('legacyImportCount').textContent).toBe('null');
  });

  it('legacyImport is null when no legacy maps are detected', async () => {
    mockListMaps.mockResolvedValue([makeRow('map-1', 'Alpha')]);
    mockGetLegacyImportDone.mockReturnValue(false);
    mockDetectLegacyMaps.mockReturnValue([]);

    renderRegistry();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));

    expect(screen.getByTestId('legacyImportCount').textContent).toBe('null');
  });
});

describe('MapRegistryProvider — importLegacyMaps', () => {
  it('calls createMap once per legacy map with collision-free ids and sets the marker', async () => {
    mockListMaps.mockResolvedValue([makeRow('map-1', 'Alpha')]);
    mockGetLegacyImportDone.mockReturnValue(false);
    mockDetectLegacyMaps.mockReturnValue([
      makeLegacyMap('legacy-1', 'Old Map A'),
      makeLegacyMap('legacy-2', 'Old Map B'),
    ]);
    const importedRowA = makeRow('old-map-a', 'Old Map A');
    const importedRowB = makeRow('old-map-b', 'Old Map B');
    mockCreateMap
      .mockResolvedValueOnce(importedRowA)
      .mockResolvedValueOnce(importedRowB);
    // listMaps called again after import to refresh
    mockListMaps.mockResolvedValueOnce([makeRow('map-1', 'Alpha')]).mockResolvedValueOnce([
      makeRow('map-1', 'Alpha'),
      importedRowA,
      importedRowB,
    ]);

    renderRegistry();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));

    await act(async () => {
      screen.getByTestId('btn-import-legacy').click();
    });

    await waitFor(() => {
      expect(mockCreateMap).toHaveBeenCalledTimes(2);
    });

    // Each call uses a generated id (not the legacy id) and correct name + data
    expect(mockCreateMap).toHaveBeenCalledWith(
      expect.any(String),
      'Old Map A',
      expect.objectContaining({ project: expect.objectContaining({ name: 'Old Map A' }) }),
    );
    expect(mockCreateMap).toHaveBeenCalledWith(
      expect.any(String),
      'Old Map B',
      expect.objectContaining({ project: expect.objectContaining({ name: 'Old Map B' }) }),
    );

    // The two generated ids must differ (no collision)
    const [callA, callB] = mockCreateMap.mock.calls as [string, ...unknown[]][];
    expect(callA![0]).not.toBe(callB![0]);

    // Marker must be set after import
    expect(mockSetLegacyImportDone).toHaveBeenCalledOnce();

    // Prompt is cleared
    await waitFor(() => {
      expect(screen.getByTestId('legacyImportCount').textContent).toBe('null');
    });
  });

  it('does NOT delete legacy localStorage entries after import', async () => {
    // Set a fake legacy entry in localStorage to verify it's left untouched.
    try {
      localStorage.setItem('pointplanner.index', JSON.stringify({ maps: [{ id: 'legacy-1', name: 'Old' }] }));
      localStorage.setItem('pointplanner.map.legacy-1', JSON.stringify(makeMapData('Old')));
    } catch { /* ignore */ }

    mockListMaps.mockResolvedValue([makeRow('map-1', 'Alpha')]);
    mockGetLegacyImportDone.mockReturnValue(false);
    mockDetectLegacyMaps.mockReturnValue([makeLegacyMap('legacy-1', 'Old')]);
    mockCreateMap.mockResolvedValue(makeRow('old', 'Old'));

    renderRegistry();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));

    await act(async () => {
      screen.getByTestId('btn-import-legacy').click();
    });

    await waitFor(() => expect(mockCreateMap).toHaveBeenCalled());

    // Legacy keys must still be present
    expect(localStorage.getItem('pointplanner.index')).not.toBeNull();
    expect(localStorage.getItem('pointplanner.map.legacy-1')).not.toBeNull();

    // Clean up
    try {
      localStorage.removeItem('pointplanner.index');
      localStorage.removeItem('pointplanner.map.legacy-1');
    } catch { /* ignore */ }
  });
});

describe('MapRegistryProvider — dismissLegacyImport', () => {
  it('sets the marker and clears the prompt without calling createMap', async () => {
    mockListMaps.mockResolvedValue([makeRow('map-1', 'Alpha')]);
    mockGetLegacyImportDone.mockReturnValue(false);
    mockDetectLegacyMaps.mockReturnValue([makeLegacyMap('legacy-1', 'Old Map A')]);

    renderRegistry();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(screen.getByTestId('legacyImportCount').textContent).toBe('1');

    act(() => {
      screen.getByTestId('btn-dismiss-legacy').click();
    });

    expect(screen.getByTestId('legacyImportCount').textContent).toBe('null');
    expect(mockSetLegacyImportDone).toHaveBeenCalledOnce();
    expect(mockCreateMap).not.toHaveBeenCalled();
  });

  it('does not touch legacy localStorage entries on dismiss', async () => {
    try {
      localStorage.setItem('pointplanner.index', JSON.stringify({ maps: [{ id: 'x', name: 'X' }] }));
    } catch { /* ignore */ }

    mockListMaps.mockResolvedValue([makeRow('map-1', 'Alpha')]);
    mockGetLegacyImportDone.mockReturnValue(false);
    mockDetectLegacyMaps.mockReturnValue([makeLegacyMap('x', 'X')]);

    renderRegistry();
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));

    act(() => {
      screen.getByTestId('btn-dismiss-legacy').click();
    });

    expect(localStorage.getItem('pointplanner.index')).not.toBeNull();

    try {
      localStorage.removeItem('pointplanner.index');
    } catch { /* ignore */ }
  });
});
