# Auto-syncing the GitHub roadmap into a canonical, public-read map row

## Status

accepted

## Context

Maps generated from GitHub issues (`npm run generate-map` → `maps/roadmap.json`)
were a one-time, manual snapshot: the file was imported once into a per-account
`maps` row and then drifted from the tracker. Closing an issue, changing a
`blocked by`/sub-issue link, or editing a description left the map stale until a
human re-ran the generator and re-imported by hand. We want the roadmap to follow
the tracker automatically — most importantly issue close/reopen and dependency
changes, with descriptions as a nice-to-have.

Two facts shaped the design:

- The `maps` table is **owner-scoped** and the registry seeds each account its
  **own** copy, so there was no single row to call "the roadmap" — nothing to keep
  in sync.
- A deterministic generator already exists: `gh` I/O + the pure, unit-tested
  `githubToMapReport()` transform + `validateMapData()`. Re-implementing that
  fetch/transform inside a Supabase Edge Function (Deno) would duplicate the
  source of truth and let it drift.

## Decision

Introduce **one canonical, GitHub-synced, public-read row** in `maps`, kept in
sync by a **GitHub Action**, not an Edge Function.

- **Schema** (`0006_github_synced_maps.sql`): add `source jsonb`
  (`{type:'github',owner,repo,filter}`) to identify the row and what it mirrors;
  add `is_public boolean` with an additive `maps_select_public` RLS policy
  (`to authenticated using (is_public)`); relax `owner` to NULL-able. The synced
  row has **no owner** — it is written by the **service role** (which has no
  `auth.uid()`), so no client RLS policy ever matches it for write. **GitHub
  wins**: the map is read-only to every user.
- **Sync job**: `.github/workflows/sync-roadmap.yml` runs on `issues` activity
  (near-instant) and a nightly `schedule` (catches sub-issue / `blocked by`
  changes, which don't fire `issues` events). It runs `npm run sync-roadmap`,
  which reuses the exact fetch + transform + validation of `generate-map`, then
  upserts the canonical row by `source` via the service-role key
  (`src/data/roadmapSync.ts`).
- **Live refresh**: read-only stores subscribe to a Supabase Realtime
  `postgres_changes` UPDATE on their row and call the existing `reloadActiveMap`.
  Gated on `readOnly`, so it only affects viewers of the synced map (or a Viewer
  share) and never an Owner/Editor mid-edit.

## Consequences

- The roadmap tracks the tracker automatically; everyone sees the same read-only
  map, and open views refresh themselves within ~a minute of an issue change.
- The service-role key now lives in **CI only** (a GitHub Actions Secret). The
  browser SPA still ships only the publishable key; the secret never enters the
  bundle.
- This does **not** revisit [ADR 0002](0002-map-as-jsonb-blob-async-editing.md)'s
  async-editing model. Optimistic version guards still govern Owner/Editor saves;
  the new Realtime subscription is a narrow, read-only live-refresh for the synced
  row, not collaborative editing.
- `maps.owner` is now NULL-able. User maps still set it via the `auth.uid()`
  default; only system (synced) rows are owner-less. NULL never matches the owner
  policies, so the relaxation does not widen client write access.
- The committed `maps/roadmap.json` stays the human-reviewable artifact of
  `generate-map`; the Action targets Supabase. The two share their fetch +
  transform code, so they cannot diverge.
