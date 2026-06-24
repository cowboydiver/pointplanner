# Crossing-reduction layout (replace bands + clearance)

## Status

accepted

## Context

`layoutStations` (`src/lib/layout.ts`) placed stations with topological columns,
a per-line row **band**, a barycentre pack within each band, and a final
**clearance** pass (`spreadForClearance`) that slid any station off an unrelated
edge's straight run. It read fine on small generated maps, but on real dense maps
(e.g. the `cowboydiver/homesweathome` mirror — 35 stations, 50 edges, 6 lines) it
produced exactly the reported clutter:

- **Lines on top of each other / crossing unrelated stations / "snake nest".**
  Per-line bands fixed the *which row* question but did nothing about ordering,
  so a graph whose edges cross between lines still tangled. Measured: **168 edge
  crossings** on homesweathome.
- **Long trailing diagonals.** A source pinned at column 0 whose consumers sat at
  columns 4–6 drew one straight line across the whole map.

A render-time prototype (perpendicular line-bundling, white casing, detouring
segments around stations) was built and rejected: it cannot fix clutter that
lives in the **station positions**, only repaint it. The fix had to be in the
layout.

## Decision

Replace the band + clearance row logic with a Sugiyama-style pipeline that keeps
each line reading as one near-horizontal **strand**:

1. **Topological columns** — a node sits one column right of its deepest
   prerequisite (roots at 0); cycle-guarded.
2. **Root-column pull** — a node with no prerequisites slides right to just left
   of its earliest consumer, killing the long trailing diagonals.
3. **Crossing reduction** — iterated barycentre (median) ordering within each
   column, sweeping toward prerequisites then dependents.
4. **Strand packing** — each node's row is pulled to the average row of its
   placed prerequisites and packed downward, so a dependency chain comes out as
   one straight strand.
5. **Relaxation** — a few passes nudging each node toward the median row of all
   its neighbours, within its column-order slack.
6. **Compaction** — drop globally-unused rows and columns.

On homesweathome this takes crossings **168 → 12 (−93%)** and height 15 → 11
rows, with every colored line staying strand-like.

### What was removed, and the trade-off

- **Per-line bands** are gone. Positioning is now purely structural — a station's
  row comes from the graph, not from `lines[0]`. A line still reads as a strand
  because its chain packs onto one row. A pure primary-line swap therefore no
  longer moves a station (it still recolors the incident edges).
- **The clearance pass** (`spreadForClearance`) is gone. It is incompatible with
  compaction: dense shared rows make a long edge's run collide with many
  unrelated stations, and bumping them cascades — on homesweathome it turned the
  clean 12-crossing layout back into a 70-crossing mess. The cost is that
  ordering alone no longer *guarantees* a line never clips an unrelated station
  (the minimal case is a transitive `a→b→c` plus a direct `a→c`, where `b` sits
  on the `a→c` line). In practice crossing-reduction + strand packing avoids this
  on real maps; a gentler, compaction-aware clearance can be revisited if it
  resurfaces.

Determinism and the node-order stability contract are preserved (ADR 0005): same
input → same coordinates.

## Consequences

- The clutter problems that motivated this (overlapping lines, lines over
  unrelated stations, snake nest, twisting on mid-line edits) are addressed at
  the root — the positions — rather than by render tricks.
- `layout.test.ts`, `githubToMap.test.ts`, and `projectStore.test.ts` were
  updated where they asserted band/clearance specifics; the structural
  invariants (columns by depth, chains stay straight, determinism) still hold.
