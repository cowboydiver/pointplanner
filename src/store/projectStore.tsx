import React, { createContext, useContext, useReducer, useMemo, useEffect } from 'react';
import { buildIndexes, type Indexes } from '../lib/indexes';
import { createSeedMapData } from '../lib/maps';
import { reducer, type StoreState, type PersistedState, type Action } from './reducer';

// Re-export the store's public types so existing imports from this module keep working.
export type { StoreState, Action, LineData, CreateTaskData, EditTaskData } from './reducer';

function mapKey(mapId: string): string {
  return 'pointplanner.map.' + mapId;
}

function loadState(mapId: string): PersistedState {
  try {
    const raw = localStorage.getItem(mapKey(mapId));
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedState;
      if (parsed.project && parsed.lines && parsed.stations && parsed.edges) {
        return parsed;
      }
    }
  } catch {
    // ignore
  }
  // Defensive fallback: registry should have written the key before mount,
  // but if it's missing, start from seed data.
  return createSeedMapData();
}

function saveState(mapId: string, state: PersistedState): void {
  try {
    localStorage.setItem(mapKey(mapId), JSON.stringify({
      project: state.project,
      lines: state.lines,
      stations: state.stations,
      edges: state.edges,
    }));
  } catch {
    // ignore
  }
}

interface StoreContextValue {
  state: StoreState;
  indexes: Indexes;
  dispatch: React.Dispatch<Action>;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function ProjectStoreProvider({ children, mapId }: { children: React.ReactNode; mapId: string }) {
  const persisted = loadState(mapId);
  const initialState: StoreState = {
    ...persisted,
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

  const indexes = useMemo(
    () => buildIndexes(state.stations, state.lines, state.edges),
    [state.stations, state.lines, state.edges]
  );

  // Persist on data changes (also depends on mapId so switching maps re-saves correctly)
  useEffect(() => {
    saveState(mapId, {
      project: state.project,
      lines: state.lines,
      stations: state.stations,
      edges: state.edges,
    });
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
