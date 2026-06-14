/**
 * Async integration tests for ProjectStoreProvider.
 *
 * `../lib/mapsRepo` is mocked so no Supabase connection is needed. These tests
 * verify:
 *  - getMap is called on mount with (id, owner) and its data initialises the reducer state
 *  - A user edit triggers a debounced saveMapData after the debounce delay
 *  - The initial loaded state is NOT saved (only real edits trigger saves)
 *  - Changing owner/id remounts the store and reloads from the new map
 *  - A stale result from saveMapData stops further autosaves and shows the banner
 *  - Reload (reloadActiveMap) remounts the store via reloadNonce
 *  - In read-only mode: saveMapData is never called, mutating dispatches are dropped
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { MapData } from '../lib/maps';

// ── Mock mapsRepo ──────────────────────────────────────────────────────────────

const mockGetMap = vi.fn();
const mockSaveMapData = vi.fn();

vi.mock('../lib/mapsRepo', () => ({
  getMap: (...args: Parameters<typeof mockGetMap>) => mockGetMap(...args),
  saveMapData: (...args: Parameters<typeof mockSaveMapData>) => mockSaveMapData(...args),
  overwriteMapData: vi.fn().mockResolvedValue({ version: 2 }),
  listMaps: vi.fn().mockResolvedValue([]),
  createMap: vi.fn().mockResolvedValue({ id: 'x', name: 'x', version: 1, updatedAt: '', owner: 'uid-owner' }),
  renameMap: vi.fn().mockResolvedValue(undefined),
  deleteMap: vi.fn().mockResolvedValue(undefined),
  duplicateMap: vi.fn().mockResolvedValue({ id: 'x', name: 'x', version: 1, updatedAt: '', owner: 'uid-owner' }),
}));

// ── Mock mapRegistry — provides reloadActiveMap used by MapChangedBanner ──────

const mockReloadActiveMap = vi.fn();

vi.mock('./mapRegistry', () => ({
  useMapRegistry: () => ({
    index: { activeKey: 'uid-owner|map-1', maps: [] },
    activeMeta: null,
    loading: false,
    reloadNonce: 0,
    createMap: vi.fn(),
    selectMap: vi.fn(),
    renameMapById: vi.fn(),
    deleteMapById: vi.fn(),
    duplicateMapById: vi.fn(),
    reimportSourceFor: vi.fn().mockReturnValue(null),
    reimportMapById: vi.fn(),
    reloadActiveMap: mockReloadActiveMap,
  }),
  MapRegistryProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// ── Import subject after mocks ────────────────────────────────────────────────
import React from 'react';
import { ProjectStoreProvider, useStore } from './projectStore';

// ── Helpers ───────────────────────────────────────────────────────────────────

const OWNER = 'uid-owner';

function makeMapData(name: string): MapData {
  return {
    project: { name, subtitle: 'sub' },
    lines: [{ id: 'line-a', name: 'Alpha', color: '#D8392F', short: 'AL' }],
    stations: [],
    edges: [],
  };
}

/** Probe component that exposes store state via data-testid. */
function StoreProbe() {
  const { state, dispatch, readOnly } = useStore();
  return (
    <div>
      <span data-testid="projectName">{state.project.name}</span>
      <span data-testid="lineCount">{state.lines.length}</span>
      <span data-testid="readOnly">{String(readOnly)}</span>
      <button
        data-testid="btn-add-line"
        onClick={() =>
          dispatch({
            type: 'CREATE_LINE',
            data: { name: 'New Line', color: '#ff0000', short: 'NL' },
          })
        }
      >
        add line
      </button>
      <button
        data-testid="btn-open-detail"
        onClick={() => dispatch({ type: 'OPEN_DETAIL', id: 'some-station' })}
      >
        open detail
      </button>
      <span data-testid="selectedId">{state.selectedId ?? 'null'}</span>
    </div>
  );
}

function renderStore(id: string, owner = OWNER, readOnly = false) {
  return render(
    <ProjectStoreProvider owner={owner} id={id} readOnly={readOnly}>
      <StoreProbe />
    </ProjectStoreProvider>,
  );
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockSaveMapData.mockResolvedValue({ status: 'saved', version: 2 });
  mockReloadActiveMap.mockReset();
});

