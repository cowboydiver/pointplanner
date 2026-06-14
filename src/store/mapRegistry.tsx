import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import type { MapIndex, MapMeta, MapData } from '../lib/maps';
import {
  mapMetaKey,
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
// Now stores the composite key (`owner|id`) rather than the bare slug id.
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

function saveActivePointer(key: string | null): void {
  try {
    if (key === null) {
      localStorage.removeItem(ACTIVE_MAP_KEY);
    } else {
      localStorage.setItem(ACTIVE_MAP_KEY, key);
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

/**
 * Convert DB rows to a MapIndex. Each row's `owner` is compared to the
 * signed-in user's id (via `userIdRef`) to determine `readOnly`.
 * Active selection is tracked by the composite key (`owner|id`).
 */
function rowsToIndex(
  rows: MapRow[],
  activeKey: string | null,
  userId: string | null | undefined,
): MapIndex {
  const maps: MapMeta[] = rows.map(r => ({
    key: mapMetaKey(r.owner, r.id),
    id: r.id,
    owner: r.owner,
    name: r.name,
    readOnly: r.owner !== userId,
  }));
  // Prefer the stored pointer if it's still valid (matches a composite key);
  // otherwise fall back to the first (most recently updated) map.
  const validActive = activeKey && maps.some(m => m.key === activeKey)
    ? activeKey
    : (maps[0]?.key ?? null);
  return { activeKey: validActive, maps };
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
  selectMap: (key: string) => void;
  renameMapById: (key: string, name: string) => void;
  deleteMapById: (key: string) => void;
  duplicateMapById: (key: string) => void;
  // Committed file id (e.g. `roadmap`) this map can re-sync from, or null.
  reimportSourceFor: (key: string) => string | null;
  // Replace a committed-backed map's cloud data with the committed file.
  reimportMapById: (key: string) => void;
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
  const [index, setIndex] = useState<MapIndex>({ activeKey: null, maps: [] });
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
          const idx = rowsToIndex(rows, pointer, userIdRef.current);
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

  // Persist the active map composite key whenever it changes.
  useEffect(() => {
    if (!loading) {
      saveActivePointer(index.activeKey);
    }
  }, [index.activeKey, loading]);

  const activeMeta = index.activeKey
    ? (index.maps.find(m => m.key === index.activeKey) ?? null)
    : null;

  async function refreshList(newActiveKey?: string): Promise<void> {
    try {
      const rows = await mapsRepo.listMaps();
      if (!mountedRef.current) return;
      const pointer = newActiveKey ?? index.activeKey;
      setIndex(rowsToIndex(rows, pointer ?? null, userIdRef.current));
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
      const newKey = mapMetaKey(row.owner, row.id);
      setIndex(prev => ({
        activeKey: newKey,
        maps: [...prev.maps, {
          key: newKey,
          id: row.id,
          owner: row.owner,
          name: row.name,
          readOnly: false,
        }],
      }));
    }).catch(() => {
      // ignore
    });
  }

  function selectMap(key: string): void {
    setIndex(prev => switchMap(prev, key));
  }

  function renameMapById(key: string, name: string): void {
    const meta = index.maps.find(m => m.key === key);
    if (!meta) return;
    // Optimistically update local state; fire-and-forget the remote rename.
    setIndex(prev => renameMap(prev, key, name));
    mapsRepo.renameMap(meta.id, name).catch(() => {
      // On failure, refresh to get the server's current name.
      void refreshList();
    });
  }

  function deleteMapById(key: string): void {
    const meta = index.maps.find(m => m.key === key);
    if (!meta) return;
    // Compute the next active map before removing it from local state.
    const nextIndex = deleteMap(index, key);
    setIndex(nextIndex);
    mapsRepo.deleteMap(meta.id).catch(() => {
      void refreshList();
    });
  }

  function duplicateMapById(key: string): void {
    const meta = index.maps.find(m => m.key === key);
    if (!meta) return;
    const existingIds = index.maps.map(m => m.id);
    const newId = genMapId(existingIds, meta.name + ' copy');
    const newName = meta.name + ' copy';
    mapsRepo.duplicateMap(meta.id, newId, newName).then(row => {
      if (!mountedRef.current) return;
      const newMeta: MapMeta = {
        key: mapMetaKey(row.owner, row.id),
        id: row.id,
        owner: row.owner,
        name: row.name,
        readOnly: false,
      };
      setIndex(prev => duplicateMapIndex(prev, key, newMeta));
    }).catch(() => {
      // ignore
    });
  }

  function reimportSourceFor(key: string): string | null {
    const meta = index.maps.find(m => m.key === key);
    if (!meta) return null;
    const fileId = committedSourceId(meta.id);
    if (fileId === null) return null;
    return getCommittedMapById(fileId) ? fileId : null;
  }

  function reimportMapById(key: string): void {
    const meta = index.maps.find(m => m.key === key);
    if (!meta) return;
    const fileId = committedSourceId(meta.id);
    if (fileId === null) return;
    const committed = getCommittedMapById(fileId);
    if (!committed) return;
    Promise.all([
      mapsRepo.overwriteMapData(meta.id, cloneMapData(committed.data as MapData)),
      mapsRepo.renameMap(meta.id, committed.name),
    ]).then(() => {
      if (!mountedRef.current) return;
      setIndex(prev => renameMap(prev, key, committed.name));
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
