# Label rotation is a per-viewer preference, not saved map content

## Status

accepted (supersedes the earlier "persisted in the map" decision recorded below)

## Context

PointPlanner has a subway-style control that rotates *all* station labels at once
(0° or 45°), and we had to decide where the chosen angle lives.

An earlier revision stored it as `project.labelAngle` inside `MapData` so it rode
the normal autosave and travelled with the map. That broke the most important way
to create a GitHub-backed map: a **GitHub mirror** (`maps.is_mirror`). Mirrors —
and Viewer shares — are read-only, so `SET_LABEL_ANGLE` was a `MUTATING_ACTION`
that got dropped and the control was hidden. The people most likely to want
denser, rotated labels (anyone viewing a generated repo roadmap) couldn't use it.

## Decision

Treat the angle like the existing display toggles (dark theme, hide-labels): a
**per-viewer preference**, never part of `MapData`.

- `labelAngle` lives in client `StoreState`, set by `SET_LABEL_ANGLE` — which is
  **not** in `MUTATING_ACTIONS`, so it works on read-only stores.
- It is persisted to `localStorage`, **keyed per map id** (`pointplanner.labelAngle.<id>`),
  via the pure `src/lib/labelAnglePref.ts` helper (a `Storage` double makes it
  unit-testable, like the localImport helpers). Per-map because a rotation that
  decongests one dense map need not apply to every other map.
- The Topbar control is always shown; `Project` no longer carries `labelAngle`.

## Consequences

- Rotation works everywhere, including GitHub mirrors and Viewer shares.
- The orientation is private to each viewer/device rather than shared on the map —
  the accepted trade-off, and consistent with theme / hide-labels.
- One less field in the saved blob; no migration needed (the old optional field is
  simply ignored by `importMap` if present in legacy data).

---

## Superseded decision (for the record)

> Store the angle as `project.labelAngle` inside `MapData` so it rides autosave and
> travels with the map for every viewer. Treated as a content edit
> (`SET_LABEL_ANGLE` in `MUTATING_ACTIONS`), so read-only stores dropped it and the
> Topbar control was hidden for them.

Reversed because making the setting travel with the map cost the read-only mirror
and Viewer cases, which is exactly where rotating labels is most useful.