// ── Tests — async load (real timers) ─────────────────────────────────────────

describe('ProjectStoreProvider — async load', () => {
  it('renders nothing while getMap is pending', () => {
    // getMap never resolves in this test.
    mockGetMap.mockReturnValue(new Promise(() => {}));

    renderStore('map-1');

    // The StoreProbe should not be mounted while loading.
    expect(screen.queryByTestId('projectName')).not.toBeInTheDocument();
  });

  it('initialises state from getMap result', async () => {
    mockGetMap.mockResolvedValue({ data: makeMapData('Loaded Map'), version: 3 });

    renderStore('map-1');

    await waitFor(() => {
      expect(screen.getByTestId('projectName').textContent).toBe('Loaded Map');
    });
  });

  it('calls getMap with (id, owner) for shared maps', async () => {
    mockGetMap.mockResolvedValue({ data: makeMapData('Shared Map'), version: 1 });
    const otherOwner = 'uid-other';

    renderStore('shared-map', otherOwner, true);

    await waitFor(() => {
      expect(screen.getByTestId('projectName').textContent).toBe('Shared Map');
    });
    expect(mockGetMap).toHaveBeenCalledWith('shared-map', otherOwner);
  });

  it('falls back to seed data when getMap returns null', async () => {
    mockGetMap.mockResolvedValue(null);

    renderStore('map-1');

    await waitFor(() => {
      // Seed data has a non-empty project name.
      expect(screen.getByTestId('projectName')).toBeInTheDocument();
    });
    expect(screen.getByTestId('projectName').textContent!.length).toBeGreaterThan(0);
  });

  it('falls back to seed data when getMap throws', async () => {
    mockGetMap.mockRejectedValue(new Error('network error'));

    renderStore('map-1');

    await waitFor(() => {
      expect(screen.getByTestId('projectName')).toBeInTheDocument();
    });
    expect(screen.getByTestId('projectName').textContent!.length).toBeGreaterThan(0);
  });

  it('exposes readOnly=false for owned maps', async () => {
    mockGetMap.mockResolvedValue({ data: makeMapData('Mine'), version: 1 });

    renderStore('map-1', OWNER, false);

    await waitFor(() => {
      expect(screen.getByTestId('readOnly').textContent).toBe('false');
    });
  });

  it('exposes readOnly=true for shared maps', async () => {
    mockGetMap.mockResolvedValue({ data: makeMapData('Shared'), version: 1 });

    renderStore('shared-map', 'uid-other', true);

    await waitFor(() => {
      expect(screen.getByTestId('readOnly').textContent).toBe('true');
    });
  });
});

describe('ProjectStoreProvider — owner/id changes', () => {
  it('reloads from the new map when owner/id props change', async () => {
    mockGetMap
      .mockResolvedValueOnce({ data: makeMapData('Map One'), version: 1 })
      .mockResolvedValueOnce({ data: makeMapData('Map Two'), version: 1 });

    const { rerender } = renderStore('map-1');

    await waitFor(() => {
      expect(screen.getByTestId('projectName').textContent).toBe('Map One');
    });

    // Switch to a different map (different owner + id).
    rerender(
      <ProjectStoreProvider owner="uid-other" id="map-2" readOnly={true}>
        <StoreProbe />
      </ProjectStoreProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('projectName').textContent).toBe('Map Two');
    });

    expect(mockGetMap).toHaveBeenCalledTimes(2);
    expect(mockGetMap).toHaveBeenNthCalledWith(1, 'map-1', OWNER);
    expect(mockGetMap).toHaveBeenNthCalledWith(2, 'map-2', 'uid-other');
  });
});

// ── Tests — debounced autosave (fake timers) ──────────────────────────────────

