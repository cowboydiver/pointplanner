import type { MapData } from '../lib/maps';
import { cloneMapData } from '../lib/maps';
import type { CommittedMap } from '../lib/committedMaps';

// Prefix keeps committed-map ids in their own namespace, clear of seed/blank ids.
export const COMMITTED_ID_PREFIX = 'committed-';

export function mapDataKey(id: string): string {
  return 'pointplanner.map.' + id;
}

/**
 * If `mapId` is a committed-backed map (`committed-<fileId>`), return that
 * committed file's id (e.g. `roadmap`); otherwise null. The registry uses this
 * (gated on the file still existing) to decide whether to offer Re-import.
 */
export function committedSourceId(mapId: string): string | null {
  if (!mapId.startsWith(COMMITTED_ID_PREFIX)) return null;
  return mapId.slice(COMMITTED_ID_PREFIX.length);
}

/**
 * Pure re-import: overwrite a committed-backed map's editable copy in `storage`
 * with a fresh clone of the committed file's current contents (file wins). The
 * registry index is untouched — only the per-map data key changes. Exported for
 * unit testing against a Storage-like double.
 */
export function reimportCommittedMapData(
  storage: Pick<Storage, 'setItem'>,
  mapId: string,
  committed: CommittedMap,
): void {
  storage.setItem(mapDataKey(mapId), JSON.stringify(cloneMapData(committed.data as MapData)));
}
