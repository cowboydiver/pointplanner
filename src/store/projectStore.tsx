import React, { createContext, useContext, useReducer, useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { buildIndexes, type Indexes } from '../lib/indexes';
import { createSeedMapData } from '../lib/maps';
import { loadMap, saveMap, getMapSource, type MapRole, type MapSource } from '../data/mapsRepo';
import { supabase } from '../data/supabase';
import { useMapRegistry } from './mapRegistry';
import { reducer, resolveReadOnly, type StoreState, type PersistedState, type Action } from './reducer';
import { loadLabelAngle, saveLabelAngle, loadLabelPivot, saveLabelPivot } from '../lib/labelAnglePref';
import { MirrorBanner } from '../components/MirrorBanner';

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
  'AUTO_ARRANGE',
]);

interface StoreContextValue {
  state: StoreState;
  indexes: Indexes;
  dispatch: React.Dispatch<Action>;
  // True for a Viewer share OR a GitHub mirror — the UI hides edit affordances
  // and the store drops mutating actions and never autosaves. Owner/Editor of a
  // non-mirror map are NOT read-only.
  readOnly: boolean;
  // True when this map is a read-only mirror of a GitHub repo (migration 0006).
  // Distinguishes a mirror from a Viewer share for UI copy.
  isMirror: boolean;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function ProjectStoreProvider({ children, mapId }: { children: React.ReactNode; mapId: string }) {
  const [loaded, setLoaded] = useState<{ data: PersistedState; version: number; role: MapRole; isMirror: boolean } | null>(null);

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
          setLoaded({ data: rec.data, version: rec.version, role: rec.role, isMirror: rec.isMirror });
        } else {
          // Defensive fallback: row missing (e.g. deleted elsewhere). Start from
          // seed so the editor can still render. A missing row means we own it.
          setLoaded({ data: createSeedMapData(), version: 1, role: 'owner', isMirror: false });
        }
      } catch (err) {
        if (!active) return;
        console.error('Failed to load map', err);
        setLoaded({ data: createSeedMapData(), version: 1, role: 'owner', isMirror: false });
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
    <LoadedStore mapId={mapId} initialData={loaded.data} initialVersion={loaded.version} role={loaded.role} isMirror={loaded.isMirror}>
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
  isMirror,
}: {
  children: React.ReactNode;
  mapId: string;
  initialData: PersistedState;
  initialVersion: number;
  role: MapRole;
  isMirror: boolean;
}) {
  // A Viewer share or a GitHub mirror is read-only. Owner/Editor of a non-mirror
  // map remain editable (#20 keeps Editor writable). When read-only the store
  // drops mutating actions and never autosaves — instead it applies live server
  // updates (SET_DATA) pushed over Realtime.
  const readOnly = resolveReadOnly(role, isMirror);
  const initialState: StoreState = {
    ...initialData,
    selectedId: null,
    highlightLine: null,
    theme: 'light',
    // Per-viewer rotation + pivot, restored from localStorage so they survive
    // reloads and work on read-only mirrors (never touch the saved map). ADR 0003.
    labelAngle: loadLabelAngle(localStorage, mapId),
    labelPivot: loadLabelPivot(localStorage, mapId),
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

  // Live updates for read-only maps (mirrors / Viewer shares). Subscribe to this
  // map's row and apply each server UPDATE in place via SET_DATA — smoother than
  // the remount the stale-write path uses, and safe because a read-only store has
  // no local edits to clobber. Editable maps keep the autosave + stale-banner
  // flow and never subscribe. No-op until migration 0007 adds `maps` to the
  // Realtime publication (the channel simply receives no events).
  useEffect(() => {
    if (!readOnly) return;
    const channel = supabase
      .channel(`map:${mapId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'maps', filter: `id=eq.${mapId}` },
        payload => {
          const row = payload.new as { data?: PersistedState; version?: number };
          if (row?.data) {
            if (typeof row.version === 'number') versionRef.current = row.version;
            dispatch({ type: 'SET_DATA', data: row.data });
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [mapId, readOnly, dispatch]);

  // Mirror origin + last-sync status, for the info strip. Only mirrors have a
  // `map_sources` row; re-fetched when a live update lands so "synced …" stays
  // fresh. Owner-only via RLS, so a Viewer mirror simply shows no status.
  const [source, setSource] = useState<MapSource | null>(null);
  useEffect(() => {
    if (!isMirror) return;
    let active = true;
    void (async () => {
      try {
        const s = await getMapSource(mapId);
        if (active) setSource(s);
      } catch (err) {
        if (active) console.error('Failed to load mirror status', err);
      }
    })();
    return () => {
      active = false;
    };
    // state.project is a cheap proxy for "a live update landed" — refetch status then.
  }, [mapId, isMirror, state.project]);

  // Apply theme to body
  useEffect(() => {
    document.body.dataset.theme = state.theme === 'dark' ? 'dark' : '';
  }, [state.theme]);

  // Persist the per-viewer label rotation for this map. Unlike map content this
  // is a private display preference, so it goes to localStorage (not the saved
  // blob) and applies even on read-only mirrors / Viewer shares.
  useEffect(() => {
    saveLabelAngle(localStorage, mapId, state.labelAngle);
  }, [mapId, state.labelAngle]);
  useEffect(() => {
    saveLabelPivot(localStorage, mapId, state.labelPivot);
  }, [mapId, state.labelPivot]);

  return (
    <StoreContext.Provider value={{ state, indexes, dispatch, readOnly, isMirror }}>
      {isMirror && <MirrorBanner source={source} />}
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
