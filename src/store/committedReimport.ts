// Prefix keeps committed-map ids in their own namespace, clear of seed/blank ids.
export const COMMITTED_ID_PREFIX = 'committed-';

/**
 * If `mapId` is a committed-backed map (`committed-<fileId>`), return that
 * committed file's id (e.g. `roadmap`); otherwise null. The registry uses this
 * (gated on the file still existing) to decide whether to offer Re-import.
 */
export function committedSourceId(mapId: string): string | null {
  if (!mapId.startsWith(COMMITTED_ID_PREFIX)) return null;
  return mapId.slice(COMMITTED_ID_PREFIX.length);
}