describe('ProjectStoreProvider — debounced autosave', () => {
  beforeEach(() => {
    // Use fake timers with shouldAdvanceTime so waitFor still works.
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does NOT save on the initial load', async () => {
    mockGetMap.mockResolvedValue({ data: makeMapData('Test Map'), version: 1 });

    renderStore('map-1');

    await waitFor(() => {
      expect(screen.getByTestId('projectName').textContent).toBe('Test Map');
    });

    // Advance past the debounce window.
    await act(async () => {
      vi.advanceTimersByTime(1200);
    });

    expect(mockSaveMapData).not.toHaveBeenCalled();
  });

  it('saves after a real edit once the debounce window elapses', async () => {
    mockGetMap.mockResolvedValue({ data: makeMapData('Test Map'), version: 1 });

    renderStore('map-1');

    await waitFor(() => {
      expect(screen.getByTestId('projectName').textContent).toBe('Test Map');
    });

    // Perform a user edit (CREATE_LINE mutates lines — a persisted field).
    act(() => {
      screen.getByTestId('btn-add-line').click();
    });

    expect(screen.getByTestId('lineCount').textContent).toBe('2');

    // Before the debounce window closes, saveMapData must NOT have been called.
    expect(mockSaveMapData).not.toHaveBeenCalled();

    // Advance past the 800 ms debounce.
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(mockSaveMapData).toHaveBeenCalledOnce();
    expect(mockSaveMapData).toHaveBeenCalledWith('map-1', expect.any(Object), expect.any(Number));
  });

  it('flushes a pending edit immediately when the store unmounts', async () => {
    mockGetMap.mockResolvedValue({ data: makeMapData('Test Map'), version: 1 });

    const { unmount } = renderStore('map-1');

    await waitFor(() => {
      expect(screen.getByTestId('projectName').textContent).toBe('Test Map');
    });

    // Edit, then unmount BEFORE the debounce window elapses.
    act(() => { screen.getByTestId('btn-add-line').click(); });
    expect(mockSaveMapData).not.toHaveBeenCalled();

    act(() => { unmount(); });

    // The pending edit must be flushed on unmount, not discarded.
    expect(mockSaveMapData).toHaveBeenCalledOnce();
    expect(mockSaveMapData).toHaveBeenCalledWith('map-1', expect.any(Object), expect.any(Number));
  });

  it('debounces rapid edits into a single save', async () => {
    mockGetMap.mockResolvedValue({ data: makeMapData('Test Map'), version: 1 });

    renderStore('map-1');

    await waitFor(() => {
      expect(screen.getByTestId('projectName').textContent).toBe('Test Map');
    });

    // Make edits, advance partially, make another edit.
    act(() => { screen.getByTestId('btn-add-line').click(); });
    await act(async () => { vi.advanceTimersByTime(400); });
    act(() => { screen.getByTestId('btn-add-line').click(); });
    await act(async () => { vi.advanceTimersByTime(400); });
    act(() => { screen.getByTestId('btn-add-line').click(); });

    // Still before the debounce window.
    expect(mockSaveMapData).not.toHaveBeenCalled();

    // Advance past the debounce window after the last edit.
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    // Only one save should have fired.
    expect(mockSaveMapData).toHaveBeenCalledOnce();
  });
});

// ── Tests — read-only mode (fake timers) ─────────────────────────────────────

