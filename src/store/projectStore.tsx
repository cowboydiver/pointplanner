import React, { createContext, useContext, useReducer, useMemo, useEffect } from 'react';
import type { Project, Line, Station, Edge } from '../types';
import { buildIndexes, type Indexes } from '../lib/indexes';
import { recompute } from '../lib/dependencies';
import { slugify, placeNewStation } from '../lib/placement';
import { lineIdFromName, normalizeShort } from '../lib/lines';
import { createSeedMapData } from '../lib/maps';

function mapKey(mapId: string): string {
  return 'pointplanner.map.' + mapId;
}

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
  modalMode: 'create' | 'edit';
  editId: string | null;
  modalPreset: { line?: string; prereqs?: string[] } | null;
}

type Action =
  | { type: 'OPEN_DETAIL'; id: string }
  | { type: 'CLOSE_DETAIL' }
  | { type: 'DO_ACTION'; id: string; act: 'start' | 'done' | 'reopen' }
  | { type: 'SET_HIGHLIGHT_LINE'; lineId: string | null }
  | { type: 'CREATE_TASK'; data: CreateTaskData }
  | { type: 'UPDATE_TASK'; id: string; data: EditTaskData }
  | { type: 'DELETE_TASK'; id: string }
  | { type: 'CREATE_LINE'; data: LineData }
  | { type: 'UPDATE_LINE'; id: string; data: LineData }
  | { type: 'DELETE_LINE'; id: string }
  | { type: 'SET_THEME'; theme: 'light' | 'dark' }
  | { type: 'OPEN_MODAL'; preset?: { line?: string; prereqs?: string[] } }
  | { type: 'OPEN_EDIT_MODAL'; id: string }
  | { type: 'CLOSE_MODAL' };

export interface LineData {
  name: string;
  color: string;
  short: string;
}

export interface CreateTaskData {
  name: string;
  line: string;
  // When set, a new line is created as part of this task and used as its line.
  newLine?: LineData;
  desc?: string;
  owner?: string;
  role?: string;
  due?: string;
  est?: string;
  prereqs: string[];
  tags?: string[];
}

