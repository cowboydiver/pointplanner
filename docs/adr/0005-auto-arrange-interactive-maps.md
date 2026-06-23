# Auto re-layout interactive maps (Auto-arrange)

## Status

accepted

## Context

PointPlanner had two separate ways to place stations on the grid, and they
diverged sharply in quality:

- **Generated / mirror maps** run `layoutStations` (`src/lib/layout.ts`):
  deterministic topological columns, a per-line row **band**, and a **clearance
  pass** (`spreadForClearance`) that bumps any station sitting on an unrelated
  edge's straight run. These maps read cleanly.
- **Hand-built maps** run `placeNewStation` (`src/lib/placement.ts`): each new
  station is dropped one column right of its deepest prerequisite with no bands
  and no clearance. `DELETE_TASK` removed a station but never re-placed the
  survivors.

The result was the reported clutter: lines stacking on each other (no bands),
lines crossing over unrelated stations (no clearance), a "snake nest", and —
most visibly — lines twisting and bending after a mid-line task was added or
removed, because survivors stayed frozen in place and edges had to route around
the gap.

Crucially, **no station position is ever authored by a human** — there is no
drag or move action; coordinates come only from placement code. So re-running a
full layout over a whole map discards nothing the user created.

## Decision

Make the deterministic engine the **single** layout for every map. Interactive
edits stop nudging one station and instead re-run the whole layout via a new
`relayoutStations(stations, edges)` wrapper around `layoutStations`.

- **Trigger:** re-layout fires on **structural** edits (a change to the
  dependency graph or a station's line membership) inside the reducer, and on
  demand via a new **"Auto-arrange"** action/button. It does **not** fire on map
  load — that would rewrite stored positions on open (ADR 0002 version-guarded
  autosave churn) and needlessly re-flow generated/mirror maps that are already
  laid out. Metadata-only edits (rename, owner, …) do not re-flow.
- **Bands carry symptom "lines on top of each other."** Because each edge belongs
  to exactly one line and each line gets its own row band, different lines land on
  different rows. We do **not** add parallel-offset ("side-by-side track")
  rendering; the rare genuinely-collinear cross-line case is accepted.
- **Clearance wins over straightness.** When keeping a line off an unrelated
  station conflicts with keeping it straight, the station is bumped and the line
  bends — never the reverse. This is the existing `spreadForClearance` priority,
  now applied to interactive maps too.
- **Interchange band = primary line** (`station.lines[0]`), matching how
  rendering already picks a station's primary color.
- **Node-order stability contract:** layout is fed `state.stations` in array
  order. That order is append-only in practice (create appends, update maps in
  place, delete filters), so band assignment and clearance victim selection never
  reshuffle between edits. No sorting is introduced.

`placeNewStation` (and its `occupied` / `findFreeRow` helpers) is removed.

Considered and rejected:

- *Re-layout on load* — disruptive re-flow of maps the user only opened, plus
  autosave/version churn under ADR 0002.
- *Crossing-minimization now* (Sugiyama / barycenter ordering) — a large
  algorithmic investment; deferred until band separation proves insufficient on
  real maps.
- *Parallel-offset rendering for #1* — large, corner-case-heavy rendering change
  that bands make largely unnecessary.

## Consequences

- Adding or deleting a mid-line task re-flows the whole map deterministically, so
  lines straighten and gaps close instead of bending around them.
- Hand-built maps gain the same band separation and clearance generated maps have,
  so lines no longer stack or cross unrelated stations.
- Interactive maps can now grow **taller** after an edit (clearance slides
  stations downward) — the same trade-off generated maps already make.
- A user can tidy any existing cluttered map at will with **Auto-arrange**; it is
  a mutating action, so it autosaves and is unavailable on read-only mirrors and
  Viewer shares.
- The "snake nest" (crossing density) improves via band separation but is not
  fully solved; dedicated crossing-minimization remains a possible follow-up.
