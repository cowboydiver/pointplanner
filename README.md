# PointPlanner

A project planner that renders work as a **transit map**. Tasks are *stations* placed on a grid; dependencies are colored *lines* drawn in 45° subway style. A task automatically unlocks once all of its prerequisites are complete, so the map doubles as a live readiness view of the whole project.

Built with **Vite + React + TypeScript**. State persists to `localStorage`.

![PointPlanner](design/project/screenshots/detail-open.png)

## Features

- **Transit map** — SVG routes with rounded corners and white casing at crossings; stations show four states (locked / available / active / done) with animated halos for active and ready tasks.
- **Interchanges** — a task on more than one line is drawn larger with a dark ring.
- **Legend** — overall progress, per-line stop/done counts with mini progress bars, and click-to-highlight a single line.
- **Detail panel** — slide-in panel with status, owner, due date, estimate, "Depends on" / "Unblocks next" lists, and Start / Complete / Reopen actions that cascade through the dependency graph.
- **Create tasks** — add a station, pick its line and prerequisites; it auto-places to the right of its prerequisites with edges drawn automatically.
- **Dark theme** toggle.

## Getting started

```bash
npm install
npm run dev      # start the dev server
```

## Configuration / Supabase

PointPlanner uses [Supabase](https://supabase.com) for authentication (magic-link / OTP email sign-in).

1. Create a free Supabase project at <https://supabase.com>.
2. In your project, go to **Project Settings → API** and copy the **Project URL** and **anon public** key.
3. Create a `.env.local` file in the repo root (this file is git-ignored — never commit it):

```
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

See `.env.example` for a template.

If these variables are not set, the app shows a configuration notice on the sign-in screen and authentication is disabled.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Preview the production build |
| `npm run test` | Run unit tests (Vitest) |
| `npm run lint` | Run ESLint |

## Architecture

```
src/
  types.ts            Domain types (Line, Station, Edge, Project)
  data/seed.ts        Sample "Q3 Product Launch" project
  lib/                Framework-agnostic pure logic (unit-tested)
    indexes.ts          buildIndexes → stationById / lineById / prereqs / dependents
    dependencies.ts     recompute → cascades locked ↔ available from prereq state
    routing.ts          45° edge routing + rounded-corner SVG paths + grid helpers
    bounds.ts           computeBounds → SVG viewBox
    placement.ts        slugify / auto-placement for newly created tasks
  store/projectStore.tsx   Context + useReducer; localStorage persistence
  components/         Topbar, Legend, TransitMap, Segment, StationNode,
                      DetailPanel, CreateModal
  styles/global.css   Global stylesheet (CSS custom properties + dark theme)
```

The dependency engine and geometry live in `src/lib/` as pure functions so they can be unit-tested in isolation; everything visual is a thin React layer over that logic.

## Design reference

`design/` contains the original Claude Design handoff bundle (HTML/CSS/JS prototype and screenshots) that this implementation is based on.
