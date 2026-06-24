import type { Edge, LabelPlacement, Station } from '../types.ts';

/**
 * Minimal node shape the layout cares about: just the station id, in a stable
 * caller-provided order. Positioning is purely structural (from the dependency
 * graph), so the layout needs nothing else.
 */
export interface LayoutNode {
  id: string;
}

export interface LayoutResult {
  col: number;
  row: number;
  lp: LabelPlacement;
}

const median = (xs: number[]): number => {
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

const CROSSING_SWEEPS = 8;
const RELAX_PASSES = 4;

/**
 * Deterministic subway-style layout from a dependency graph, tuned to keep dense
 * maps legible (ADR 0006). The pipeline, left to right:
 *
 *   1. Topological columns — a node sits one column right of its DEEPEST
 *      prerequisite (roots at 0). Memoized with an in-progress guard so a stray
 *      cycle settles at column 0 instead of looping forever.
 *   2. Root-column pull — a node with NO prerequisites slides right to just left
 *      of its earliest consumer, instead of being pinned at column 0. This kills
 *      the long trailing diagonals that a far-downstream source would otherwise
 *      draw across the whole map.
 *   3. Crossing reduction — iterated barycentre (median) ordering within each
 *      column, sweeping toward prerequisites then dependents, so lines stop
 *      tangling into a "snake nest".
 *   4. Strand packing — each node's row is pulled to the average row of its
 *      placed prerequisites and packed downward, so a dependency chain comes out
 *      as one near-horizontal strand (a line keeps its subway identity).
 *   5. Relaxation — a few passes nudging each node toward the median row of ALL
 *      its neighbours, within the slack its column order allows, straightening
 *      strands further.
 *   6. Compaction — drop globally-unused rows and columns so the map is tight.
 *   7. Label placement — `row >= 3 ? 'bottom' : 'top'`.
 *
 * Pure and order-stable: identical input (same node order, same `prereqs`)
 * always yields identical coordinates.
 *
 * @param nodes   stations in a stable order
 * @param prereqs `to -> [from...]` adjacency (station ids only), as produced by
 *                `buildIndexes`
 */
export function layoutStations(
  nodes: LayoutNode[],
  prereqs: Record<string, string[]>
): Record<string, LayoutResult> {
  const nodeIds = new Set(nodes.map(n => n.id));
  const nodeIndex = new Map(nodes.map((n, i) => [n.id, i]));
  const parentsOf = (id: string): string[] =>
    (prereqs[id] || []).filter(p => nodeIds.has(p) && p !== id);

  // ---- 1. Topological column = 1 + deepest prerequisite column (roots at 0).
  const asap = new Map<string, number>();
  const resolving = new Set<string>();
  const depthOf = (id: string): number => {
    const memo = asap.get(id);
    if (memo !== undefined) return memo;
    if (resolving.has(id)) return 0; // cycle guard
    resolving.add(id);
    let col = 0;
    for (const p of parentsOf(id)) col = Math.max(col, depthOf(p) + 1);
    resolving.delete(id);
    asap.set(id, col);
    return col;
  };
  for (const n of nodes) depthOf(n.id);

  // dependents (consumers), station ids only.
  const consumers = new Map<string, string[]>();
  for (const n of nodes) {
    for (const p of parentsOf(n.id)) {
      const list = consumers.get(p);
      if (list) list.push(n.id);
      else consumers.set(p, [n.id]);
    }
  }

  // ---- 2. Root-column pull. A node with no prerequisites moves to just left of
  // its earliest consumer (a consumer's column is >= 1, so this stays >= 0).
  const colById = new Map<string, number>();
  for (const n of nodes) {
    if (parentsOf(n.id).length) {
      colById.set(n.id, asap.get(n.id)!);
      continue;
    }
    const cs = consumers.get(n.id);
    const col = cs && cs.length ? Math.min(...cs.map(c => asap.get(c)!)) - 1 : asap.get(n.id)!;
    colById.set(n.id, Math.max(0, col));
  }

  const cols = [...new Set([...colById.values()])].sort((a, b) => a - b);
  const byCol = new Map<number, string[]>();
  for (const n of nodes) {
    const c = colById.get(n.id)!;
    const list = byCol.get(c);
    if (list) list.push(n.id);
    else byCol.set(c, [n.id]);
  }

  // ---- 3. Crossing reduction: iterated median ordering by neighbour ranks.
  const order = new Map<number, string[]>();
  for (const c of cols) {
    order.set(c, [...byCol.get(c)!].sort((a, b) => nodeIndex.get(a)! - nodeIndex.get(b)!));
  }
  const ranks = (): Map<string, number> => {
    const r = new Map<string, number>();
    for (const c of cols) order.get(c)!.forEach((id, i) => r.set(id, i));
    return r;
  };
  for (let s = 0; s < CROSSING_SWEEPS; s++) {
    let rank = ranks();
    const reorder = (c: number, neigh: (id: string) => string[]) => {
      const arr = order.get(c)!;
      const key = new Map<string, number>();
      for (const id of arr) {
        const ns = neigh(id).map(n => rank.get(n)).filter((v): v is number => v !== undefined);
        key.set(id, ns.length ? median(ns) : rank.get(id)!);
      }
      order.set(c, [...arr].sort((a, b) => (key.get(a)! - key.get(b)!) || (rank.get(a)! - rank.get(b)!)));
    };
    for (const c of cols) reorder(c, parentsOf);
    rank = ranks();
    for (const c of [...cols].reverse()) reorder(c, id => consumers.get(id) ?? []);
  }

  // ---- 4. Strand packing: row = barycentre of placed prerequisites; same-column
  // order is preserved (rows strictly increasing) and packed from the top.
  const pos = new Map<string, { col: number; row: number }>();
  for (const c of cols) {
    let prev = -1;
    for (const id of order.get(c)!) {
      const pr = parentsOf(id).map(p => pos.get(p)?.row).filter((v): v is number => v !== undefined);
      const desired = pr.length ? pr.reduce((a, b) => a + b, 0) / pr.length : prev + 1;
      const row = Math.max(Math.round(desired), prev + 1);
      pos.set(id, { col: c, row });
      prev = row;
    }
  }

  // ---- 5. Relaxation: pull each node toward the median row of all its
  // neighbours, within the slack its column order allows.
  for (let s = 0; s < RELAX_PASSES; s++) {
    for (const c of cols) {
      const arr = order.get(c)!;
      for (let i = 0; i < arr.length; i++) {
        const id = arr[i];
        const ns = [...parentsOf(id), ...(consumers.get(id) ?? [])]
          .map(n => pos.get(n)?.row)
          .filter((v): v is number => v !== undefined);
        if (!ns.length) continue;
        const lo = i === 0 ? -Infinity : pos.get(arr[i - 1])!.row + 1;
        const hi = i === arr.length - 1 ? Infinity : pos.get(arr[i + 1])!.row - 1;
        pos.get(id)!.row = Math.max(lo, Math.min(hi, Math.round(median(ns))));
      }
    }
  }

  // ---- 6. Compaction: drop globally-unused rows and columns.
  const remap = (key: 'row' | 'col') => {
    const used = [...new Set([...pos.values()].map(p => p[key]))].sort((a, b) => a - b);
    const m = new Map(used.map((v, i) => [v, i]));
    for (const p of pos.values()) p[key] = m.get(p[key])!;
  };
  remap('row');
  remap('col');

  // ---- 7. Materialize results with the seed label-placement heuristic.
  const result: Record<string, LayoutResult> = {};
  for (const n of nodes) {
    const p = pos.get(n.id)!;
    result[n.id] = { col: p.col, row: p.row, lp: p.row >= 3 ? 'bottom' : 'top' };
  }
  return result;
}

/**
 * Re-derive every station's grid position from the dependency graph, the
 * interactive-map counterpart to the inline `layoutStations` call generated
 * maps make in `githubToMap`. Positions are never authored by hand (there is no
 * drag), so re-flowing a whole map on a structural edit (or on demand via
 * Auto-arrange) discards nothing — see ADR 0005.
 *
 * Stations are fed in array order, the stable order callers already keep (append
 * on create, in-place on update, filtered on delete), so ordering never jitters
 * between edits.
 *
 * Only `col`/`row`/`lp` change; every other field (status, lines, metadata) is
 * preserved. Status is settled separately by `recompute`.
 */
export function relayoutStations(stations: Station[], edges: Edge[]): Station[] {
  const nodes: LayoutNode[] = stations.map(s => ({ id: s.id }));

  const prereqs: Record<string, string[]> = {};
  for (const e of edges) {
    (prereqs[e.to] = prereqs[e.to] || []).push(e.from);
  }

  const layout = layoutStations(nodes, prereqs);
  return stations.map(s => {
    const pos = layout[s.id];
    return pos ? { ...s, col: pos.col, row: pos.row, lp: pos.lp } : s;
  });
}