export interface EditTaskData {
  name: string;
  // Full set of lines this task should sit on (interchange = more than one).
  lines: string[];
  // When set, a new line is created as part of this edit and added to `lines`.
  newLine?: LineData;
  desc?: string;
  owner?: string;
  role?: string;
  due?: string;
  est?: string;
  prereqs: string[];
  tags?: string[];
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

function spliceStation(stationId: string, edges: Edge[], stations: Station[]): Edge[] {
  const stationMap = new Map(stations.map(s => [s.id, s]));
  const incoming = edges.filter(e => e.to === stationId);
  const outgoing = edges.filter(e => e.from === stationId);
  const unrelated = edges.filter(e => e.from !== stationId && e.to !== stationId);

  const spliced: Edge[] = [];
  for (const inc of incoming) {
    for (const out of outgoing) {
      const fromSt = stationMap.get(inc.from);
      const toSt = stationMap.get(out.to);
      spliced.push({ from: inc.from, to: out.to, line: out.line, df: fromSt && toSt ? fromSt.row !== toSt.row : false });
    }
  }

  const seen = new Set<string>();
  return [...unrelated, ...spliced].filter(e => {
    const key = `${e.from}|${e.to}|${e.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export type { StoreState, Action };

// eslint-disable-next-line react-refresh/only-export-components
export function reducer(state: StoreState, action: Action): StoreState {
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
      // Optionally create the line this task lives on, in the same atomic action.
      let lines = state.lines;
      let lineId = data.line;
      if (data.newLine && data.newLine.name.trim()) {
        const id = lineIdFromName(data.newLine.name, lines.map(l => l.id));
        lines = [...lines, {
          id,
          name: data.newLine.name.trim(),
          color: data.newLine.color,
          short: normalizeShort(data.newLine.short, data.newLine.name),
        }];
        lineId = id;
      }
      const idx = buildIndexes(state.stations, lines, state.edges);
      const pos = placeNewStation(lineId, data.prereqs, idx.stationById, state.stations);
      const id = slugify(data.name, idx.stationById);
      const newStation: Station = {
        id,
        name: data.name,
        lines: [lineId],
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
        line: lineId,
        df: idx.stationById[pid]?.row !== pos.row,
      }));
      const newStations = [...state.stations, newStation];
      const newEdgesAll = [...state.edges, ...newEdges];
      const idx2 = buildIndexes(newStations, lines, newEdgesAll);
      const recomputed = recompute(newStations, idx2.prereqs);
      return {
        ...state,
        lines,
        stations: recomputed,
        edges: newEdgesAll,
        selectedId: id,
        modalOpen: false,
        modalOpenCount: state.modalOpenCount,
        modalPreset: null,
      };
    }

    case 'UPDATE_TASK': {
      const { id, data } = action;
      const existing = state.stations.find(s => s.id === id);
      if (!existing) return state;

      // Optionally create a new line as part of this edit and add it to the task.
      let lines = state.lines;
      let selectedLines = [...data.lines];
      if (data.newLine && data.newLine.name.trim()) {
        const newId = lineIdFromName(data.newLine.name, lines.map(l => l.id));
        lines = [...lines, {
          id: newId,
          name: data.newLine.name.trim(),
          color: data.newLine.color,
          short: normalizeShort(data.newLine.short, data.newLine.name),
        }];
        selectedLines = [...selectedLines, newId];
      }
      // A station must sit on at least one line; fall back to its current lines.
      if (selectedLines.length === 0) selectedLines = existing.lines;
      const primaryLine = selectedLines[0];

      // Auto re-place to the right of its (possibly new) prerequisites. Exclude
      // self from the occupancy check so it can reclaim its own cell.
      const idx = buildIndexes(state.stations, lines, state.edges);
      const others = state.stations.filter(s => s.id !== id);
      const pos = placeNewStation(primaryLine, data.prereqs, idx.stationById, others);

      const updatedStation: Station = {
        ...existing,
        name: data.name,
        lines: selectedLines,
        col: pos.col,
        row: pos.row,
        lp: pos.row >= 3 ? 'bottom' : 'top',
        desc: data.desc?.trim() || 'No description yet.',
        owner: data.owner?.trim() || 'Unassigned',
        role: data.role?.trim() || '',
        due: data.due?.trim() || '—',
        est: data.est?.trim() || '—',
        tags: data.tags || [],
      };
      const newStations = state.stations.map(s => (s.id === id ? updatedStation : s));
      const stById = new Map(newStations.map(s => [s.id, s]));

      // Rewire prerequisites: drop the task's incoming edges, rebuild from the
      // new prereq list (colored by the task's primary line).
      const keptEdges = state.edges.filter(e => e.to !== id);
      const newIncoming: Edge[] = data.prereqs.map(pid => ({ from: pid, to: id, line: primaryLine }));
      // Recompute the diagonal-first flag for every edge touching the moved task.
      const newEdges: Edge[] = [...keptEdges, ...newIncoming].map(e => {
        if (e.from !== id && e.to !== id) return e;
        const a = stById.get(e.from);
        const b = stById.get(e.to);
        return { ...e, df: a && b ? a.row !== b.row : false };
      });

      const idx2 = buildIndexes(newStations, lines, newEdges);
      const recomputed = recompute(newStations, idx2.prereqs);
      return {
        ...state,
        lines,
        stations: recomputed,
        edges: newEdges,
        selectedId: id,
        modalOpen: false,
        modalMode: 'create',
        editId: null,
        modalPreset: null,
      };
    }

    case 'CREATE_LINE': {
      const id = lineIdFromName(action.data.name, state.lines.map(l => l.id));
      const newLine: Line = {
        id,
        name: action.data.name.trim(),
        color: action.data.color,
        short: normalizeShort(action.data.short, action.data.name),
      };
      return { ...state, lines: [...state.lines, newLine] };
    }

    case 'UPDATE_LINE': {
      // id is stable; only the display fields change, so edges/stations are untouched.
      const lines = state.lines.map(l => l.id === action.id
        ? { ...l, name: action.data.name.trim(), color: action.data.color, short: normalizeShort(action.data.short, action.data.name) }
        : l);
      return { ...state, lines };
    }

    case 'DELETE_TASK': {
      const newEdges = spliceStation(action.id, state.edges, state.stations);
      const newStations = state.stations.filter(s => s.id !== action.id);
      const idx = buildIndexes(newStations, state.lines, newEdges);
      return {
        ...state,
        stations: recompute(newStations, idx.prereqs),
        edges: newEdges,
        selectedId: state.selectedId === action.id ? null : state.selectedId,
      };
    }

    case 'DELETE_LINE': {
      const exclusiveIds = new Set(
        state.stations
          .filter(s => s.lines.length === 1 && s.lines[0] === action.id)
          .map(s => s.id)
      );
      const newEdges = state.edges.filter(e =>
        e.line !== action.id && !exclusiveIds.has(e.from) && !exclusiveIds.has(e.to)
      );
      const newStations = state.stations
        .filter(s => !exclusiveIds.has(s.id))
        .map(s => s.lines.includes(action.id) ? { ...s, lines: s.lines.filter(l => l !== action.id) } : s);
      const newLines = state.lines.filter(l => l.id !== action.id);
      const idx = buildIndexes(newStations, newLines, newEdges);
      return {
        ...state,
        lines: newLines,
        stations: recompute(newStations, idx.prereqs),
        edges: newEdges,
        selectedId: exclusiveIds.has(state.selectedId ?? '') ? null : state.selectedId,
        highlightLine: state.highlightLine === action.id ? null : state.highlightLine,
      };
    }

    case 'SET_THEME':
      return { ...state, theme: action.theme };

    case 'OPEN_MODAL':
      return { ...state, modalOpen: true, modalOpenCount: state.modalOpenCount + 1, modalMode: 'create', editId: null, modalPreset: action.preset || null };

    case 'OPEN_EDIT_MODAL':
      return { ...state, modalOpen: true, modalOpenCount: state.modalOpenCount + 1, modalMode: 'edit', editId: action.id, modalPreset: null };

    case 'CLOSE_MODAL':
      return { ...state, modalOpen: false, modalMode: 'create', editId: null, modalPreset: null };

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
