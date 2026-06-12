# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Vite dev server (hot reload)
npm run build     # tsc -b && vite build (type-check + bundle)
npm run test      # Vitest unit tests (run once)
npm run lint      # ESLint
npx vitest run src/lib/routing.test.ts   # run a single test file
npx vitest --reporter=verbose            # verbose test output
```

## Architecture

**PointPlanner** renders a project as a subway transit map: tasks are *stations* on a column/row grid; dependencies are colored *lines* drawn with 45° routing and rounded corners.

### Data flow

```
seed data (src/data/seed.ts)
  └─► ProjectStoreProvider (Context + useReducer)
        ├─ buildIndexes (useMemo) → stationById / lineById / prereqs / dependents
        ├─ recompute (on every DO_ACTION / CREATE_TASK) → cascades locked ↔ available
        ├─ saveState (useEffect) → localStorage key "pointplanner.v1"
        └─ data-theme on <body> (useEffect) → drives CSS dark-mode overrides
```

### Pure logic (`src/lib/`) — all unit-tested, no React

| File | What it does |
|---|---|
| `indexes.ts` | `buildIndexes` → lookup maps + prereqs/dependents graphs |
| `dependencies.ts` | `recompute` — cascades `locked`↔`available` based on which prereqs are `done` |
| `routing.ts` | `routePoints` (45° waypoints, `df` flag = diagonal-first), `pointsToPath` (rounded-corner SVG path), grid helpers `px`/`py` |
| `bounds.ts` | `computeBounds` → SVG viewBox accounting for label padding |
| `placement.ts` | `slugify`, `placeNewStation` — auto-places a new task to the right of its prereqs |

Grid constants (do not change without updating tests): `PAD_X=96, COL=152, PAD_Y=92, ROW=94, CORNER_RADIUS=18`.

### Store actions

`DO_ACTION(id, 'start'|'done'|'reopen')` mutates a single station's status then runs `recompute` over the whole graph. `CREATE_TASK` calls `placeNewStation`, builds new edges with `df=true` if the prereq is on a different row, pushes the station, then recomputes.

### Styling

`src/styles/global.css` is a verbatim port of the prototype stylesheet — **do not convert to CSS Modules**. The design relies on cascading CSS custom properties (`--c`, `--lc`, `--pc`) set inline on SVG elements and class-based state (`st-done`, `st-active`, `on-<lineId>`, `interchange`, `dim`). Dark mode is driven entirely by `data-theme="dark"` on `<body>`.

### Design reference

`design/project/` contains the original Claude Design handoff (PointPlanner.html, app.js, data.js, screenshots). It is the source of truth for visual behavior. The `tweaks.jsx` / `tweaks-panel.jsx` files in that directory are Claude Design's own editing harness — they are excluded from the product.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `cowboydiver/pointplanner`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo — one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
