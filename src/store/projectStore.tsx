import React, {
  createContext,
  useContext,
  useReducer,
  useMemo,
  useEffect,
  useState,
  useRef,
} from 'react';
import { buildIndexes, type Indexes } from '../lib/indexes';
import { createSeedMapData } from '../lib/maps';
import { reducer, type StoreState, type PersistedState, type Action } from './reducer';
import { MapChangedBanner } from '../components/MapChangedBanner';
import * as mapsRepo from '../lib/mapsRepo';

// Re-export the store's public types so existing imports from this module keep working.
export type { StoreState, Action, LineData, CreateTaskData, EditTaskData } from './reducer';

const DEBOUNCE_MS = 800;

interface StoreContextValue {
  state: StoreState;
  indexes: Indexes;
  dispatch: React.Dispatch<Action>;
}

const StoreContext = createContext<StoreContextValue | null>(null);

// ── Inner: initialises reducer synchronously with loaded data ────────────────
function InitialisedStore({
  children,
  mapId,
  initial,
  initialVersion,
}: {
  children: React.ReactNode;
  mapId: string;
  initial: PersistedState;
  initialVersion: number;
}) {
  const initialState: StoreState = {
    ...initial,
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
  const [stale, setStale] = useState(false);

  const indexes = useMemo(
    () => buildIndexes(state.stations, state.lines, state.edges),
    [state.stations, state.lines, state.edges],
  );

  // ── Version tracking ────────────────────────────────────────────────────────
  // Holds the version that was last successfully saved (or loaded). Used as the
  // expectedVersion in the next optimistic-concurrency save.
  const versionRef = useRef<number>(initialVersion);

  // ── Debounced autosave ──────────────────────────────────────────────────────
  // We skip saving the initial loaded state: track whether this is the first
  // render (which reflects the load, not a user edit).
  const isFirstRender = useRef(true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest persisted data + the map it belongs to, so the unmount flush below
  // can save the most recent edit even though it runs with empty deps.
  const latestRef = useRef<{ mapId: string; data: PersistedState } | null>(null);
  // Mirror stale into a ref so the unmount flush can read it without a closure.
  const staleRef = useRef(false);

  useEffect(() => {
    staleRef.current = stale;
  }, [stale]);

  useEffect(() => {
    // On first render this effect fires for the initial state — skip it.
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    // When stale, stop scheduling further autosaves.
    if (staleRef.current) return;

    const persisted: PersistedState = {
      project: state.project,
      lines: state.lines,
      stations: state.stations,
      edges: state.edges,
    };
    latestRef.current = { mapId, data: persisted };

    // Cancel any pending save and schedule a new one.
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      // Double-check stale in case it was set while the timer was pending.
      if (staleRef.current) return;
      const expectedVersion = versionRef.current;
      mapsRepo.saveMapData(mapId, persisted, expectedVersion).then(result => {
        if (result.status === 'saved') {
          versionRef.current = result.version;
        } else {
          // status === 'stale': another Editor saved first.
          staleRef.current = true;
          setStale(true);
        }
      }).catch(() => {
        // Swallow network errors — autosave errors must not crash the app.
      });
    }, DEBOUNCE_MS);
  }, [mapId, state.project, state.lines, state.stations, state.edges]);

  // On unmount (incl. switching maps — the provider is keyed by mapId) flush any
  // pending debounced save immediately, so an edit made just before the switch
  // is not silently lost now that localStorage is no longer a fallback.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        const latest = latestRef.current;
        // Don't flush if we're already stale — would be rejected anyway.
        if (latest && !staleRef.current) {
          mapsRepo.saveMapData(latest.mapId, latest.data, versionRef.current).catch(() => {
            // Swallow — autosave errors must not crash the app.
          });
        }
      }
    };
  }, []);

  // ── Apply theme to body ─────────────────────────────────────────────────────
  useEffect(() => {
    document.body.dataset.theme = state.theme === 'dark' ? 'dark' : '';
  }, [state.theme]);

  return (
    <StoreContext.Provider value={{ state, indexes, dispatch }}>
      {stale && <MapChangedBanner />}
      {children}
    </StoreContext.Provider>
  );
}

// ── Outer: async loader ───────────────────────────────────────────────────────
export function ProjectStoreProvider({
  children,
  mapId,
}: {
  children: React.ReactNode;
  mapId: string;
}) {
  // Track both which mapId we loaded for and its data+version, so we can detect
  // stale data (mapId changed while a load was in flight) without calling
  // setState synchronously inside the effect body.
  const [loadedFor, setLoadedFor] = useState<{
    mapId: string;
    data: PersistedState;
    version: number;
  } | null>(null);

  useEffect(() => {
    let ignore = false;

    async function load() {
      try {
        const result = await mapsRepo.getMap(mapId);
        if (ignore) return;
        setLoadedFor({
          mapId,
          data: result?.data ?? createSeedMapData(),
          version: result?.version ?? 0,
        });
      } catch {
        if (!ignore) setLoadedFor({ mapId, data: createSeedMapData(), version: 0 });
      }
    }

    void load();
    return () => {
      ignore = true;
    };
  }, [mapId]);

  // While loading (or when the loaded data is for a different mapId), render
  // nothing to avoid a flash of stale/empty content.
  if (loadedFor === null || loadedFor.mapId !== mapId) return null;

  return (
    <InitialisedStore mapId={mapId} initial={loadedFor.data} initialVersion={loadedFor.version}>
      {children}
    </InitialisedStore>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within ProjectStoreProvider');
  return ctx;
}
