import type { Project, Line, Station, Edge } from '../types';
import { PROJECT, LINES, STATIONS, EDGES } from '../data/seed';

export interface MapData {
  project: Project;
  lines: Line[];
  stations: Station[];
  edges: Edge[];
}

export interface MapMeta {
  id: string;
  name: string;
}

export interface MapIndex {
  activeMapId: string | null;
  maps: MapMeta[];
}

export function genMapId(existing: string[], base?: string): string {
  const raw = (base ?? 'map').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'map';
  let id = raw;
  let n = 2;
  while (existing.includes(id)) {
    id = raw + '-' + n;
    n++;
  }
  return id;
}

export function createSeedMapData(): MapData {
  return structuredClone({ project: PROJECT, lines: LINES, stations: STATIONS, edges: EDGES });
}

export function createBlankMapData(name: string): MapData {
  return {
    project: { name, subtitle: '' },
    lines: [{ id: 'main', name: 'Main Line', color: '#2563C9', short: 'ML' }],
    stations: [],
    edges: [],
  };
}

export function cloneMapData(data: MapData): MapData {
  return structuredClone(data);
}

export function addMap(index: MapIndex, meta: MapMeta): MapIndex {
  return {
    activeMapId: meta.id,
    maps: [...index.maps, meta],
  };
}

export function switchMap(index: MapIndex, id: string): MapIndex {
  if (!index.maps.some(m => m.id === id)) return index;
  return { ...index, activeMapId: id };
}

export function renameMap(index: MapIndex, id: string, name: string): MapIndex {
  return {
    ...index,
    maps: index.maps.map(m => m.id === id ? { ...m, name } : m),
  };
}

export function deleteMap(index: MapIndex, id: string): MapIndex {
  const idx = index.maps.findIndex(m => m.id === id);
  if (idx === -1) return index;

  const newMaps = index.maps.filter(m => m.id !== id);

  let newActiveMapId = index.activeMapId;
  if (index.activeMapId === id) {
    if (newMaps.length === 0) {
      newActiveMapId = null;
    } else if (idx < newMaps.length) {
      // There is a map after the deleted one (now at same index)
      newActiveMapId = newMaps[idx].id;
    } else {
      // Deleted was the last; pick the one before
      newActiveMapId = newMaps[idx - 1].id;
    }
  }

  return { activeMapId: newActiveMapId, maps: newMaps };
}

export function duplicateMap(index: MapIndex, sourceId: string, newMeta: MapMeta): MapIndex {
  const sourceIdx = index.maps.findIndex(m => m.id === sourceId);
  const insertAt = sourceIdx === -1 ? index.maps.length : sourceIdx + 1;

  const newMaps = [
    ...index.maps.slice(0, insertAt),
    newMeta,
    ...index.maps.slice(insertAt),
  ];

  return { activeMapId: newMeta.id, maps: newMaps };
}
