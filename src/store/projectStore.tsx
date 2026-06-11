import React, { createContext, useContext, useReducer, useMemo, useEffect } from 'react';
import type { Project, Line, Station, Edge } from '../types';
import { PROJECT as SEED_PROJECT, LINES as SEED_LINES, STATIONS as SEED_STATIONS, EDGES as SEED_EDGES } from '../data/seed';
import { buildIndexes, type Indexes } from '../lib/indexes';
import { recompute } from '../lib/dependencies';
import { slugify, placeNewStation } from '../lib/placement';

const STORAGE_KEY = 'pointplanner.v1';

interface PersistedState {
  project: Project;
  lines: Line[];
  stations: Station[];
  edges: Edge[];
}

interface StoreState extends PersistedState {
  selectedId: string | null;
  highlightLine: string | null;
  theme: 'light' | 'dark';
  modalOpen: boolean;
  modalOpenCount: number;
  modalPreset: { line?: string; prereqs?: string[] } | null;
}

type Action =
  | { type: 'OPEN_DETAIL'; id: string }
  | { type: 'CLOSE_DETAIL' }
  | { type: 'DO_ACTION'; id: string; act: 'start' | 'done' | 'reopen' }
  | { type: 'SET_HIGHLIGHT_LINE'; lineId: string | null }
  | { type: 'CREATE_TASK'; data: CreateTaskData }
  | { type: 'SET_THEME'; theme: 'light' | 'dark' }
  | { type: 'OPEN_MODAL'; preset?: { line?: string; prereqs?: string[] } }
  | { type: 'CLOSE_MODAL' };

export interface CreateTaskData {
  name: string;
  line: string;
  desc?: string;
  owner?: string;
  role?: string;
  due?: string;
  est?: string;
  prereqs: string[];
  tags?: string[];
}

function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedState;
      if (parsed.project && parsed.lines && parsed.stations && parsed.edges) {
        return parsed;
      }
    }
  } catch {
    // ignore
  }
  return {
    project: SEED_PROJECT,
    lines: SEED_LINES,
    stations: JSON.parse(JSON.stringify(SEED_STATIONS)) as Station[],
    edges: JSON.parse(JSON.stringify(SEED_EDGES)) as Edge[],
  };
}

function saveState(state: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      project: state.project,
      lines: state.lines,
      stations: state.stations,
      edges: state.edges,
    }));
  } catch {
    // ignore
  }
}

function reducer(state: StoreState, action: Action): StoreState {
  switch (action.type) {
    case 'OPEN_DETAIL':
      return { ...state, selectedId: action.id };

    case 'CLOSE_DETAIL':
      return { ...state, selectedId: null };

    case 'DO_ACTION': {
      const updated = state.stations.map(s => {
        if (s.id !== action.id) return s;
        if (action.act === 'start') return { ...s, status: 'active' as const };
        if (action.act === 'done') return { ...s, status: 'done' as const };
        if (action.act === 'reopen') return { ...s, status: 'active' as const };
        return s;
      });
      const idx = buildIndexes(updated, state.lines, state.edges);
      const recomputed = recompute(updated, idx.prereqs);
      return { ...state, stations: recomputed };
    }

    case 'SET_HIGHLIGHT_LINE':
      return { ...state, highlightLine: action.lineId };

    case 'CREATE_TASK': {
      const { data } = action;
      const idx = buildIndexes(state.stations, state.lines, state.edges);
      const pos = placeNewStation(data.line, data.prereqs, idx.stationById, state.stations);
      const id = slugify(data.name, idx.stationById);
      const newStation: Station = {
        id,
        name: data.name,
        lines: [data.line],
        col: pos.col,
        row: pos.row,
        lp: pos.row >= 3 ? 'bottom' : 'top',
        status: 'locked',
        desc: data.desc || 'No description yet.',
        owner: data.owner || 'Unassigned',
        role: data.role || '',
        due: data.due || '—',
        est: data.est || '—',
        tags: data.tags || [],
      };
      const newEdges: Edge[] = data.prereqs.map(pid => ({
        from: pid,
        to: id,
        line: data.line,
        df: idx.stationById[pid]?.row !== pos.row,
      }));
      const newStations = [...state.stations, newStation];
      const newEdgesAll = [...state.edges, ...newEdges];
      const idx2 = buildIndexes(newStations, state.lines, newEdgesAll);
      const recomputed = recompute(newStations, idx2.prereqs);
      return {
        ...state,
        stations: recomputed,
        edges: newEdgesAll,
        selectedId: id,
        modalOpen: false,
        modalOpenCount: state.modalOpenCount,
        modalPreset: null,
      };
    }

    case 'SET_THEME':
      return { ...state, theme: action.theme };

    case 'OPEN_MODAL':
      return { ...state, modalOpen: true, modalOpenCount: state.modalOpenCount + 1, modalPreset: action.preset || null };

    case 'CLOSE_MODAL':
      return { ...state, modalOpen: false, modalPreset: null };

    default:
      return state;
  }
}

interface StoreContextValue {
  state: StoreState;
  indexes: Indexes;
  dispatch: React.Dispatch<Action>;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function ProjectStoreProvider({ children }: { children: React.ReactNode }) {
  const persisted = loadState();
  const initialState: StoreState = {
    ...persisted,
    selectedId: null,
    highlightLine: null,
    theme: 'light',
    modalOpen: false,
    modalOpenCount: 0,
    modalPreset: null,
  };

  const [state, dispatch] = useReducer(reducer, initialState);

  const indexes = useMemo(
    () => buildIndexes(state.stations, state.lines, state.edges),
    [state.stations, state.lines, state.edges]
  );

  // Persist on data changes
  useEffect(() => {
    saveState({
      project: state.project,
      lines: state.lines,
      stations: state.stations,
      edges: state.edges,
    });
  }, [state.project, state.lines, state.stations, state.edges]);

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
