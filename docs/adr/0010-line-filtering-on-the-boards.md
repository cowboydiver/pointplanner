# Line filtering on the boards

## Status

accepted.

## Context

Selecting a line in the legend filters the map: `SET_HIGHLIGHT_LINE` dims every
station and segment the line does not serve (`.station.dim` at `.12` opacity) so
one route reads out of the braid. The three boards (ADR 0009) ignored that
selection entirely. Picking a line, switching to Queue and finding the whole
project still listed reads as the filter having been silently dropped —
especially since the legend, where the selection is made and shown as an active
row, stays on screen in every view.

The map's answer to "what about the rest?" is forced. A map with stations
removed is not a smaller map, it is a *wrong* map: the routes would run to
nowhere and the geography would lie. So the map fades, and has no alternative.

A board is a list. Removing rows from a list leaves a shorter, still-truthful
list — and one whose counts, ranks and lanes can honestly re-derive around the
subset. So the boards do have a choice, and the two options answer different
questions:

- **Fade** — "where does this line sit in the whole project?" Every station
  stays put, so the filtered line is read against everything around it and
  nothing moves when the filter changes.
- **Hide** — "what does this line alone look like?" `13 locked` becomes `6
  locked`, the queue ranks only this line's work, and Departures collapses to a
  single lane.

Neither dominates. Fade preserves context and keeps the boards consistent with
the map; Hide is the only mode that makes the numbers on a board mean the line
rather than the project.

## Decision

Filter all three boards from the legend's existing line selection, and ship
**both** renderings of the exclusions behind a toggle rather than choosing one.

- **No new selection UI.** The boards read `state.highlightLine`, the same
  selection the map uses, so one legend click filters whichever view is on
  screen. `SET_HIGHLIGHT_LINE` is unchanged.
- **`applyLineFilter` in `src/lib/board.ts`** takes the finished `BoardModel`
  and narrows it — a filter is a way of looking at the graph, not a graph fact,
  so `buildBoardModel` stays filter-blind and the boards keep one model source.
  `fade` marks excluded entries `dim` and changes nothing else. `hide` drops
  them, which re-derives `total`, every group length, and `lines` around the
  survivors. Ranking is untouched in both — `byDownstreamFirst` has already run
  and removing entries preserves the order of the rest.
- **`boardLineFilter` is client state**, `'fade' | 'hide'`, defaulting to
  `fade`. Like `view` (ADR 0009) it changes nothing in the saved blob, so
  `SET_BOARD_LINE_FILTER` is not a `MUTATING_ACTION` and works on read-only
  mirrors and Viewer shares. Also like `view`, it is not persisted.
- **The map does not get the toggle.** Hiding stations on the map would break
  the routes, so the map keeps fading. The state is named `boardLineFilter`
  because it is exactly that.
- **A filter bar above the board** names the filtered line, reports `N of M
  stations`, carries the Fade/Hide segments and clears the filter. The map needs
  no such bar — a dimmed line is still visible, so the filter explains itself. A
  board in `hide` mode looks like a board that has lost stations unless it says
  why.
- **Faded means `.34`, not the map's `.12`.** A board is text; at `.12` it is
  unreadable rather than receded. Hovering lifts a faded row to `.8` so it stays
  usable, the ready-pulse is suppressed on faded stations (the pulse means "pick
  this up", which a filtered-out station should not be advertising), and nested
  `.dim` does not compound — a faded stop inside a faded Departures lane stays
  at one step of fade.

Considered and rejected:

- *Fade only, matching the map exactly.* Consistent, but it leaves every count
  on the boards describing the project while the reader is looking at one line —
  the one thing a board can fix and the map cannot.
- *Hide only.* Loses the context that makes fading worth having, and makes an
  interchange-heavy map jarring to filter: rows vanish from four groups at once.
- *A per-board default* (Queue hides, Departures fades). Two mental models to
  learn, and the mode is a reading preference, not a property of a board.
- *Persist the mode per map* (as ADR 0003 does for the label angle). Same
  reasoning as `view`: it is a momentary way of looking. Revisit if it proves
  annoying.

## Consequences

- The legend's line rows now drive four views instead of one, and mean the same
  thing in all of them: *this line, in the foreground*.
- In `hide` mode every count a board shows is a count *of the line*. That is the
  point, and it is also the trap: `0 ready to start` under a filter means the
  line has nothing ready, not the project. The filter bar is what keeps that
  readable, so it stays visible whenever a filter is on.
- Board's Ready column gets emptier under a filter, sharpening the density
  weakness ADR 0009 already flagged. The fix, if it is needed, is still that
  column's weighting.
- `waitingOn` is deliberately *not* filtered: a locked station on this line may
  be waiting on one that isn't, and hiding that would turn a filter into a lie.
- Adding a fourth board inherits the filter for free — it comes from
  `useBoardModel`, which every board already reads.
