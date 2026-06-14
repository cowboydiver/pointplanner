import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import type { MapIndex, MapMeta, MapData } from '../lib/maps';
import {
  genMapId,
  createSeedMapData,
  createBlankMapData,
  cloneMapData,
  switchMap,
  renameMap,
  deleteMap,
  duplicateMap as duplicateMapIndex,
} from '../lib/maps';
import { getCommittedMaps, getCommittedMapById } from '../lib/committedMaps';
import { COMMITTED_ID_PREFIX, committedSourceId } from './committedReimport';
import * as mapsRepo from '../lib/mapsRepo';
import type { MapRow } from '../lib/mapsRepo';
import { detectLegacyMaps, getLegacyImportDone, setLegacyImportDone } from '../lib/legacyMaps';
import type { LegacyMap } from '../lib/legacyMaps';

// Lightweight UI pointer — only "which map was last active", not map data.
const ACTIVE_MAP_KEY = 'pointplanner.activeMapId';
// Remembers which committed maps have already been cloud-seeded on this device.
const SEEDED_KEY = 'pointplanner.committed-seeded';

function loadActivePointer(): string | null {
  try {
    return localStorage.getItem(ACTIVE_MAP_KEY);
  } catch {
    return null;
  }
}

function saveActivePointer(id: string | null): void {
  try {
    if (id === null) {
      localStorage.removeItem(ACTIVE_MAP_KEY);
    } else {
      localStorage.setItem(ACTIVE_MAP_KEY, id);
    }
  } catch {
    // ignore
  }
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

function rowsToIndex(rows: MapRow[], activeId: string | null): MapIndex {
  const maps: MapMeta[] = rows.map(r => ({ id: r.id, name: r.name }));
  // Prefer the stored pointer if it's still valid; otherwise the most-recent map.
  const validActive = activeId && maps.some(m => m.id === activeId)
    ? activeId
    : (maps[0]?.id ?? null);
  return { activeMapId: validActive, maps };
}

/** Non-null when legacy maps exist and the user has not yet decided. */
export interface PendingLegacyImport {
  count: number;
}

interface MapRegistryContextValue {
  index: MapIndex;
  activeMeta: MapMeta | null;
  loading: boolean;
  // Bumped on re-import so the active map's store provider remounts.
  reloadNonce: number;
  createMap: (name: string) => void;
  selectMap: (id: string) => void;
  renameMapById: (id: string, name: string) => void;
  deleteMapById: (id: string) => void;
  duplicateMapById: (id: string) => void;
  // Committed file id (e.g. `roadmap`) this map can re-sync from, or null.
  reimportSourceFor: (id: string) => string | null;
  // Replace a committed-backed map's cloud data with the committed file.
  reimportMapById: (id: string) => void;
  // Force-reload the active map (bumps reloadNonce so the store provider remounts).
  reloadActiveMap: () => void;
  // Non-null while the user has not yet responded to the legacy-import prompt.
  legacyImport: PendingLegacyImport | null;
  // Import all detected legacy maps into the cloud, then mark done.
  importLegacyMaps: () => void;
  // Decline the import and mark done so the prompt never reappears.
  dismissLegacyImport: () => void;
}

const MapRegistryContext = createContext<MapRegistryContextValue | null>(null);

export function MapRegistryProvider({
  children,
  userId,
}: {
  children: React.ReactNode;
  userId?: string | null;
}) {
  const [index, setIndex] = useState<MapIndex>({ activeMapId: null, maps: [] });
  const [loading, setLoading] = useState(true);
  const [reloadNonce, setReloadNonce] = useState(0);
  // Pending legacy maps to import — set after boot when detected.
  const [pendingLegacy, setPendingLegacy] = useState<LegacyMap[] | null>(null);
  // Prevent state updates after unmount
  const mountedRef = useRef(true);
  // Capture userId at mount time so the boot effect can read it without it
  // being a reactive dependency (boot is intentionally one-shot).
  const userIdRef = useRef(userId);

  useEffect(() => {
    mountedRef.current = true;
    let ignore = false;

    async function boot() {
      try {
        let rows = await mapsRepo.listMaps();

        if (!ignore) {
          // ── Seed committed maps as cloud rows (once per device) ──────────────
          const committed = getCommittedMaps();
          if (committed.length > 0) {
            const seeded = loadSeeded();
            const existingIds = new Set(rows.map(r => r.id));
            let seededChanged = false;

            for (const c of committed) {
              const mapId = COMMITTED_ID_PREFIX + c.id;
              if (seeded.has(c.id)) continue;           // already seeded on this device
              if (existingIds.has(mapId)) {              // already in cloud (maybe another device)
                seeded.add(c.id);
                seededChanged = true;
                continue;
              }
              // Create the cloud row for this committed map
              try {
                const row = await mapsRepo.createMap(mapId, c.name, cloneMapData(c.data as MapData));
                rows = [row, ...rows];
                existingIds.add(mapId);
                seeded.add(c.id);
                seededChanged = true;
              } catch {
                // ignore — non-fatal; will retry on next mount
              }
            }

            if (seededChanged) saveSeeded(seeded);
          }
        }

        if (!ignore) {
          // ── Seed the demo map if the user has no maps at all ─────────────────
          if (rows.length === 0) {
            const data = createSeedMapData();
            const id = genMapId([], data.project.name);
            try {
              const row = await mapsRepo.createMap(id, data.project.name, data);
              rows = [row];
            } catch {
              // ignore — fall through to empty index
            }
          }

          const pointer = loadActivePointer();
          const idx = rowsToIndex(rows, pointer);
          setIndex(idx);

          // ── Detect legacy localStorage maps (once per account) ───────────────
          if (!getLegacyImportDone(userIdRef.current)) {
            const legacy = detectLegacyMaps(localStorage);
            if (legacy.length > 0) {
              setPendingLegacy(legacy);
            }
          }

          setLoading(false);
        }
      } catch {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    void boot();

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Persist the active map pointer whenever it changes
  useEffect(() => {
    if (!loading) {
      saveActivePointer(index.activeMapId);
    }
  }, [index.activeMapId, loading]);

  const activeMeta = index.activeMapId
    ? (index.maps.find(m => m.id === index.activeMapId) ?? null)
    : null;

  async function refreshList(newActiveId?: string): Promise<void> {
    try {
      const rows = await mapsRepo.listMaps();
      if (!mountedRef.current) return;
      const pointer = newActiveId ?? index.activeMapId;
      setIndex(rowsToIndex(rows, pointer ?? null));
    } catch {
      // ignore — leave current state intact
    }
  }

  function createMap(name: string): void {
    const existingIds = index.maps.map(m => m.id);
    const id = genMapId(existingIds, name);
    const data = createBlankMapData(name);
    mapsRepo.createMap(id, name, data).then(row => {
      if (!mountedRef.current) return;
      setIndex(prev => ({
        activeMapId: row.id,
        maps: [...prev.maps, { id: row.id, name: row.name }],
      }));
    }).catch(() => {
      // ignore
    });
  }

  function selectMap(id: string): void {
    setIndex(prev => switchMap(prev, id));
  }

  function renameMapById(id: string, name: string): void {
    // Optimistically update local state; fire-and-forget the remote rename.
    setIndex(prev => renameMap(prev, id, name));
    mapsRepo.renameMap(id, name).catch(() => {
      // On failure, refresh to get the server's current name.
      void refreshList();
    });
  }

  function deleteMapById(id: string): void {
    // Compute the next active map before removing it from local state.
    const nextIndex = deleteMap(index, id);
    setIndex(nextIndex);
    mapsRepo.deleteMap(id).catch(() => {
      void refreshList();
    });
  }

  function duplicateMapById(id: string): void {
    const sourceName = index.maps.find(m => m.id === id)?.name ?? 'Map';
    const existingIds = index.maps.map(m => m.id);
    const newId = genMapId(existingIds, sourceName + ' copy');
    const newName = sourceName + ' copy';
    mapsRepo.duplicateMap(id, newId, newName).then(row => {
      if (!mountedRef.current) return;
      setIndex(prev => duplicateMapIndex(prev, id, { id: row.id, name: row.name }));
    }).catch(() => {
      // ignore
    });
  }

  function reimportSourceFor(id: string): string | null {
    const fileId = committedSourceId(id);
    if (fileId === null) return null;
    return getCommittedMapById(fileId) ? fileId : null;
  }

  function reimportMapById(id: string): void {
    const fileId = committedSourceId(id);
    if (fileId === null) return;
    const committed = getCommittedMapById(fileId);
    if (!committed) return;
    Promise.all([
      mapsRepo.overwriteMapData(id, cloneMapData(committed.data as MapData)),
      mapsRepo.renameMap(id, committed.name),
    ]).then(() => {
      if (!mountedRef.current) return;
      setIndex(prev => renameMap(prev, id, committed.name));
      setReloadNonce(n => n + 1);
    }).catch(() => {
      // ignore
    });
  }

  function reloadActiveMap(): void {
    setReloadNonce(n => n + 1);
  }

  async function importLegacyMaps(): Promise<void> {
    if (!pendingLegacy || pendingLegacy.length === 0) return;

    // Collect all existing cloud ids so we can generate collision-free ids.
    const existingIds = index.maps.map(m => m.id);

    for (const legacy of pendingLegacy) {
      const newId = genMapId(existingIds, legacy.name);
      existingIds.push(newId);
      try {
        await mapsRepo.createMap(newId, legacy.name, cloneMapData(legacy.data));
      } catch {
        // Non-fatal: skip this map if creation fails.
      }
    }

    setLegacyImportDone(userIdRef.current);
    setPendingLegacy(null);
    // Refresh the cloud list so imported maps appear.
    await refreshList();
  }

  function dismissLegacyImport(): void {
    setLegacyImportDone(userIdRef.current);
    setPendingLegacy(null);
  }

  const legacyImport: PendingLegacyImport | null =
    pendingLegacy !== null ? { count: pendingLegacy.length } : null;

  const value: MapRegistryContextValue = {
    index,
    activeMeta,
    loading,
    reloadNonce,
    createMap,
    selectMap,
    renameMapById,
    deleteMapById,
    duplicateMapById,
    reimportSourceFor,
    reimportMapById,
    reloadActiveMap,
    legacyImport,
    importLegacyMaps,
    dismissLegacyImport,
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
