import React, { createContext, useContext, useReducer, useMemo, useEffect, useRef, useState } from 'react';
import { buildIndexes, type Indexes } from '../lib/indexes';
import { createSeedMapData } from '../lib/maps';
import { loadMap, saveMap } from '../lib/mapsRepo';
import { reducer, type StoreState, type PersistedState, type Action } from './reducer';

// Re-export the store's public types so existing imports from this module keep working.
export type { StoreState, Action, LineData, CreateTaskData, EditTaskData } from './reducer';

const AUTOSAVE_DEBOUNCE_MS = 800;

interface StoreContextValue {
  state: StoreState;
  indexes: Indexes;
  dispatch: React.Dispatch<Action>;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function ProjectStoreProvider({ children, mapId }: { children: React.ReactNode; mapId: string }) {
  const [loaded, setLoaded] = useState<{ data: PersistedState; version: number } | null>(null);

  // Load the map blob + its version from the cloud before rendering the editor.
  // App keys this provider on the active map id, so a map switch remounts it
  // fresh (`loaded` starts null) — no manual reset needed here.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const rec = await loadMap(mapId);
        if (!active) return;
        if (rec) {
          setLoaded({ data: rec.data, version: rec.version });
        } else {
          // Defensive fallback: row missing (e.g. deleted elsewhere). Start from
          // seed so the editor can still render.
          setLoaded({ data: createSeedMapData(), version: 1 });
        }
      } catch (err) {
        if (!active) return;
        console.error('Failed to load map', err);
        setLoaded({ data: createSeedMapData(), version: 1 });
      }
    })();
    return () => {
      active = false;
    };
  }, [mapId]);

  if (!loaded) {
    return <div className="auth-loading">Loading map…</div>;
  }

  return (
    <LoadedStore mapId={mapId} initialData={loaded.data} initialVersion={loaded.version}>
      {children}
    </LoadedStore>
  );
}

function LoadedStore({
  children,
  mapId,
  initialData,
  initialVersion,
}: {
  children: React.ReactNode;
  mapId: string;
  initialData: PersistedState;
  initialVersion: number;
}) {
  const initialState: StoreState = {
    ...initialData,
    selectedId: null,
    highlightLine: null,
    theme: 'light',
    modalOpen: false,
    modalOpenCount: 0,
    modalMode: 'create',
    editId: null,
    modalPreset: null,
  };

  const [state, dispatch] = useReducer(reducer, initialState);

  // Current cloud version of this map. #18 will send it on save to detect stale
  // writes; for now it just tracks the last successful version.
  const versionRef = useRef(initialVersion);

  const indexes = useMemo(
    () => buildIndexes(state.stations, state.lines, state.edges),
    [state.stations, state.lines, state.edges]
  );

  // Debounced autosave of the whole blob to the map's row. Last-writer-wins for
  // now (no stale guard — that's #18). Skips the very first run so loading a map
  // doesn't immediately re-save it.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const snapshot: PersistedState = {
      project: state.project,
      lines: state.lines,
      stations: state.stations,
      edges: state.edges,
    };
    const handle = setTimeout(() => {
      void (async () => {
        const result = await saveMap(mapId, snapshot, versionRef.current);
        if (result.ok && typeof result.version === 'number') {
          versionRef.current = result.version;
        } else {
          // No stale handling yet (#18) — just log.
          console.error('Failed to save map', result.message);
        }
      })();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [mapId, state.project, state.lines, state.stations, state.edges]);

  // Apply theme to body
  useEffect(() => {
    document.body.dataset.theme = state.theme === 'dark' ? 'dark' : '';
  }, [state.theme]);

  return (
    <StoreContext.Provider value={{ state, indexes, dispatch }}>
      {children}
    </StoreContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within ProjectStoreProvider');
  return ctx;
}
