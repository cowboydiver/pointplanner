import type { LabelPlacement } from './types';

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
  const result: Record<string, LayoutResult> = {};

  for (const n of nodes) {
    const col = colById.get(n.id) ?? 0;
    const band = bandByLine.get(n.lineId) ?? 0;

    let row = band;
    while (occupied.has(`${col},${row}`)) row += 1;

    occupied.add(`${col},${row}`);
    result[n.id] = {
      col,
      row,
      lp: row >= 3 ? 'bottom' : 'top',
    };
  }

  return result;
}
