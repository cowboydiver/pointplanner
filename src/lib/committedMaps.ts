import type { MapData } from './maps';

// Committed map files under `/maps/*.json` are bundled at build time via Vite's
// glob import. Each one is surfaced in the MapSwitcher and, on first encounter,
// copied into an editable localStorage map (seeded once, then user-owned).
//
// `eager: true` so the data is available synchronously during registry
// bootstrap — these are small, hand-/generator-authored files.
const modules = import.meta.glob<{ default: MapData }>('../../maps/*.json', {
  eager: true,
});

export interface CommittedMap {
  // Stable id derived from the filename (e.g. `maps/roadmap.json` → `roadmap`).
  // Used both as the localStorage map id and to detect "already seeded".
  id: string;
  name: string;
  data: MapData;
}

function isMapData(value: unknown): value is MapData {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.project === 'object' &&
    v.project !== null &&
    Array.isArray(v.lines) &&
    Array.isArray(v.stations) &&
    Array.isArray(v.edges)
  );
}

function fileIdFromPath(path: string): string {
  const file = path.split('/').pop() ?? path;
  return file.replace(/\.json$/i, '');
}

// Discover committed maps deterministically (sorted by filename id).
export function getCommittedMaps(): CommittedMap[] {
  const out: CommittedMap[] = [];
  for (const [path, mod] of Object.entries(modules)) {
    const data = (mod as { default: unknown }).default;
    if (!isMapData(data)) continue;
    const id = fileIdFromPath(path);
    out.push({ id, name: data.project.name || id, data });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}
