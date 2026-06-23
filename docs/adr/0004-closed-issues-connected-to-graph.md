# Generated maps include closed issues connected to open work

## Status

accepted

## Context

A generated map (CLI `generate-map` and the GitHub-mirror flow both run the same
`githubToMap` transform) is meant to read as a dependency tree. The earlier rule
was: every open issue becomes a station, but a *closed* issue becomes one **only
when an open issue directly depends on it** (surfaced as a `done` prereq).

On a real repo that left open stations isolated. Two cases broke trees:

- A common blocker is closed, but the relationship survives only on the *closed*
  issue, or the open dependents reach it via a closed intermediate — the chain
  between the open work and the blocker was dropped.
- An open issue's only link is being a *prerequisite of* a now-closed issue. The
  closed dependent had no open dependent of its own, so it was excluded, its edge
  was dropped, and the open issue rendered with no connections at all.

## Decision

Include a closed issue as a `done` station when it is **connected — directly or
transitively, in either direction — to an open issue** through the dependency
graph. Concretely: build an undirected graph from the (cycle-broken) dependency
pairs, seed a flood-fill from every open issue, and keep any closed issue the
fill reaches. A fully-completed component with **no** open issue is left out.

Considered and rejected: *include every closed issue*. On a mature repo that
floods the map with disconnected `done` nodes — the opposite of the readability
goal — without helping any tree.

Separately (same change set), each generated station name is prefixed with its
issue number (`#42 Title`) so stations are identifiable at a glance and against
GitHub. The prefix is applied **after** prefix→line and shared-word stripping, so
those derivations still operate on the clean title.

## Consequences

- Closed blockers and the closed chains bridging them to open work appear as
  `done` stations, so open stations are no longer orphaned by a closed dependency.
- Self-contained completed work (a closed component with no open issue) stays off
  the map, keeping it focused on what's in flight.
- The fetch layers already request `state=all`, so no fetch change was needed —
  this is purely a transform-level inclusion rule.
