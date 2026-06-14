import React, {
  createContext,
  useContext,
  useReducer,
  useMemo,
  useEffect,
  useState,
  useRef,
  useCallback,
} from 'react';
import { buildIndexes, type Indexes } from '../lib/indexes';
import { createSeedMapData } from '../lib/maps';
import { reducer, type StoreState, type PersistedState, type Action } from './reducer';
import { MapChangedBanner } from '../components/MapChangedBanner';
import * as mapsRepo from '../lib/mapsRepo';

// Re-export the store's public types so existing imports from this module keep working.
export type { StoreState, Action, LineData, CreateTaskData, EditTaskData } from './reducer';

const DEBOUNCE_MS = 800;

/**
 * View-only actions that pass through in read-only mode.
 * All other actions are data-mutating and are dropped when readOnly is true.
 */
const VIEW_ONLY_ACTIONS = new Set<Action['type']>([
  'OPEN_DETAIL',
  'CLOSE_DETAIL',
  'SET_HIGHLIGHT_LINE',
  'SET_THEME',
  'OPEN_MODAL',
  'OPEN_EDIT_MODAL',
  'CLOSE_MODAL',
]);

interface StoreContextValue {
  state: StoreState;
  indexes: Indexes;
  dispatch: React.Dispatch<Action>;
  readOnly: boolean;
}

const StoreContext = createContext<StoreContextValue | null>(null);

// ── Inner: initialises reducer synchronously with loaded data ────────────────
function InitialisedStore({
  children,
  mapId,
  owner,
  readOnly,
  initial,
  initialVersion,
}: {
  children: React.ReactNode;
  mapId: string;
  owner: string;
  readOnly: boolean;
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

  const [state, rawDispatch] = useReducer(reducer, initialState);
  const [stale, setStale] = useState(false);

  const indexes = useMemo(
    () => buildIndexes(state.stations, state.lines, state.edges),
    [state.stations, state.lines, state.edges],
  );

  // ── Read-only dispatch gate ─────────────────────────────────────────────────
  // When readOnly is true, only view-only actions pass through; data-mutating
  // actions are silently dropped so the store state can't be changed.
  const dispatch = useCallback(
    (action: Action) => {
      if (readOnly && !VIEW_ONLY_ACTIONS.has(action.type)) return;
      rawDispatch(action);
    },
    [readOnly],
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
    // Read-only maps never autosave.
    if (readOnly) return;

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
  }, [readOnly, mapId, state.project, state.lines, state.stations, state.edges]);

  // On unmount (incl. switching maps — the provider is keyed by mapId) flush any
  // pending debounced save immediately, so an edit made just before the switch
  // is not silently lost now that localStorage is no longer a fallback.
  // Read-only maps skip this — they never have pending saves.
  useEffect(() => {
    if (readOnly) return;
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
  }, [readOnly]);

  // ── Apply theme to body ─────────────────────────────────────────────────────
  useEffect(() => {
    document.body.dataset.theme = state.theme === 'dark' ? 'dark' : '';
  }, [state.theme]);

  // Suppress unused variable warning: owner is passed as a prop for future use
  // (e.g. displaying ownership info) but is not yet needed inside InitialisedStore.
  void owner;

  return (
    <StoreContext.Provider value={{ state, indexes, dispatch, readOnly }}>
      {stale && <MapChangedBanner />}
      {children}
    </StoreContext.Provider>
  );
}

// ── Outer: async loader ───────────────────────────────────────────────────────
export function ProjectStoreProvider({
  children,
  owner,
  id,
  readOnly,
}: {
  children: React.ReactNode;
  /** UUID of the map's owner (used to disambiguate the composite PK on shared maps). */
  owner: string;
  /** Slug id of the map. */
  id: string;
  /** True when the map is shared read-only (viewer mode). */
  readOnly: boolean;
}) {
  // Track both which map we loaded for and its data+version, so we can detect
  // stale data (owner/id changed while a load was in flight) without calling
  // setState synchronously inside the effect body.
  const [loadedFor, setLoadedFor] = useState<{
    owner: string;
    id: string;
    data: PersistedState;
    version: number;
  } | null>(null);

  useEffect(() => {
    let ignore = false;

    async function load() {
      try {
        const result = await mapsRepo.getMap(id, owner);
        if (ignore) return;
        setLoadedFor({
          owner,
          id,
          data: result?.data ?? createSeedMapData(),
          version: result?.version ?? 0,
        });
      } catch {
        if (!ignore) setLoadedFor({ owner, id, data: createSeedMapData(), version: 0 });
      }
    }

    void load();
    return () => {
      ignore = true;
    };
  }, [owner, id]);

  // While loading (or when the loaded data is for a different map), render
  // nothing to avoid a flash of stale/empty content.
  if (loadedFor === null || loadedFor.owner !== owner || loadedFor.id !== id) return null;

  return (
    <InitialisedStore mapId={id} owner={owner} readOnly={readOnly} initial={loadedFor.data} initialVersion={loadedFor.version}>
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
