# Map-clutter prototype — NOTES

**Question:** What's the best way to de-clutter dense maps, specifically
problems **#1** (lines drawing on top of each other) and **#2** (lines crossing
over unrelated stations)?

**Approach:** Four render-time treatments of the *same* production layout (no
position changes, so the comparison is honest), over a real dense map — the
`cowboydiver/homesweathome` mirror (35 stations / 50 edges / 6 lines).

| Variant | Strategy | Targets |
|---|---|---|
| A | Baseline — exactly what ships today | — |
| B | Bundling (perpendicular offset of coincident corridors) + white casing | #1 |
| C | Obstacle-aware routing — segments detour around unrelated stations + casing | #2 |
| D | Combined (B + C) | #1 + #2 |

## How to run

- **Live, interactive:** `npm run dev`, then open `…/?proto=map-clutter`.
  Switch variants with the floating bottom bar or `←/→`, or `?variant=A|B|C|D`.
- **Static, no server:** open the generated `clutter.html` (scratchpad) — all
  four panels stacked.

## Files (delete together when a direction is chosen)

- `MapClutterPrototype.tsx` — the variants + switcher
- `homesweathome.fixture.ts` — the snapshot map data
- `src/main.tsx` — `?proto=map-clutter` escape hatch (revert this line)
- scratchpad `gen-clutter.mjs` — static HTML generator

## Verdict

_TBD — awaiting which variant (or mix) wins. The interesting answer is usually
"B's bundling + C's detours, but tuned." Capture the decision here, then fold
the winner into `Segment.tsx`/`routing.ts` and delete the rest._
