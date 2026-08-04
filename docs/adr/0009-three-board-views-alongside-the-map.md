# Three board views alongside the map

## Status

accepted.

## Context

The topbar carried a **"Board view"** button that did nothing. The open question
was not whether to build a board but *which* board: the map is excellent at
showing structure — where a station sits, what it interchanges with, how the
lines braid — and poor at answering "what should I pick up right now". On the
map that answer is carried entirely by the `pulse-ready` halo on `available`
stations, which is easy to miss on a large map and impossible to rank.

Three candidate boards were prototyped on the real route, against the real
topbar, legend, detail panel and store, and evaluated by flipping between them:

- **Queue** — one ranked list, no columns.
- **Board** — status columns, deliberately unbalanced towards Ready.
- **Departures** — a station departure board over per-line swimlanes.

They did not collapse into one another under review. Each answers a genuinely
different question, and the prototype surfaced no version that answered all
three without being worse at each:

| View | Question it answers |
|---|---|
| Queue | "What do I pick up next?" |
| Board | "How is the whole map distributed right now?" |
| Departures | "What is open on each line, and where on the route does it sit?" |

Prototyping also showed the emphasis question has a better answer than styling.
Making `available` bigger or brighter only repeats what the pulse already says.
What actually ranks the work is the dependency graph the app already holds: how
many stations are waiting directly on this one, and how many sit transitively
downstream. That number is the reason to pick one available station over another.

## Decision

Ship **all three boards** as peer readings of the map, and rank open work by
downstream depth rather than by decoration alone.

- **`view` is client state, not map content.** `StoreState.view` is
  `'map' | 'queue' | 'board' | 'departures'`, mutated by `SET_VIEW`. Like
  `SET_THEME` it changes nothing in the saved blob, so it is *not* a
  `MUTATING_ACTION` and works on read-only mirrors and Viewer shares (ADR 0002's
  version-guarded autosave never fires for it). Unlike the label angle (ADR 0003)
  it is not persisted at all — a view is a momentary way of looking, not a
  preference worth restoring.
- **One segmented control, not four buttons.** The topbar already holds seven
  controls; four more would bury them, and loose buttons would imply four
  features rather than four renderings of one map. `ViewSwitcher` presents them
  as segments of a single control with Map first.
- **The graph facts live in `src/lib/board.ts`**, pure and unit-tested like the
  rest of `src/lib`: `buildBoardModel` groups stations by status and annotates
  each with `dependents` (direct), `downstream` (transitive, via the existing
  `collectSelfAndDescendants`) and `waitingOn` (prereqs not yet `done`). Every
  `available` group is ordered by downstream depth, so the top of any board is
  the station whose completion frees the most work. The React layer only renders.
- **The boards share the map's visual language, not its layout.** A `.st-dot`
  reuses the map's own `st-*` state classes and its `pulse-ready` / `ping`
  keyframes, so an `available` station pulses identically in every view. Beyond
  that marker and the line badge, each board owns its layout outright — that
  independence is the point, and any shared layout would erode it.
- **Boards mutate only through existing actions.** Selecting a card dispatches
  `OPEN_DETAIL`; Start and Mark complete dispatch `DO_ACTION`, so `recompute`
  cascades exactly as it does from the map and `readOnly` hides the controls.
  No board-specific mutation exists.

Considered and rejected:

- *Pick one board and delete the others.* The three were not variations on a
  theme; each lost something real. Keeping all three costs one segmented control
  and one shared model.
- *Emphasise ready work with styling alone* — bigger cards, stronger colour. It
  restates the pulse without ranking anything. Downstream depth is the emphasis;
  the styling only makes it findable.
- *Persist the chosen view per map* (as ADR 0003 does for label angle). A view is
  a momentary reading rather than a display preference, and always opening on the
  map keeps the product's identity the map.
- *A `?view=` URL parameter* for shareable/reload-stable views. The app has no
  router and no other URL state; introducing one for this alone is machinery
  without a second caller.

## Consequences

- The map stops being the only way to read a project. Someone who wants a work
  queue no longer has to scan for halos.
- `available` ordering is now a product decision with a single home: change
  `byDownstreamFirst` in `src/lib/board.ts` and every board re-ranks.
- Adding a fourth reading means a `ViewMode` member, a `VIEWS` entry and a
  component — the model and the marker are already shared.
- The boards inherit whatever `recompute` decides. They surface status; they
  never compute it.
- Three layouts is three layouts' worth of CSS in `global.css`, all of it under
  the board sections. The stylesheet stays plain CSS with cascading custom
  properties, so dark mode needs almost no board-specific overrides.
- Density is the known weak spot. On a map with only one or two `available`
  stations the Board view's double-width Ready column is mostly empty; Queue and
  Departures degrade more gracefully. If that proves annoying in practice the fix
  is Board's column weighting, not the decision to keep three views.
