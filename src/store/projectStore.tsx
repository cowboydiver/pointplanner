import React, { createContext, useContext, useReducer, useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { buildIndexes, type Indexes } from '../lib/indexes';
import { createSeedMapData } from '../lib/maps';
import { loadMap, saveMap, type MapRole } from '../data/mapsRepo';
import { useMapRegistry } from './mapRegistry';
import { reducer, type StoreState, type PersistedState, type Action } from './reducer';

// Re-export the store's public types so existing imports from this module keep working.
export type { StoreState, Action, LineData, CreateTaskData, EditTaskData } from './reducer';

const AUTOSAVE_DEBOUNCE_MS = 800;

// Actions that mutate the map's persisted state. A read-only (Viewer) store
// drops these; view-only actions (open/close detail, highlight, theme, modals)
// still flow through so navigation works.
const MUTATING_ACTIONS = new Set<Action['type']>([
  'DO_ACTION',
  'CREATE_TASK',
  'UPDATE_TASK',
  'DELETE_TASK',
  'CREATE_LINE',
  'UPDATE_LINE',
  'DELETE_LINE',
]);

interface StoreContextValue {
  state: StoreState;
  indexes: Indexes;
  dispatch: React.Dispatch<Action>;
  // True for a Viewer share — the UI hides edit affordances and the store drops
  // mutating actions and never autosaves. Owner/Editor are NOT read-only.
  readOnly: boolean;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function ProjectStoreProvider({ children, mapId }: { children: React.ReactNode; mapId: string }) {
  const [loaded, setLoaded] = useState<{ data: PersistedState; version: number; role: MapRole } | null>(null);

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
          setLoaded({ data: rec.data, version: rec.version, role: rec.role });
        } else {
          // Defensive fallback: row missing (e.g. deleted elsewhere). Start from
          // seed so the editor can still render. A missing row means we own it.
          setLoaded({ data: createSeedMapData(), version: 1, role: 'owner' });
        }
      } catch (err) {
        if (!active) return;
        console.error('Failed to load map', err);
        setLoaded({ data: createSeedMapData(), version: 1, role: 'owner' });
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
    <LoadedStore mapId={mapId} initialData={loaded.data} initialVersion={loaded.version} role={loaded.role}>
      {children}
    </LoadedStore>
  );
}

function LoadedStore({
  children,
  mapId,
  initialData,
  initialVersion,
  role,
}: {
  children: React.ReactNode;
  mapId: string;
  initialData: PersistedState;
  initialVersion: number;
  role: MapRole;
}) {
  // A Viewer share is read-only. Owner/Editor remain editable (#20 keeps Editor
  // writable). When read-only the store drops mutating actions and never autosaves.
  const readOnly = role === 'viewer';
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

  const [state, rawDispatch] = useReducer(reducer, initialState);
  const { reloadActiveMap } = useMapRegistry();

  // Read-only enforcement: when this is a Viewer share, drop any mutating action
  // before it reaches the reducer. View-only actions (open/close detail,
  // highlight, theme, modals) still flow so navigation keeps working. This is the
  // robust backstop behind the UI hiding edit affordances.
  const dispatch = useCallback<React.Dispatch<Action>>(
    action => {
      if (readOnly && MUTATING_ACTIONS.has(action.type)) return;
      rawDispatch(action);
    },
    [readOnly],
  );

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
    // A Viewer must never write. Skip autosave entirely when read-only.
    if (readOnly) return;
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
  }, [mapId, readOnly, stale, state.project, state.lines, state.stations, state.edges]);

  // Apply theme to body
  useEffect(() => {
    document.body.dataset.theme = state.theme === 'dark' ? 'dark' : '';
  }, [state.theme]);

  return (
    <StoreContext.Provider value={{ state, indexes, dispatch, readOnly }}>
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