describe('ProjectStoreProvider — read-only mode', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('never calls saveMapData even after a mutating dispatch attempt', async () => {
    mockGetMap.mockResolvedValue({ data: makeMapData('Shared Map'), version: 1 });

    renderStore('shared-map', 'uid-other', true);

    await waitFor(() => {
      expect(screen.getByTestId('projectName').textContent).toBe('Shared Map');
    });

    // Try to mutate — CREATE_LINE is a mutating action.
    act(() => { screen.getByTestId('btn-add-line').click(); });

    // Advance well past the debounce window.
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    // saveMapData must never be called for read-only maps.
    expect(mockSaveMapData).not.toHaveBeenCalled();
  });

  it('drops mutating actions so state does not change', async () => {
    mockGetMap.mockResolvedValue({ data: makeMapData('Shared Map'), version: 1 });

    renderStore('shared-map', 'uid-other', true);

    await waitFor(() => {
      expect(screen.getByTestId('lineCount').textContent).toBe('1');
    });

    // CREATE_LINE should be dropped.
    act(() => { screen.getByTestId('btn-add-line').click(); });

    // State must remain unchanged.
    expect(screen.getByTestId('lineCount').textContent).toBe('1');
  });

  it('allows view-only actions (OPEN_DETAIL) to pass through in read-only mode', async () => {
    mockGetMap.mockResolvedValue({ data: makeMapData('Shared Map'), version: 1 });

    renderStore('shared-map', 'uid-other', true);

    await waitFor(() => {
      expect(screen.getByTestId('projectName').textContent).toBe('Shared Map');
    });

    act(() => { screen.getByTestId('btn-open-detail').click(); });

    // OPEN_DETAIL is view-only and must still update selectedId.
    expect(screen.getByTestId('selectedId').textContent).toBe('some-station');
  });

  it('does not flush a save on unmount for read-only maps', async () => {
    mockGetMap.mockResolvedValue({ data: makeMapData('Shared Map'), version: 1 });

    const { unmount } = renderStore('shared-map', 'uid-other', true);

    await waitFor(() => {
      expect(screen.getByTestId('projectName').textContent).toBe('Shared Map');
    });

    // Try to mutate (will be dropped by gated dispatch), then unmount.
    act(() => { screen.getByTestId('btn-add-line').click(); });
    act(() => { unmount(); });

    // No save should ever be triggered for read-only maps.
    expect(mockSaveMapData).not.toHaveBeenCalled();
  });
});

// ── Tests — stale detection (fake timers) ─────────────────────────────────────

describe('ProjectStoreProvider — stale detection', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the MapChangedBanner when saveMapData resolves {status:"stale"}', async () => {
    mockGetMap.mockResolvedValue({ data: makeMapData('Test Map'), version: 5 });
    mockSaveMapData.mockResolvedValue({ status: 'stale' });

    renderStore('map-1');

    await waitFor(() => {
      expect(screen.getByTestId('projectName').textContent).toBe('Test Map');
    });

    // Make an edit to trigger autosave.
    act(() => { screen.getByTestId('btn-add-line').click(); });

    // Advance past the debounce window.
    await act(async () => { vi.advanceTimersByTime(1000); });

    // The banner should be visible.
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByRole('alert').textContent).toContain('reload to continue');
    });
  });

  it('stops scheduling further autosaves after a stale result', async () => {
    mockGetMap.mockResolvedValue({ data: makeMapData('Test Map'), version: 5 });
    mockSaveMapData.mockResolvedValue({ status: 'stale' });

    renderStore('map-1');

    await waitFor(() => {
      expect(screen.getByTestId('projectName').textContent).toBe('Test Map');
    });

    // First edit: triggers a save that resolves stale.
    act(() => { screen.getByTestId('btn-add-line').click(); });
    await act(async () => { vi.advanceTimersByTime(1000); });

    // Wait for the banner to confirm stale was detected.
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    const saveCallsAfterStale = mockSaveMapData.mock.calls.length;

    // Make another edit.
    act(() => { screen.getByTestId('btn-add-line').click(); });
    await act(async () => { vi.advanceTimersByTime(1000); });

    // No additional saveMapData calls — stale store must not hammer the server.
    expect(mockSaveMapData).toHaveBeenCalledTimes(saveCallsAfterStale);
  });

  it('Reload button calls reloadActiveMap from map registry', async () => {
    mockGetMap.mockResolvedValue({ data: makeMapData('Test Map'), version: 5 });
    mockSaveMapData.mockResolvedValue({ status: 'stale' });

    renderStore('map-1');

    await waitFor(() => {
      expect(screen.getByTestId('projectName').textContent).toBe('Test Map');
    });

    act(() => { screen.getByTestId('btn-add-line').click(); });
    await act(async () => { vi.advanceTimersByTime(1000); });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    // Click the Reload button in the banner.
    act(() => { screen.getByRole('button', { name: /reload/i }).click(); });

    // reloadActiveMap must have been called — it bumps reloadNonce which causes
    // the parent AppRoot to remount the ProjectStoreProvider (clean load).
    expect(mockReloadActiveMap).toHaveBeenCalledOnce();
  });
});
