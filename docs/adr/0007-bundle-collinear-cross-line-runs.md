# Bundle residual collinear cross-line runs into parallel lanes

## Status

accepted. **Narrows the parallel-offset rejection in
[ADR 0005](0005-auto-arrange-interactive-maps.md) and
[ADR 0006](0006-crossing-reduction-layout.md):** those ADRs rejected render-time
parallel-offsetting *as a substitute for fixing layout*. Layout still owns
positioning; this ADR adds offsetting only for the residual overlap that layout
explicitly accepts.

## Context

ADR 0005/0006 drive different lines onto different rows (per-line bands, then
crossing-reduction + strand packing), so lines rarely coincide. Both ADRs then
rejected "parallel-offset rendering" — but specifically as a *substitute* for
layout ("repainting clutter that lives in station positions"). They left one case
on the table, called out verbatim in 0005: "the rare genuinely-collinear
cross-line case is accepted."

In practice a few segments still survive where two or more **different** lines run
along the *identical* grid run (e.g. several dependencies converging along one row
into a merge). With no white casing (lines are continuous colored strokes so
crossings read as crossings), those segments draw directly on top of each other —
the lower-painted lines are simply invisible there.

## Decision

Disambiguate **only** the residual collinear cross-line overlap, at render time,
without touching layout. New pure module `src/lib/bundling.ts`
(`offsetCollinearLegs`), composed in `TransitMap` after `resolveRouting` and fed to
each `Segment`. The model is **trunk-fixed**:

- **One trunk stays put.** Among the lines sharing a run, the one earliest in the
  project's line order keeps the original track (offset 0) and never moves. The
  others are pushed into fixed parallel **lanes** beside it, flanking both sides
  (`laneOffset`: +1, −1, +2, −2 … × `LANE_PITCH`).
- **One lane per leg.** A line holds a single lane offset for the whole straight
  run between two of its own waypoints. It returns to the centerline **only at its
  own stations** (with a 45° notch, so it visibly touches its stop) and **passes
  stations it does not serve in a straight line**. It never peels back to the
  centerline at a bare bundle-region boundary — that would make a continuing line
  dip to touch a station that merely marks where the *other* lines left.
- **Joins slide in, not spike.** Where a line turns to join or leave a corridor at
  an interior routing bend, the bend is shifted onto the lane and the adjacent
  non-collinear leg is dragged to meet it, so the line slides straight into its lane.
- **One shared corner radius.** Lane joins fillet with the same `CORNER_RADIUS` as
  every normal routing bend (`pointsToPath`), so the offsetting is invisible as a
  separate visual language.

Layout is untouched: `offsetCollinearLegs` is a pure pixel-space pass over the
already-routed waypoints, and edges still render as one `<path>` each.

Considered and rejected:

- *Offsetting as a layout substitute* — still rejected, exactly as in 0005/0006.
  This change is scoped to the residual overlap layout already accepts.
- *Symmetric centering* (shift every line in a bundle off the original track) —
  prototyped and rejected: the busiest line moved and corners wobbled. Pinning the
  trunk keeps the dominant line perfectly straight.
- *Bowing lanes around passing-station markers for extra clearance* — unnecessary;
  a lane passing a marker in a straight line reads fine.

## Consequences

- The few genuinely-collinear cross-line runs now read as separate parallel tracks
  instead of one line hiding the others.
- Because the trunk is pinned to the centerline, a non-trunk lane sits exactly
  `LANE_PITCH` from the center markers it passes; `LANE_PITCH` is chosen to clear a
  station marker. Tighter lane spacing and marker clearance are therefore coupled.
- It is purely cosmetic and stateless — nothing is saved, mirrors and Viewer shares
  get it for free, and it composes with Auto-arrange (positions still come only from
  layout). The `sharp`-corner mechanism explored during prototyping was dropped once
  joins were unified onto the shared corner radius.
- Pure and unit-tested (`src/lib/bundling.test.ts`); the React layer is a thin
  wiring that falls back to the original routed points for un-bundled edges.
