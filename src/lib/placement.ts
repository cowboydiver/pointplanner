import type { Station } from '../types';

// Station positions are derived wholesale by `relayoutStations` (src/lib/layout.ts);
// this module only owns id slugging now. See ADR 0005.
export function slugify(name: string, stationById: Record<string, Station>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'task';
  let id = base;
  let n = 2;
  while (stationById[id]) {
    id = base + '-' + n;
    n++;
  }
  return id;
}
