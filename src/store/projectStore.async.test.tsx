/**
 * Async integration tests for ProjectStoreProvider.
 *
 * `../lib/mapsRepo` is mocked so no Supabase connection is needed. These tests
 * verify:
 *  - getMap is called on mount and its data initialises the reducer state
 *  - A user edit triggers a debounced saveMapData after the debounce delay
 *  - The initial loaded state is NOT saved (only real edits trigger saves)
 *  - Changing mapId remounts the store and reloads from the new map
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
  listMaps: vi.fn().mockResolvedValue([]),
  createMap: vi.fn().mockResolvedValue({ id: 'x', name: 'x', version: 1, updatedAt: '' }),
  renameMap: vi.fn().mockResolvedValue(undefined),
  deleteMap: vi.fn().mockResolvedValue(undefined),
  duplicateMap: vi.fn().mockResolvedValue({ id: 'x', name: 'x', version: 1, updatedAt: '' }),
}));

// ── Import subject after mocks ────────────────────────────────────────────────
import { ProjectStoreProvider, useStore } from './projectStore';

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  const { state, dispatch } = useStore();
  return (
    <div>
      <span data-testid="projectName">{state.project.name}</span>
      <span data-testid="lineCount">{state.lines.length}</span>
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
    </div>
  );
}

function renderStore(mapId: string) {
  return render(
    <ProjectStoreProvider mapId={mapId}>
      <StoreProbe />
    </ProjectStoreProvider>,
  );
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockSaveMapData.mockResolvedValue({ version: 2 });
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
});

describe('ProjectStoreProvider — mapId changes', () => {
  it('reloads from the new map when mapId prop changes', async () => {
    mockGetMap
      .mockResolvedValueOnce({ data: makeMapData('Map One'), version: 1 })
      .mockResolvedValueOnce({ data: makeMapData('Map Two'), version: 1 });

    const { rerender } = renderStore('map-1');

    await waitFor(() => {
      expect(screen.getByTestId('projectName').textContent).toBe('Map One');
    });

    // Switch to a different map.
    rerender(
      <ProjectStoreProvider mapId="map-2">
        <StoreProbe />
      </ProjectStoreProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('projectName').textContent).toBe('Map Two');
    });

    expect(mockGetMap).toHaveBeenCalledTimes(2);
    expect(mockGetMap).toHaveBeenNthCalledWith(1, 'map-1');
    expect(mockGetMap).toHaveBeenNthCalledWith(2, 'map-2');
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
    expect(mockSaveMapData).toHaveBeenCalledWith('map-1', expect.any(Object));
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
    expect(mockSaveMapData).toHaveBeenCalledWith('map-1', expect.any(Object));
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
