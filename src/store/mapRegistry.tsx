import React, { createContext, useContext, useState, useEffect } from 'react';
import { createSeedMapData, createBlankMapData, chooseInitialMap } from '../lib/maps';
import * as repo from '../data/mapsRepo';
import type { MapListItem } from '../data/mapsRepo';

const SEED_NAME = 'PointPlanner Demo';

// Local index: like MapIndex but carrying the role on each item so the role
// travels with the switcher list (issue #19).
interface RegistryIndex {
  activeMapId: string | null;
  maps: MapListItem[];
}

interface MapRegistryContextValue {
  index: RegistryIndex;
  activeMeta: MapListItem | null;
  // True while the initial owned-map list is being fetched/seeded.
  loading: boolean;
  // Bumped to force the active map's store provider to remount, which re-runs
  // loadMap against current server state (#18 stale-write reload).
  reloadNonce: number;
  // Reload the active map from the server, discarding divergent local edits.
  reloadActiveMap: () => void;
  // Re-fetch the owned/shared map list (e.g. after a one-time local import, #17),
  // keeping the active map if it still exists else choosing the first.
  refreshMaps: () => Promise<void>;
  createMap: (name: string) => void;
  selectMap: (id: string) => void;
  renameMapById: (id: string, name: string) => void;
  deleteMapById: (id: string) => void;
  duplicateMapById: (id: string) => void;
}

const MapRegistryContext = createContext<MapRegistryContextValue | null>(null);

export function MapRegistryProvider({ children }: { children: React.ReactNode }) {
  const [index, setIndex] = useState<RegistryIndex>({ activeMapId: null, maps: [] });
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
          maps = [{ ...meta, role: 'owner' }];
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
        const meta = await repo.createMap(name, createBlankMapData(name));
        const item: MapListItem = { ...meta, role: 'owner' };
        setIndex(prev => ({ activeMapId: item.id, maps: [item, ...prev.maps] }));
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
        const item: MapListItem = { ...meta, role: 'owner' };
        setIndex(prev => {
          const idx = prev.maps.findIndex(m => m.id === id);
          const insertAt = idx === -1 ? prev.maps.length : idx + 1;
          const maps = [
            ...prev.maps.slice(0, insertAt),
            item,
            ...prev.maps.slice(insertAt),
          ];
          return { activeMapId: item.id, maps };
        });
      } catch (err) {
        console.error('Failed to duplicate map', err);
      }
    })();
  }

  function reloadActiveMap(): void {
    setReloadNonce(n => n + 1);
  }

  async function refreshMaps(): Promise<void> {
    try {
      const maps = await repo.listMaps();
      setIndex(prev => {
        const keep = prev.activeMapId && maps.some(m => m.id === prev.activeMapId);
        const activeMapId = keep
          ? prev.activeMapId
          : (maps[0]?.id ?? null);
        return { activeMapId, maps };
      });
    } catch (err) {
      console.error('Failed to refresh maps', err);
    }
  }

  const value: MapRegistryContextValue = {
    index,
    activeMeta,
    loading,
    reloadNonce,
    reloadActiveMap,
    refreshMaps,
    createMap,
    selectMap,
    renameMapById,
    deleteMapById,
    duplicateMapById,
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
