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

The same graph can be read four ways, chosen by `state.view` and the topbar's `ViewSwitcher` — `map` (the transit map) plus three boards in `src/components/board/`: **Queue** (ranked list), **Board** (weighted status columns) and **Departures** (departure rail over line swimlanes). The boards render only; every fact they show comes from `src/lib/board.ts` and every mutation goes through the existing `OPEN_DETAIL` / `DO_ACTION`. See ADR 0009.

Selecting a line in the legend (`state.highlightLine`) filters all four views. The map fades what the line does not serve; the boards do too by default, or hide it outright — `state.boardLineFilter`, toggled from the boards' filter bar. See ADR 0010.

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
| `bundling.ts` | `offsetCollinearLegs` — render-time nudging of residual collinear cross-line runs into parallel lanes (trunk-fixed — ADR 0007) |
| `clearance.ts` | `clearPassedStations` — render-time stepping of an edge around any marker its line does not serve, so a line never reads as a false stop (ADR 0008). Runs after bundling |
| `bounds.ts` | `computeBounds` → SVG viewBox accounting for label padding |
| `board.ts` | `buildBoardModel` — groups stations by status and annotates each with `dependents` / `downstream` / `waitingOn`; ranks `available` work by downstream depth. Backs all three board views (ADR 0009). `applyLineFilter` then narrows the model to the legend's selected line, either fading the rest (`dim`) or dropping them and re-counting around the survivors (ADR 0010) |
| `layout.ts` | `layoutStations` (deterministic topological columns + root-column pull + iterated barycentre crossing-reduction + strand packing + compaction — ADR 0006) and `relayoutStations` — re-derives every station's position from the graph. Used by generated maps and by every interactive structural edit / Auto-arrange (ADR 0005) |
| `placement.ts` | `slugify` — generates a unique station id from a task name |

Grid constants (do not change without updating tests): `PAD_X=96, COL=152, PAD_Y=92, ROW=94, CORNER_RADIUS=18, LANE_PITCH=16`.

Everything in `src/lib/` is pure (no React, no I/O) — including `localImport.ts`, the `localStorage` detection helpers for the one-time #17 import (they take a `Storage` double). The one exception that previously lived here, the cloud **data-access layer**, now lives in `src/data/` (see below).

### Data-access layer (`src/data/`)

I/O-bearing modules that talk to Supabase live here, kept separate from the pure `src/lib/` logic. The React layer and tests go through these typed module surfaces rather than touching the Supabase client directly; their unit tests mock the client.

| File | What it does |
|---|---|
| `seed.ts` | The sample "Q3 Product Launch" project used to seed a new account's demo map |
| `supabase.ts` | The single `supabase-js` client (reads `VITE_SUPABASE_*` env) + `isSupabaseConfigured()` |
| `mapsRepo.ts` | Cloud data-access layer over Supabase (maps + shares CRUD, role resolution, version-guarded saves; mirror surfacing + connect-a-repo Edge Function wrappers) |

SQL migrations live in `supabase/migrations/` (applied by a human, not the app). Provisioning, API keys (the **publishable** key — not the legacy `anon` key), RLS, and auth config are documented in `docs/supabase-setup.md`.

### GitHub-mirror maps & Edge Functions (`supabase/functions/`)

A map can be a **read-only mirror** of a GitHub repo's issues (`maps.is_mirror`, migration `0006`), kept live for all viewers. The store sets `readOnly = role === 'viewer' || isMirror` (`resolveReadOnly` in `reducer.ts`), subscribes read-only maps to Supabase **Realtime** and applies pushed updates via the `SET_DATA` action, and shows a `MirrorBanner`. Mirror edits are blocked client-side (no autosave) and server-side (the `0008` trigger).

The sync backend is **Deno Edge Functions** (excluded from `tsc`/ESLint; the pure helpers are vitest-tested under `_shared/*.test.ts`). They reuse the pure `githubToMap` transform from `src/lib/` and a single **GitHub App** for webhooks + private reads + repo listing. Setup (App registration, secrets, migrations `0006`–`0009`, deploy, `VITE_GITHUB_*` env) is documented in `docs/github-app-setup.md`.

### Store actions

`DO_ACTION(id, 'start'|'done'|'reopen')` mutates a single station's status then runs `recompute` over the whole graph. `SET_VIEW` switches between the map and the three boards; like `SET_THEME` it is view-only, so it is not a `MUTATING_ACTION` and works on read-only mirrors. Structural edits (`CREATE_TASK`, `DELETE_TASK`, and `UPDATE_TASK` when prereqs or lines change) build the new edge set, re-derive every position with `relayoutStations`, then recompute; routing `df` is derived at render time. `AUTO_ARRANGE` re-derives positions on demand (ADR 0005).

### Styling

`src/styles/global.css` is a verbatim port of the prototype stylesheet, plus the view-switcher and board sections appended at the end — **do not convert to CSS Modules**. The design relies on cascading CSS custom properties (`--c`, `--lc`, `--pc`) set inline on SVG elements and class-based state (`st-done`, `st-active`, `on-<lineId>`, `interchange`, `dim`). Dark mode is driven entirely by `data-theme="dark"` on `<body>`.

### Design reference

`design/project/` contains the original Claude Design handoff (PointPlanner.html, app.js, data.js, screenshots). It is the source of truth for visual behavior. The `tweaks.jsx` / `tweaks-panel.jsx` files in that directory are Claude Design's own editing harness — they are excluded from the product.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `cowboydiver/pointplanner`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo — one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Roadmap map

Generate a PointPlanner map from this repo's GitHub issues (`npm run generate-map`, optionally `--filter`). The `/roadmap-map` skill drives fetch → generate → review → commit. See `docs/agents/roadmap-map.md`.
