import type { MapData } from './maps';

/**
 * Pure structural validation of a generated `MapData`, used by the generator
 * script to refuse writing a malformed file. Stays I/O-free so it can be unit
 * tested and reused. Returns a list of human-readable problems; an empty list
 * means the map is safe to render.
 *
 * Checks:
 * - at least one line exists;
 * - every edge's `from`/`to` references a real station;
 * - every edge's `line` references a real line;
 * - every station's `lines` reference real lines;
 * - the edge graph is acyclic.
 */
export function validateMapData(map: MapData): string[] {
  const errors: string[] = [];

  const stationIds = new Set(map.stations.map(s => s.id));
  const lineIds = new Set(map.lines.map(l => l.id));

  if (map.lines.length === 0) {
    errors.push('No lines: a map needs at least one line.');
  }

  for (const e of map.edges) {
    if (!stationIds.has(e.from)) {
      errors.push(`Edge references missing station "${e.from}" (from).`);
    }
    if (!stationIds.has(e.to)) {
      errors.push(`Edge references missing station "${e.to}" (to).`);
    }
    if (!lineIds.has(e.line)) {
      errors.push(`Edge ${e.from}->${e.to} references missing line "${e.line}".`);
    }
  }

  for (const s of map.stations) {
    for (const lineId of s.lines) {
      if (!lineIds.has(lineId)) {
        errors.push(`Station "${s.id}" references missing line "${lineId}".`);
      }
    }
  }

  if (hasCycle(map)) {
    errors.push('Dependency graph contains a cycle.');
  }

  return errors;
}

/** True if the edge graph (from → to) contains a directed cycle. */
function hasCycle(map: MapData): boolean {
  const adj = new Map<string, string[]>();
  for (const e of map.edges) {
    const out = adj.get(e.from);
    if (out) out.push(e.to);
    else adj.set(e.from, [e.to]);
  }

  // 0 = unvisited, 1 = on the current DFS stack, 2 = fully explored.
  const state = new Map<string, number>();
  const nodes = new Set<string>();
  for (const e of map.edges) {
    nodes.add(e.from);
    nodes.add(e.to);
  }

  const visit = (node: string): boolean => {
    if (state.get(node) === 1) return true; // back-edge → cycle
    if (state.get(node) === 2) return false;
    state.set(node, 1);
    for (const next of adj.get(node) ?? []) {
      if (visit(next)) return true;
    }
    state.set(node, 2);
    return false;
  };

  for (const node of nodes) {
    if (visit(node)) return true;
  }
  return false;
}
