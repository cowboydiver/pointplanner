import type { MapData } from './maps';

// One-time migration helpers (issue #17). Before the cloud switch (#16), maps
// lived in localStorage under:
//   pointplanner.index        → { activeMapId, maps: [{ id, name }] }
//   pointplanner.map.<id>     → MapData
// These helpers detect those leftovers so we can offer to import them into the
// signed-in user's cloud account. They are pure (take a Storage double) and
// never throw, so they can be unit-tested and are safe to call on every mount.

export interface LocalMap {
  name: string;
  data: MapData;
}

const INDEX_KEY = 'pointplanner.index';
const MAP_KEY_PREFIX = 'pointplanner.map.';
const IMPORTED_KEY_PREFIX = 'pointplanner.imported.';

interface OldIndexEntry {
  id: string;
  name?: string;
}

/** True when a parsed blob has the shape of MapData. */
function looksLikeMapData(value: unknown): value is MapData {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.project === 'object' && v.project !== null &&
    Array.isArray(v.lines) &&
    Array.isArray(v.stations) &&
    Array.isArray(v.edges)
  );
}

/**
 * Read the old registry + per-map blobs. Skips malformed/missing entries and
 * never throws — returns `[]` when there is nothing valid to import. Uses each
 * map's stored `name`, falling back to `data.project.name`.
 */
export function detectLocalMaps(storage: Pick<Storage, 'getItem'>): LocalMap[] {
  let rawIndex: string | null;
  try {
    rawIndex = storage.getItem(INDEX_KEY);
  } catch {
    return [];
  }
  if (!rawIndex) return [];

  let entries: OldIndexEntry[];
  try {
    const parsed = JSON.parse(rawIndex) as { maps?: unknown };
    if (!parsed || !Array.isArray(parsed.maps)) return [];
    entries = parsed.maps as OldIndexEntry[];
  } catch {
    return [];
  }

  const result: LocalMap[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry.id !== 'string') continue;
    let rawMap: string | null;
    try {
      rawMap = storage.getItem(MAP_KEY_PREFIX + entry.id);
    } catch {
      continue;
    }
    if (!rawMap) continue;
    try {
      const data: unknown = JSON.parse(rawMap);
      if (!looksLikeMapData(data)) continue;
      const name =
        (typeof entry.name === 'string' && entry.name) ||
        data.project.name ||
        'Untitled map';
      result.push({ name, data });
    } catch {
      continue;
    }
  }
  return result;
}

/**
 * Per-account "import handled" flag key. Also per-device, since localStorage is
 * per-browser. Namespaced by user id so two accounts on the same browser are
 * independent.
 *
 * Known limitation (accepted): because the flag lives in localStorage, the dedup
 * is per-device. A user who signs in on a *second* browser that still holds old
 * pre-#16 local maps would be prompted again there, and accepting would create
 * cloud duplicates of maps already imported elsewhere — `detectLocalMaps` does
 * not reconcile against existing cloud maps. This only affects the narrow set of
 * devices that ran the old localStorage build, so we accept it rather than add a
 * server-side import marker or content-based dedup.
 */
export function importDoneKey(userId: string): string {
  return IMPORTED_KEY_PREFIX + userId;
}

/** Whether the import prompt has already been resolved (accepted or declined). */
export function hasImportRun(storage: Pick<Storage, 'getItem'>, userId: string): boolean {
  try {
    return storage.getItem(importDoneKey(userId)) !== null;
  } catch {
    return false;
  }
}

/** Mark the import as resolved so the prompt never reappears for this user. */
export function markImportRun(storage: Pick<Storage, 'setItem'>, userId: string): void {
  try {
    storage.setItem(importDoneKey(userId), new Date().toISOString());
  } catch {
    // Best-effort; if storage is unavailable the prompt may reappear, which is
    // acceptable (dedup is also guarded by hasImportRun on next mount).
  }
}
