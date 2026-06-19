import type { Station } from './types';

/**
 * Recompute availability for all non-done/non-active stations.
 * A locked task becomes 'available' iff all its prerequisites are 'done'.
 * If a prereq is reopened (no longer done), downstream tasks lose readiness
 * and go back to 'locked'.
 *
 * Returns a new array of stations with updated statuses.
 */
export function recompute(stations: Station[], prereqs: Record<string, string[]>): Station[] {
  const byId: Record<string, Station> = {};
  stations.forEach(s => { byId[s.id] = s; });

  return stations.map(s => {
    if (s.status === 'done' || s.status === 'active') return s;
    const pr = prereqs[s.id] || [];
    const ready = pr.every(p => byId[p]?.status === 'done');
    const newStatus = ready ? 'available' : 'locked';
    if (newStatus === s.status) return s;
    return { ...s, status: newStatus };
  });
}
