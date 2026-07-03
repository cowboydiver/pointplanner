# Step edges clear of stations they only pass over

## Status

accepted. **Closes the residual case [ADR 0006](0006-crossing-reduction-layout.md)
left open** ("a gentler, compaction-aware clearance can be revisited if it
resurfaces"), and is the sibling of [ADR 0007](0007-bundle-collinear-cross-line-runs.md):
another pure render-time pass over already-routed waypoints, with layout untouched.

## Context

Lines are continuous colored strokes and stations are filled markers with no white
casing, so a line passing dead-centre through a marker reads as **stopping** there.
Layout (ADR 0006) keeps most lines strand-like, but it explicitly does *not*
guarantee a straight run never clips an unrelated station. ADR 0006 named the
minimal case verbatim: a transitive `a→b→c` plus a direct `a→c`, where `b` lands on
the `a→c` run. The direct edge then draws straight through `b`'s marker.

When that direct edge is a **different line** than the station it crosses, the
result is a *false stop* — e.g. a QA line drawn through a design-only station reads
as if QA stops there. (When it is the **same** line, `b` genuinely carries that
line and the pass-through reads correctly as a stop; those legs are also same-line
collinear overlap, which bundling already leaves alone.)

ADR 0006 rejected the old `spreadForClearance` **layout** pass: on dense maps
bumping a clipped station cascades and fights compaction (12 crossings → 70). So
the fix belongs at render time, where ADR 0007 already established the pattern.

## Decision

New pure module `src/lib/clearance.ts` (`clearPassedStations`), composed in
`TransitMap` **after** bundling, over each edge's effective (post-bundling)
waypoints. Where an edge's straight leg crosses a station its **own line does not
serve** (and which is not one of its endpoints), the leg is rewritten into a short
parallel **plateau**: a 45° ramp off the centreline, a flat run one marker-width
(`LANE_PITCH`) clear of the marker, and a 45° ramp back. Multiple crossings on one
leg each get a plateau (merged when they are too close to dip between); the leg
returns to the centreline at both endpoints, so legs stay independent and splice
with no boundary reconciliation.

Key properties:

- **Only clears false stops.** A station on the edge's line is a legitimate stop
  and is left alone — that is also why a same-line `a→c` coincident with `a→b→c` is
  never disturbed.
- **Runs after bundling.** A bundled non-trunk lane already sits `LANE_PITCH` off
  the centre (a marker's width), so only trunk / un-bundled legs that still run
  through a marker are rewritten. The crossing threshold (`markerRadius = 13`, the
  interchange marker) is below `LANE_PITCH = 16`, so a bundled lane is never
  mistaken for a crossing.
- **One shared corner radius.** Plateau joins fillet with the same `CORNER_RADIUS`
  as every routing bend (`pointsToPath`), so the step reads as ordinary corners —
  identical to a bundling lane join.
- **Pure and stateless.** Pixel-space only; positions still come solely from layout,
  so it composes with Auto-arrange and mirrors/Viewer shares get it for free.

Considered and rejected:

- *A layout clearance pass* — still rejected exactly as in ADR 0006 (cascades,
  fights compaction). This change repaints a single accepted residual, it does not
  move stations.
- *Clearing every non-endpoint station (endpoint-based, not line-based)* — would
  bump a line over stations it legitimately serves, breaking the strand it belongs
  to. The line-membership rule is what makes the step correct.

## Consequences

- A line now visibly steps around any stop it does not serve instead of appearing
  to call there; the false-stop reading is gone.
- Clearance and bundling stack cleanly on a shared run (a bundled lane needs no
  further clearing; a lone straight leg gets a plateau) — see the `TransitMap` memo.
- Pure and unit-tested (`src/lib/clearance.test.ts`); the React layer is thin wiring
  that falls back to the routed points for un-cleared edges.
