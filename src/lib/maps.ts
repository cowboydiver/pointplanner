import type { Project, Line, Station, Edge } from '../types';
import { PROJECT, LINES, STATIONS, EDGES } from '../data/seed';

export interface MapData {
  project: Project;
  lines: Line[];
  stations: Station[];
  edges: Edge[];
}

export interface MapMeta {
  /** Composite identifier: `"${owner}|${id}"`. Stable key for React and local storage. */
  key: string;
  id: string;
  owner: string;
  name: string;
  /** True when the signed-in User is not the Owner (i.e. this is a shared, read-only map). */
  readOnly: boolean;
}

export interface MapIndex {
  /** Composite key of the currently active map, or null when no maps exist. */
  activeKey: string | null;
  maps: MapMeta[];
}

/**
 * Build the composite key for a map from its owner UUID and slug id.
 * UUIDs and slugs never contain `|`, so the separator is unambiguous.
 */
export function mapMetaKey(owner: string, id: string): string {
  return `${owner}|${id}`;
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
    activeKey: meta.key,
    maps: [...index.maps, meta],
  };
}

export function switchMap(index: MapIndex, key: string): MapIndex {
  if (!index.maps.some(m => m.key === key)) return index;
  return { ...index, activeKey: key };
}

export function renameMap(index: MapIndex, key: string, name: string): MapIndex {
  return {
    ...index,
    maps: index.maps.map(m => m.key === key ? { ...m, name } : m),
  };
}

export function deleteMap(index: MapIndex, key: string): MapIndex {
  const idx = index.maps.findIndex(m => m.key === key);
  if (idx === -1) return index;

  const newMaps = index.maps.filter(m => m.key !== key);

  let newActiveKey = index.activeKey;
  if (index.activeKey === key) {
    if (newMaps.length === 0) {
      newActiveKey = null;
    } else if (idx < newMaps.length) {
      // There is a map after the deleted one (now at same index)
      newActiveKey = newMaps[idx]!.key;
    } else {
      // Deleted was the last; pick the one before
      newActiveKey = newMaps[idx - 1]!.key;
    }
  }

  return { activeKey: newActiveKey, maps: newMaps };
}

export function duplicateMap(index: MapIndex, sourceKey: string, newMeta: MapMeta): MapIndex {
  const sourceIdx = index.maps.findIndex(m => m.key === sourceKey);
  const insertAt = sourceIdx === -1 ? index.maps.length : sourceIdx + 1;

  const newMaps = [
    ...index.maps.slice(0, insertAt),
    newMeta,
    ...index.maps.slice(insertAt),
  ];

  return { activeKey: newMeta.key, maps: newMaps };
}
