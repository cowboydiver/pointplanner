import type { LabelPlacement } from '../types.ts';

/**
 * Minimal node shape the layout cares about. Callers pass stations in a stable
 * order; `lineId` is the single line a generated station belongs to (its band).
 */
export interface LayoutNode {
  id: string;
  lineId: string;
}

export interface LayoutResult {
  col: number;
  row: number;
  lp: LabelPlacement;
}

/**
 * Deterministic subway-style layout from a dependency graph.
 *
 * - `col` ← topological depth: a root (no station prerequisites) sits at col 0;
 *   every other station lands one column right of its DEEPEST prerequisite.
 * - `row` ← packed within the station's line band. Lines are stacked in the
 *   order their first station appears; within a band stations spread across
 *   rows, and a col/row collision bumps the row deterministically.
 * - `lp` ← seed heuristic: `row >= 3 ? 'bottom' : 'top'`.
 *
 * Pure and order-stable: identical input (same node order, same `prereqs`)
 * always yields identical coordinates. The graph is assumed acyclic; a stray
 * cycle is tolerated (no infinite loop) — nodes still on the stack when no more
 * progress is possible fall back to depth 0.
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

  // ---- 1. Topological column = 1 + deepest prerequisite column (roots at 0).
  // Memoized depth resolution with an in-progress guard so a cycle can't loop
  // forever — a node caught mid-resolution settles at column 0.
  const colById = new Map<string, number>();
  const resolving = new Set<string>();

  const depthOf = (id: string): number => {
    const memo = colById.get(id);
    if (memo !== undefined) return memo;
    if (resolving.has(id)) return 0; // cycle guard: break the loop deterministically
    resolving.add(id);

    // Only prerequisites that are themselves stations count toward depth.
    const parents = (prereqs[id] || []).filter(p => nodeIds.has(p) && p !== id);
    let col = 0;
    for (const p of parents) {
      col = Math.max(col, depthOf(p) + 1);
    }

    resolving.delete(id);
    colById.set(id, col);
    return col;
  };

  for (const n of nodes) depthOf(n.id);

  // ---- 2. Assign each line a base row band, in first-appearance order. ----
  const bandByLine = new Map<string, number>();
  let nextBand = 0;
  for (const n of nodes) {
    if (!bandByLine.has(n.lineId)) {
      bandByLine.set(n.lineId, nextBand);
      nextBand += 1;
    }
  }

  // ---- 3. Pack rows per line, resolving col/row collisions deterministically.
  // `occupied` keys every taken cell so two stations never share a col/row.
  // Within a line band we prefer the band row, then fan outward (band+1, band+2,
  // …) so a line's stations spread across rows as the column fills up.
  const occupied = new Set<string>(); // `${col},${row}`
  const pos = new Map<string, { col: number; row: number }>();

  for (const n of nodes) {
    const col = colById.get(n.id) ?? 0;
    const band = bandByLine.get(n.lineId) ?? 0;

    let row = band;
    while (occupied.has(`${col},${row}`)) row += 1;

    occupied.add(`${col},${row}`);
    pos.set(n.id, { col, row });
  }

  // ---- 4. Clearance: bump stations off any unrelated edge's straight run. ----
  // Distinct line bands already keep different lines on different rows (so their
  // horizontal runs don't overlap); this pass fixes the remaining case the user
  // hit — a line passing straight through an unrelated station — by moving the
  // offending station down to a clear row. The map may grow taller, which is fine.
  spreadForClearance(nodes, nodeIds, prereqs, pos, occupied);

  // ---- 5. Materialize results with the seed label-placement heuristic. ----
  const result: Record<string, LayoutResult> = {};
  for (const n of nodes) {
    const p = pos.get(n.id)!;
    result[n.id] = {
      col: p.col,
      row: p.row,
      lp: p.row >= 3 ? 'bottom' : 'top',
    };
  }

  return result;
}

/** A station-to-station dependency edge, derived from the prereq graph. */
interface LayoutEdge {
  from: string;
  to: string;
  /** Diagonal-first flag, mirroring `resolveRouting` in routing.ts. */
  df: boolean;
}

