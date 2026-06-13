# Maps stored as a JSONB blob with async editing and an optimistic version guard

## Status

accepted

## Context

A Map is a self-contained document (`MapData`: `project`, `lines`, `stations`,
`edges`). Multiple Editors may edit a shared Map, but we decided editing is
**asynchronous** — not simultaneous, Google-Docs-style. We need a storage shape
and a collision rule that fit that decision.

## Decision

Store each Map as **one `maps` row** with a single `data jsonb` column holding
the whole `MapData`, plus `owner`, `version`, and `updated_at`. We do **not**
normalize stations/lines/edges into separate tables.

Editing is async with **debounced autosave** of the whole blob. Each save
carries the `version` the client loaded; if the server's version is newer, the
save is **rejected** and the User is told the Map changed and must reload
(reloading discards their divergent local edits). There is **no real-time
sync** — a shared Map reflects others' changes on reload/refocus, not live.

## Consequences

- The jsonb shape mirrors today's `MapData` verbatim, so save/load is trivial
  and the stale-write guard is a single version comparison.
- We cannot run SQL across map internals (e.g. "all stations due Friday") — we
  have no such need.
- Because the unit of save is the whole blob, a rejected save cannot be
  auto-merged; the stale Editor must reload and redo. This is the deliberate
  sharp edge of choosing async-blob over real-time CRDT collaboration.
- A Viewer does not see live updates; this is the accepted cost of "async, no
  real-time infra."
