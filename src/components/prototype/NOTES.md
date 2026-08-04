# Board View — UI prototype

**Throwaway.** Delete this whole directory plus the marked lines in `App.tsx`
and `Topbar.tsx` once a variant has won.

## The question

> The topbar's "Board view" button is a stub. What should the Board View
> actually look like — and how should it emphasise the **open and ready** issues
> (the ones that pulse on the map)?

## The shape

Three structurally different variants on the **existing app route**, mounted in
place of `<TransitMap />` inside the real shell — the topbar, the legend and the
detail panel all stay, so each variant is judged against real chrome, real
density and real data rather than in a vacuum.

```
npm run dev
http://localhost:5173/?view=board&variant=A     # or B, C
```

Or just click **▤ Board view** in the topbar. The floating bottom bar (dev-only)
cycles variants; `←` / `→` work too. Both `?view=` and `?variant=` are
reload-stable and shareable.

## The variants

| Key | Name | The bet |
|---|---|---|
| **A** | Ready queue | A board's only job is "what do I pick up next". No columns at all — one vertical priority stack where ready work gets full-width hero cards ordered by leverage, and everything else collapses into dense one-line rows. |
| **B** | Weighted columns | Keep the kanban shape people already know, but unbalance it: Ready is a double-width column with full cards and the pulse; Blocked and Done are squeezed into narrow muted rails. Column *width* carries the emphasis. |
| **C** | Departures + swimlanes | Stay in the transit metaphor. A dark station departure board lists every ready task across every line; underneath, one swimlane per line shows the whole route so you can see *where* the open work sits. |

All three share exactly two pieces of markup (`bits.tsx`): the station marker
lifted from the map — including `pulse-ready` / `ping` — and the line roundel.
Layout is entirely per-variant.

## What it's wired to

- Reads the real store (`useStore`) — real stations, lines, statuses, prereqs.
- Clicking a card dispatches `OPEN_DETAIL`, so the existing detail panel opens.
- Start / Mark complete dispatch the existing `DO_ACTION`, so the real
  `recompute` cascade runs and blocked tasks visibly become ready. No new
  mutations were invented; `readOnly` hides every action button.
- Derived facts live in `boardData.ts`: `unblocks` (direct dependents),
  `downstream` (transitive), `waitingOn` (unfinished prereqs). Ready work is
  sorted by leverage — most downstream first.

## Observations from building it

Findings, not verdicts — the point of flipping through is to disagree with them.

- **The demo map only ever has 1–3 ready tasks.** That is the real shape of this
  data, and it is brutal on B: the double-width hero column is mostly empty
  whitespace, so the emphasis reads as "we ran out of cards" rather than
  "this is the important column". A and C degrade gracefully at that density.
- **`unblocks N` / `N downstream` may be the actual answer to the question.**
  Emphasis via size/colour only says "this is ready"; the leverage number says
  *which* ready thing to pick. It was the most useful thing on screen in all
  three, and it costs nothing that the graph doesn't already know.
- **C is the only one that still looks like PointPlanner.** A and B could be any
  tracker. C's departures rail also happens to be the densest expression of
  "ready" — one line per task, no card chrome.
- **C's swimlanes get sparse fast.** A ready card is ~190px wide against ~110px
  ticks, so lanes with one ready stop have a lot of air. Worth testing against a
  bigger map (`maps/roadmap.json`) before believing the layout.
- **The departure rail inverts in dark mode** (it is `--ink` on `--paper`, so it
  becomes a cream panel on a dark page). It stays the highest-contrast element
  either way, but if the "departure board" character matters it should be
  pinned dark in both themes.
- `active` ("In progress") needed somewhere to live in all three. A gives it a
  band, B a column, C puts it on the rail below the ready departures. C's
  reading — ready = *departing*, active = *running* — was the least awkward.

## Verdict

<!-- Fill in once you've flipped through, then delete the losers. -->

- **Winner:** _TBD_
- **Why:**
- **Bits to steal from the others:**