/**
 * The interior grid cells an edge's *straight run* passes through, endpoints
 * excluded. A 45° transit edge is a short diagonal stub plus one straight run;
 * the straight run is the part that visibly crosses intermediate stations:
 *
 *  - same column  → vertical run down that column;
 *  - same row     → horizontal run along that row;
 *  - otherwise    → horizontal run along the target row (df) or source row (!df),
 *                   matching the bend choice `resolveRouting` makes.
 *
 * Mirrors the geometry in routing.ts but works in grid space (col/row), which is
 * all the layout needs to keep lines off unrelated stations.
 */
function edgeRunCells(
  e: LayoutEdge,
  pos: Map<string, { col: number; row: number }>,
): { col: number; row: number }[] {
  const a = pos.get(e.from)!;
  const b = pos.get(e.to)!;
  const cells: { col: number; row: number }[] = [];
  if (a.col === b.col) {
    const lo = Math.min(a.row, b.row);
    const hi = Math.max(a.row, b.row);
    for (let r = lo + 1; r < hi; r++) cells.push({ col: a.col, row: r });
    return cells;
  }
  const runRow = a.row === b.row ? a.row : e.df ? b.row : a.row;
  const lo = Math.min(a.col, b.col);
  const hi = Math.max(a.col, b.col);
  for (let c = lo + 1; c < hi; c++) cells.push({ col: c, row: runRow });
  return cells;
}

/**
 * Iteratively move stations off any unrelated edge's straight run. Each pass
 * rebuilds the run map from current positions (so a move that shifts an edge is
 * accounted for), finds the first blocked station in node order, and slides it
 * down to the next row that is neither occupied nor on an unrelated run. Bounded
 * and order-stable: identical input always yields identical output.
 */
function spreadForClearance(
  nodes: LayoutNode[],
  nodeIds: Set<string>,
  prereqs: Record<string, string[]>,
  pos: Map<string, { col: number; row: number }>,
  occupied: Set<string>,
): void {
  // Edges (station→station) + their df flag, mirroring resolveRouting. Degrees
  // (hence df) depend only on graph shape, so they're computed once.
  const edges: LayoutEdge[] = [];
  const inDeg: Record<string, number> = {};
  const outDeg: Record<string, number> = {};
  for (const n of nodes) {
    for (const p of prereqs[n.id] || []) {
      if (!nodeIds.has(p) || p === n.id) continue;
      inDeg[n.id] = (inDeg[n.id] || 0) + 1;
      outDeg[p] = (outDeg[p] || 0) + 1;
      edges.push({ from: p, to: n.id, df: false });
    }
  }
  for (const e of edges) {
    const targetIsMerge = (inDeg[e.to] || 0) > 1;
    const sourceIsBranch = (outDeg[e.from] || 0) > 1;
    e.df = !(targetIsMerge && !sourceIsBranch);
  }

  // True when some edge NOT incident to `nodeId` runs through (col,row).
  const blockedAt = (
    runs: Map<string, LayoutEdge[]>,
    col: number,
    row: number,
    nodeId: string,
  ): boolean =>
    (runs.get(`${col},${row}`) || []).some(e => e.from !== nodeId && e.to !== nodeId);

  const cap = nodes.length * 8 + 16;
  for (let iter = 0; iter < cap; iter++) {
    // Rebuild the run map from current positions.
    const runs = new Map<string, LayoutEdge[]>();
    for (const e of edges) {
      for (const c of edgeRunCells(e, pos)) {
        const key = `${c.col},${c.row}`;
        const list = runs.get(key);
        if (list) list.push(e);
        else runs.set(key, [e]);
      }
    }

    // First station sitting on an unrelated run (stable node order).
    const victim = nodes.find(n => {
      const p = pos.get(n.id)!;
      return blockedAt(runs, p.col, p.row, n.id);
    });
    if (!victim) return; // all clear

    const p = pos.get(victim.id)!;
    occupied.delete(`${p.col},${p.row}`);
    let row = p.row + 1;
    while (occupied.has(`${p.col},${row}`) || blockedAt(runs, p.col, row, victim.id)) {
      row += 1;
    }
    occupied.add(`${p.col},${row}`);
    pos.set(victim.id, { col: p.col, row });
  }
}
