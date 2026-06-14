import React, { createContext, useContext, useReducer, useMemo, useEffect, useRef, useState } from 'react';
import { buildIndexes, type Indexes } from '../lib/indexes';
import { createSeedMapData } from '../lib/maps';
import { loadMap, saveMap } from '../lib/mapsRepo';
import { useMapRegistry } from './mapRegistry';
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
  const { reloadActiveMap } = useMapRegistry();

  // Current cloud version of this map. Sent on every save so the server can
  // reject stale writes (#18); updated to the new version on each success.
  const versionRef = useRef(initialVersion);

  // Set true once a save is rejected because the server moved on. While stale,
  // autosave halts and a "map changed — reload" banner is shown.
  const [stale, setStale] = useState(false);

  const indexes = useMemo(
    () => buildIndexes(state.stations, state.lines, state.edges),
    [state.stations, state.lines, state.edges]
  );

  // Debounced autosave of the whole blob to the map's row. Each save sends the
  // loaded version so the server can reject stale writes (#18). Skips the very
  // first run so loading a map doesn't immediately re-save it. Once `stale`,
  // autosave halts entirely — retrying is doomed until the user reloads.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (stale) return;
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
        } else if (result.reason === 'stale') {
          // Someone else saved since we loaded. Stop autosaving and surface the
          // reload prompt; we must not clobber the newer server state.
          setStale(true);
        } else {
          // Transient error — leave the version untouched so the next edit retries.
          console.error('Failed to save map', result.message);
        }
      })();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [mapId, stale, state.project, state.lines, state.stations, state.edges]);

  // Apply theme to body
  useEffect(() => {
    document.body.dataset.theme = state.theme === 'dark' ? 'dark' : '';
  }, [state.theme]);

  return (
    <StoreContext.Provider value={{ state, indexes, dispatch }}>
      {stale && (
        <div className="stale-banner" role="alert">
          <span className="stale-banner-msg">Someone changed this map — reload to continue.</span>
          <button type="button" className="stale-btn primary" onClick={reloadActiveMap}>
            Reload
          </button>
        </div>
      )}
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
