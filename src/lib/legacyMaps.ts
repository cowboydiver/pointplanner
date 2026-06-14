/**
 * legacyMaps — detects maps left in localStorage by the old client-only app
 * (before the Supabase migration in issue #16).
 *
 * Legacy keys written by the OLD app (not the current app):
 *   pointplanner.index      — JSON { activeMapId, maps: [{id, name}] }
 *   pointplanner.map.<id>   — JSON MapData for each id in that index
 *   pointplanner.v1         — JSON MapData for a very-old single-map shape
 *
 * These keys are NEVER written by the current app, so any present are genuine
 * leftovers to offer for import.
 *
 * React-free and unit-testable: all functions accept a Storage-like object so
 * tests can pass a plain object instead of the real localStorage.
 */

import type { MapData } from './maps';

export interface LegacyMap {
  id: string;
  name: string;
  data: MapData;
}

/** Minimal structural check: must have project, lines, stations, edges arrays. */
function isMapData(value: unknown): value is MapData {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['project'] === 'object' && v['project'] !== null &&
    Array.isArray(v['lines']) &&
    Array.isArray(v['stations']) &&
    Array.isArray(v['edges'])
  );
}

function parseJson(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Detect legacy maps in a Storage-like object. Returns [] when nothing valid
 * is found. Never throws — malformed JSON and missing keys are silently skipped.
 */
export function detectLegacyMaps(storage: Pick<Storage, 'getItem'>): LegacyMap[] {
  const found: LegacyMap[] = [];
  const seenIds = new Set<string>();

  // ── Primary source: pointplanner.index ───────────────────────────────────────
  const indexRaw = storage.getItem('pointplanner.index');
  if (indexRaw !== null) {
    const index = parseJson(indexRaw);
    if (
      typeof index === 'object' && index !== null &&
      Array.isArray((index as Record<string, unknown>)['maps'])
    ) {
      const maps = (index as { maps: unknown[] }).maps;
      for (const entry of maps) {
        if (
          typeof entry !== 'object' || entry === null
        ) continue;
        const { id, name } = entry as Record<string, unknown>;
        if (typeof id !== 'string' || typeof name !== 'string') continue;
        if (seenIds.has(id)) continue;

        const dataRaw = storage.getItem(`pointplanner.map.${id}`);
        const data = parseJson(dataRaw);
        if (!isMapData(data)) continue;

        seenIds.add(id);
        found.push({ id, name, data });
      }
    }
  }

  // ── Fallback: very-old single-map key pointplanner.v1 ────────────────────────
  const v1Raw = storage.getItem('pointplanner.v1');
  if (v1Raw !== null) {
    const data = parseJson(v1Raw);
    if (isMapData(data)) {
      const id = 'v1';
      if (!seenIds.has(id)) {
        const name =
          typeof (data as MapData).project?.name === 'string' && (data as MapData).project.name
            ? (data as MapData).project.name
            : 'My Map';
        seenIds.add(id);
        found.push({ id, name, data });
      }
    }
  }

  return found;
}

// ── Per-account "import done" marker ─────────────────────────────────────────

const LEGACY_IMPORT_KEY_PREFIX = 'pointplanner.legacy-imported.';
const LEGACY_IMPORT_KEY_FALLBACK = 'pointplanner.legacy-imported';

function markerKey(userId: string | null | undefined): string {
  if (userId) return LEGACY_IMPORT_KEY_PREFIX + userId;
  return LEGACY_IMPORT_KEY_FALLBACK;
}

export function getLegacyImportDone(userId: string | null | undefined): boolean {
  try {
    return localStorage.getItem(markerKey(userId)) === '1';
  } catch {
    return false;
  }
}

export function setLegacyImportDone(userId: string | null | undefined): void {
  try {
    localStorage.setItem(markerKey(userId), '1');
  } catch {
    // ignore
  }
}
