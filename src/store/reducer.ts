import type { Project, Line, Station, Edge } from '../types';
import { buildIndexes, collectSelfAndDescendants } from '../lib/indexes';
import { recompute } from '../lib/dependencies';
import { slugify, placeNewStation } from '../lib/placement';
import { lineIdFromName, normalizeShort } from '../lib/lines';
import { PLACEHOLDER_DESC, PLACEHOLDER_OWNER, PLACEHOLDER_DASH } from '../lib/placeholders';
import type { LabelPivot } from '../lib/labelAnglePref';
import type { MapRole } from '../data/mapsRepo';

export interface PersistedState {
  project: Project;
  lines: Line[];
  stations: Station[];
  edges: Edge[];
}

/**
 * A store is read-only when the caller is a Viewer share OR the map is a GitHub
 * mirror (read-only for everyone, owner included — migration 0006). A read-only
 * store drops mutating actions, never autosaves, and instead applies live server
 * updates via SET_DATA. Owner/Editor of a non-mirror map remain editable.
 */
export function resolveReadOnly(role: MapRole, isMirror: boolean): boolean {
  return role === 'viewer' || isMirror;
}

export interface StoreState extends PersistedState {
  selectedId: string | null;
  highlightLine: string | null;
  theme: 'light' | 'dark';
  // Per-viewer label rotation in degrees (0 = horizontal, ±45 = subway-style)
  // and the point the labels pivot about. Both are private display preferences
  // like `theme`, not saved map content — persisted per-map in localStorage so
  // they work on read-only mirrors. ADR 0003.
  labelAngle: number;
  labelPivot: LabelPivot;
  modalOpen: boolean;
  modalOpenCount: number;
  modalMode: 'create' | 'edit';
  editId: string | null;
  modalPreset: { line?: string; prereqs?: string[] } | null;
}

export type Action =
  | { type: 'OPEN_DETAIL'; id: string }
  | { type: 'CLOSE_DETAIL' }
  | { type: 'DO_ACTION'; id: string; act: 'start' | 'done' | 'reopen' }
  | { type: 'SET_DATA'; data: PersistedState }
  | { type: 'SET_HIGHLIGHT_LINE'; lineId: string | null }
  | { type: 'CREATE_TASK'; data: CreateTaskData }
  | { type: 'UPDATE_TASK'; id: string; data: EditTaskData }
  | { type: 'DELETE_TASK'; id: string }
  | { type: 'CREATE_LINE'; data: LineData }
  | { type: 'UPDATE_LINE'; id: string; data: LineData }
  | { type: 'DELETE_LINE'; id: string }
  | { type: 'SET_THEME'; theme: 'light' | 'dark' }
  | { type: 'SET_LABEL_ANGLE'; angle: number }
  | { type: 'SET_LABEL_PIVOT'; pivot: LabelPivot }
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

function spliceStation(stationId: string, edges: Edge[]): Edge[] {
  const incoming = edges.filter(e => e.to === stationId);
  const outgoing = edges.filter(e => e.from === stationId);
  const unrelated = edges.filter(e => e.from !== stationId && e.to !== stationId);

  // Bridge each prereq to each dependent. Routing (df) is derived at render time
  // from geometry (see resolveRouting), so we don't compute it here.
  const spliced: Edge[] = [];
  for (const inc of incoming) {
    for (const out of outgoing) {
      spliced.push({ from: inc.from, to: out.to, line: out.line });
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

// Whether two prerequisite lists describe the same set (order-independent).
function sameSet(a: string[], b: string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

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

    case 'SET_DATA': {
      // Replace the whole persisted blob in place — used when a read-only store
      // (mirror / Viewer) receives a live server update over Realtime. The
      // payload is already settled server-side, so we don't recompute; we just
      // keep the current selection/highlight when they still resolve.
      const { data } = action;
      const selectedId =
        state.selectedId && data.stations.some(s => s.id === state.selectedId)
          ? state.selectedId
          : null;
      const highlightLine =
        state.highlightLine && data.lines.some(l => l.id === state.highlightLine)
          ? state.highlightLine
          : null;
      return {
        ...state,
        project: data.project,
        lines: data.lines,
        stations: data.stations,
        edges: data.edges,
        selectedId,
        highlightLine,
      };
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
        desc: data.desc || PLACEHOLDER_DESC,
        owner: data.owner || PLACEHOLDER_OWNER,
        role: data.role || '',
        due: data.due || PLACEHOLDER_DASH,
        est: data.est || PLACEHOLDER_DASH,
        tags: data.tags || [],
      };
      // Routing (df) is derived at render time from geometry, so edges store none.
      const newEdges: Edge[] = data.prereqs.map(pid => ({ from: pid, to: id, line: lineId }));
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

      // Defense-in-depth: the modal hides a task's own descendants from the
      // prereq picker, but UPDATE_TASK is a public action, so guard here too —
      // drop self, unknown ids, and anything downstream that would form a cycle.
      const idx = buildIndexes(state.stations, lines, state.edges);
      const blocked = collectSelfAndDescendants(id, idx.dependents);
      const prereqs = data.prereqs.filter(p => idx.stationById[p] && !blocked.has(p));

      // Only re-place when the prerequisite set actually changes; a metadata-only
      // edit (or a no-prereq root task) keeps its current position and label.
      const prevPrereqs = state.edges.filter(e => e.to === id).map(e => e.from);
      let col = existing.col;
      let row = existing.row;
      let lp = existing.lp;
      if (!sameSet(prevPrereqs, prereqs)) {
        const pos = placeNewStation(primaryLine, prereqs, idx.stationById,
          state.stations.filter(s => s.id !== id));
        col = pos.col;
        row = pos.row;
        lp = pos.row >= 3 ? 'bottom' : 'top';
      }

      const updatedStation: Station = {
        ...existing,
        name: data.name,
        lines: selectedLines,
        col,
        row,
        lp,
        desc: data.desc?.trim() || PLACEHOLDER_DESC,
        owner: data.owner?.trim() || PLACEHOLDER_OWNER,
        role: data.role?.trim() || '',
        due: data.due?.trim() || PLACEHOLDER_DASH,
        est: data.est?.trim() || PLACEHOLDER_DASH,
        tags: data.tags || [],
      };
      const newStations = state.stations.map(s => (s.id === id ? updatedStation : s));

      // Rebuild incoming edges from the new prereq list (colored by the task's
      // primary line). Also remap any outgoing edge still colored for a line the
      // task no longer sits on, so downstream segments stay consistent.
      const keptEdges = state.edges
        .filter(e => e.to !== id)
        .map(e => (e.from === id && !selectedLines.includes(e.line)
          ? { ...e, line: primaryLine }
          : e));
      const newIncoming: Edge[] = prereqs.map(pid => ({ from: pid, to: id, line: primaryLine }));
      const newEdges: Edge[] = [...keptEdges, ...newIncoming];

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
      const newEdges = spliceStation(action.id, state.edges);
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

    case 'SET_LABEL_ANGLE':
      // View-only preference (like SET_THEME): lives in client state, never in
      // the saved map, so it is NOT a MUTATING_ACTION and works on read-only
      // mirrors. projectStore persists it per-map to localStorage.
      return { ...state, labelAngle: action.angle };

    case 'SET_LABEL_PIVOT':
      // View-only preference, same as SET_LABEL_ANGLE: client state only,
      // persisted per-map to localStorage, allowed on read-only mirrors.
      return { ...state, labelPivot: action.pivot };

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
