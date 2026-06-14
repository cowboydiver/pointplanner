import React, { createContext, useContext, useState, useEffect } from 'react';
import type { MapIndex, MapMeta } from '../lib/maps';
import { createSeedMapData, chooseInitialMap } from '../lib/maps';
import * as repo from '../lib/mapsRepo';

const SEED_NAME = 'PointPlanner Demo';

interface MapRegistryContextValue {
  index: MapIndex;
  activeMeta: MapMeta | null;
  // True while the initial owned-map list is being fetched/seeded.
  loading: boolean;
  // Bumped to force the active map's store provider to remount, which re-runs
  // loadMap against current server state (#18 stale-write reload).
  reloadNonce: number;
  // Reload the active map from the server, discarding divergent local edits.
  reloadActiveMap: () => void;
  createMap: (name: string) => void;
  selectMap: (id: string) => void;
  renameMapById: (id: string, name: string) => void;
  deleteMapById: (id: string) => void;
  duplicateMapById: (id: string) => void;
  // Committed file id this map can re-sync from, or null.
  reimportSourceFor: (id: string) => string | null;
  // Replace a committed-backed map's editable copy with the committed file.
  reimportMapById: (id: string) => void;
}

const MapRegistryContext = createContext<MapRegistryContextValue | null>(null);

export function MapRegistryProvider({ children }: { children: React.ReactNode }) {
  const [index, setIndex] = useState<MapIndex>({ activeMapId: null, maps: [] });
  const [loading, setLoading] = useState(true);
  // App.tsx keys the store provider on this; bumping it remounts the provider,
  // which re-fetches current server state (used by the stale-write reload, #18).
  const [reloadNonce, setReloadNonce] = useState(0);

  // Bootstrap: fetch the user's owned maps. If they have none, seed the demo
  // map. The user is guaranteed signed in here — this provider lives inside the
  // AuthGate. localStorage is no longer consulted.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        let maps = await repo.listMaps();
        const { needsSeed } = chooseInitialMap(maps);
        if (needsSeed) {
          const meta = await repo.createMap(SEED_NAME, createSeedMapData());
          maps = [meta];
        }
        if (!active) return;
        const { activeMapId } = chooseInitialMap(maps);
        setIndex({ activeMapId, maps });
      } catch (err) {
        if (!active) return;
        console.error('Failed to load maps', err);
        setIndex({ activeMapId: null, maps: [] });
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const activeMeta = index.activeMapId
    ? (index.maps.find(m => m.id === index.activeMapId) ?? null)
    : null;

  function createMap(name: string): void {
    void (async () => {
      try {
        const meta = await repo.createMap(name, createSeedMapData());
        setIndex(prev => ({ activeMapId: meta.id, maps: [meta, ...prev.maps] }));
      } catch (err) {
        console.error('Failed to create map', err);
      }
    })();
  }

  function selectMap(id: string): void {
    setIndex(prev =>
      prev.maps.some(m => m.id === id) ? { ...prev, activeMapId: id } : prev,
    );
  }

  function renameMapById(id: string, name: string): void {
    void (async () => {
      try {
        await repo.renameMap(id, name);
        setIndex(prev => ({
          ...prev,
          maps: prev.maps.map(m => (m.id === id ? { ...m, name } : m)),
        }));
      } catch (err) {
        console.error('Failed to rename map', err);
      }
    })();
  }

  function deleteMapById(id: string): void {
    void (async () => {
      try {
        await repo.deleteMap(id);
        setIndex(prev => {
          const idx = prev.maps.findIndex(m => m.id === id);
          if (idx === -1) return prev;
          const maps = prev.maps.filter(m => m.id !== id);
          let activeMapId = prev.activeMapId;
          if (prev.activeMapId === id) {
            activeMapId = maps.length === 0
              ? null
              : (maps[idx] ?? maps[idx - 1]).id;
          }
          return { activeMapId, maps };
        });
      } catch (err) {
        console.error('Failed to delete map', err);
      }
    })();
  }

  function duplicateMapById(id: string): void {
    void (async () => {
      try {
        const meta = await repo.duplicateMap(id);
        setIndex(prev => {
          const idx = prev.maps.findIndex(m => m.id === id);
          const insertAt = idx === -1 ? prev.maps.length : idx + 1;
          const maps = [
            ...prev.maps.slice(0, insertAt),
            meta,
            ...prev.maps.slice(insertAt),
          ];
          return { activeMapId: meta.id, maps };
        });
      } catch (err) {
        console.error('Failed to duplicate map', err);
      }
    })();
  }

  // Committed-file reimport was a localStorage-only feature (copying a bundled
  // map into an editable localStorage copy). Cloud maps have no such source, so
  // these are intentionally inert in this slice; the committedMaps/committedReimport
  // modules and their tests are left in place but no longer wired here.
  function reimportSourceFor(): string | null {
    return null;
  }

  function reimportMapById(): void {
    // no-op for cloud maps (see comment above)
  }

  function reloadActiveMap(): void {
    setReloadNonce(n => n + 1);
  }

  const value: MapRegistryContextValue = {
    index,
    activeMeta,
    loading,
    reloadNonce,
    reloadActiveMap,
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
