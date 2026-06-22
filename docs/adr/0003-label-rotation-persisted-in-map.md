# Label rotation is persisted in the map, not a per-viewer preference

## Status

accepted

## Context

PointPlanner already has per-viewer display toggles (dark theme, hide-labels)
that live only in client state / `localStorage` and never touch the saved map. We
added a subway-style control that rotates *all* station labels at once and had to
decide where the chosen angle lives.

## Decision

Store the angle as `project.labelAngle` inside `MapData`, so it rides the normal
debounced autosave and version guard (ADR 0002) and travels with the map for
every viewer — including shared and generated maps. It is treated as a content
edit: `SET_LABEL_ANGLE` is in `MUTATING_ACTIONS`, so read-only stores (Viewers /
GitHub mirrors) drop it and the Topbar control is hidden for them.

## Consequences

- The orientation is consistent for everyone looking at a map, matching the
  "central control for the whole map" intent rather than a private view setting.
- It diverges from the theme / hide-labels pattern (which are view-only); a future
  reader might expect rotation to be view-only too — hence this record.
- A Viewer or mirror cannot change the rotation, since it is a map edit. That is
  the accepted trade-off for making the setting travel with the map.
