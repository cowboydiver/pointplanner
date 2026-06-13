import React, { createContext, useContext, useState, useEffect } from 'react';
import type { MapIndex, MapMeta, MapData } from '../lib/maps';
import {
  genMapId,
  createSeedMapData,
  createBlankMapData,
  cloneMapData,
  addMap,
  switchMap,
  renameMap,
  deleteMap,
  duplicateMap,
} from '../lib/maps';
import { getCommittedMaps, getCommittedMapById } from '../lib/committedMaps';
import { COMMITTED_ID_PREFIX, mapDataKey, committedSourceId, reimportCommittedMapData } from './committedReimport';

const REGISTRY_KEY = 'pointplanner.index';
// Remembers which committed maps have already been copied into localStorage, so
// a committed map the user later deletes is not silently re-seeded.
const SEEDED_KEY = 'pointplanner.committed-seeded';

function loadIndex(): MapIndex {
  try {
    const raw = localStorage.getItem(REGISTRY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as MapIndex;
      if (
        parsed &&
        typeof parsed.activeMapId !== 'undefined' &&
        Array.isArray(parsed.maps)
      ) {
        return parsed;
      }
    }
  } catch {
    // ignore
  }

  // Bootstrap: no valid index found — create a single default map from seed.
  const data = createSeedMapData();
  const id = genMapId([], data.project.name);
  try {
    localStorage.setItem(mapDataKey(id), JSON.stringify(data));
  } catch {
    // ignore
  }
  return { activeMapId: id, maps: [{ id, name: data.project.name }] };
}

function loadSeeded(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEDED_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return new Set(parsed.filter(x => typeof x === 'string'));
    }
  } catch {
    // ignore
  }
  return new Set();
}

function saveSeeded(seeded: Set<string>): void {
  try {
    localStorage.setItem(SEEDED_KEY, JSON.stringify([...seeded]));
  } catch {
    // ignore
  }
}

// Copy any not-yet-seeded committed maps into editable localStorage maps and
// append them to the index. Runs once per committed map (tracked in SEEDED_KEY)
// so user edits/deletes stick. Does not touch the existing seed/blank bootstrap.
function seedCommittedMaps(index: MapIndex): MapIndex {
  const committed = getCommittedMaps();
  if (committed.length === 0) return index;

  const seeded = loadSeeded();
  let next = index;
  let changed = false;

  for (const c of committed) {
    if (seeded.has(c.id)) continue;
    const mapId = COMMITTED_ID_PREFIX + c.id;
    seeded.add(c.id);
    try {
      // Seed the editable copy only if one isn't already present.
      if (localStorage.getItem(mapDataKey(mapId)) === null) {
        localStorage.setItem(mapDataKey(mapId), JSON.stringify(cloneMapData(c.data as MapData)));
      }
    } catch {
      // ignore
    }
    if (!next.maps.some(m => m.id === mapId)) {
      next = { ...next, maps: [...next.maps, { id: mapId, name: c.name }] };
      changed = true;
    }
  }

  saveSeeded(seeded);
  return changed ? next : index;
}

interface MapRegistryContextValue {
  index: MapIndex;
  activeMeta: MapMeta | null;
  // Bumped on re-import so the active map's store provider remounts and re-reads
  // the freshly overwritten localStorage data.
  reloadNonce: number;
  createMap: (name: string) => void;
  selectMap: (id: string) => void;
  renameMapById: (id: string, name: string) => void;
  deleteMapById: (id: string) => void;
  duplicateMapById: (id: string) => void;
  // Committed file id (e.g. `roadmap`) this map can re-sync from, or null.
  reimportSourceFor: (id: string) => string | null;
  // Replace a committed-backed map's editable copy with the committed file.
  reimportMapById: (id: string) => void;
}

const MapRegistryContext = createContext<MapRegistryContextValue | null>(null);

export function MapRegistryProvider({ children }: { children: React.ReactNode }) {
  const [index, setIndex] = useState<MapIndex>(() => seedCommittedMaps(loadIndex()));
  const [reloadNonce, setReloadNonce] = useState(0);

  // Persist index whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem(REGISTRY_KEY, JSON.stringify(index));
    } catch {
      // ignore
    }
  }, [index]);

  const activeMeta = index.activeMapId
    ? (index.maps.find(m => m.id === index.activeMapId) ?? null)
    : null;

  function createMap(name: string): void {
    const existingIds = index.maps.map(m => m.id);
    const id = genMapId(existingIds, name);
    const data = createBlankMapData(name);
    try {
      localStorage.setItem(mapDataKey(id), JSON.stringify(data));
    } catch {
      // ignore
    }
    setIndex(prev => addMap(prev, { id, name }));
  }

  function selectMap(id: string): void {
    setIndex(prev => switchMap(prev, id));
  }

  function renameMapById(id: string, name: string): void {
    // Registry meta only — do NOT touch the map data key
    setIndex(prev => renameMap(prev, id, name));
  }

  function deleteMapById(id: string): void {
    setIndex(prev => deleteMap(prev, id));
    try {
      localStorage.removeItem(mapDataKey(id));
    } catch {
      // ignore
    }
  }

  function duplicateMapById(id: string): void {
    let sourceData = createSeedMapData();
    try {
      const raw = localStorage.getItem(mapDataKey(id));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.project && parsed.lines && parsed.stations && parsed.edges) {
          sourceData = parsed;
        }
      }
    } catch {
      // ignore
    }

    const sourceName = index.maps.find(m => m.id === id)?.name ?? 'Map';
    const existingIds = index.maps.map(m => m.id);
    const newId = genMapId(existingIds, sourceName + ' copy');
    const newName = sourceName + ' copy';

    try {
      localStorage.setItem(mapDataKey(newId), JSON.stringify(cloneMapData(sourceData)));
    } catch {
      // ignore
    }

    setIndex(prev => duplicateMap(prev, id, { id: newId, name: newName }));
  }

  function reimportSourceFor(id: string): string | null {
    const fileId = committedSourceId(id);
    if (fileId === null) return null;
    // Only offer re-import when the committed file still exists.
    return getCommittedMapById(fileId) ? fileId : null;
  }

  function reimportMapById(id: string): void {
    const fileId = committedSourceId(id);
    if (fileId === null) return;
    const committed = getCommittedMapById(fileId);
    if (!committed) return;
    try {
      reimportCommittedMapData(localStorage, id, committed);
    } catch {
      // ignore
    }
    // Keep the registry name in sync with the committed file, then force the
    // active store provider to remount so the live view reflects the new data.
    setIndex(prev => renameMap(prev, id, committed.name));
    setReloadNonce(n => n + 1);
  }

  const value: MapRegistryContextValue = {
    index,
    activeMeta,
    reloadNonce,
    createMap,
    selectMap,
    renameMapById,
    deleteMapById,
    duplicateMapById,
    reimportSourceFor,
    reimportMapById,
  };

  return (
    <MapRegistryContext.Provider value={value}>
      {children}
    </MapRegistryContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useMapRegistry(): MapRegistryContextValue {
  const ctx = useContext(MapRegistryContext);
  if (!ctx) throw new Error('useMapRegistry must be used within MapRegistryProvider');
  return ctx;
}
