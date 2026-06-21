# Handoff: Connect a GitHub repo as a live read-only mirror map

> Self-contained handoff for a fresh session. Status: **planning complete, no code
> written yet.** Resume at implementation (or re-confirm the plan first). The full
> implementation plan is inlined at the bottom of this document.

## What this is
Feature request: add a **"Connect a repo"** action to the MapSwitcher (alongside
"New map") that creates a map which is a **read-only mirror of a GitHub repo's
issues** — read-only for owner and sharees alike — kept **continuously up to date
for all viewers** as issues change.

## Confirmed decisions (from user)
- **Sync trigger:** GitHub **webhook** (near-instant) — not polling.
- **Repo scope:** **private repos** must work (not just public).
- **Live update to open viewers:** **Supabase Realtime** push.

These drove the recommended foundation: a **single GitHub App** (webhooks +
installation tokens for private reads + user tokens to list a connecting user's
repos). This was an *inference*, not an explicit user choice — worth a quick
confirmation before heavy backend build.

## Codebase facts already established (skip re-exploration)
- App is a **static SPA** (GitHub Pages: `cowboydiver.github.io/pointplanner`) with
  **Supabase as the only backend**. **No Edge Functions and no Realtime exist yet**
  (`supabase/functions/` does not exist; migrations stop at `0005`).
- **Reuse verbatim:** pure transform `githubToMapReport(input)` / `githubToMap(input)`
  in `src/lib/githubToMap.ts` (I/O-free, tested in `src/lib/githubToMap.test.ts`).
  Input `GithubToMapInput = { issues, milestones, repo?, relationships? }` → output
  `MapData`. Depends only on pure modules (`indexes`, `dependencies`, `layout`,
  `placeholders`, `maps`, `types`) — Deno-importable.
- **Not reusable:** the `gh`-CLI fetch layer in `scripts/generate-map.ts`
  (`fetchIssues`, `fetchMilestones`, `fetchRelationships` GraphQL query) — must be
  reimplemented as `fetch()` + GitHub REST/GraphQL with tokens in an Edge Function.
- **Read-only is already first-class:** `src/store/projectStore.tsx` sets
  `readOnly = role === 'viewer'`, drops `MUTATING_ACTIONS` in a dispatch wrapper, and
  skips autosave. Plan extends this to `readOnly = role === 'viewer' || isMirror`.
- **Map data layer:** `src/data/mapsRepo.ts` — single `maps` table (`data` jsonb +
  `version` optimistic-concurrency guard); roles resolved here; shares in `map_shares`.
  New maps added via `addOwnedMap` in `src/store/mapRegistry.tsx`.
- **Switcher entry point:** `src/components/MapSwitcher.tsx` footer has `+ New map` /
  `↥ Import map…` (~lines 190-205) — third button slots in there.
- **Existing RLS** already lets owners + sharees `select` maps, so Realtime (which
  honors RLS) reaches both audiences without a new read policy.

## Environment / tooling notes
- Supabase MCP tools available: `list_tables`, `apply_migration`, `deploy_edge_function`,
  `get_advisors`, etc. Run `list_tables` before schema changes; `get_advisors` (security)
  after migrations.
- GitHub MCP tools (`mcp__github__*`) available; scope `cowboydiver/pointplanner`.
- Dev branch for this work: **`claude/map-repo-issues-sync-lbmxla`** (never push elsewhere).
  Commit/push only when the user asks.
- Verify with: `npm run test`, `npm run build`, `npm run lint`.
- Human-only setup (like migrations): registering the GitHub App, setting Edge Function
  secrets, GitHub authorize callback URL — to be documented in a new
  `docs/github-app-setup.md`.

## Open questions to resolve early
1. Confirm the **GitHub App** foundation (vs. per-user OAuth PAT) — plan recommends App.
2. Where the GitHub authorize **callback** lands for a static-site SPA (Edge Function
   callback that redirects back to the SPA route).
3. Ship in the plan's **4-slice build order** or all at once.

## Suggested skills
- **`to-issues`** — split this backend-heavy plan into independently-grabbable GitHub
  issues (repo tracks work in GitHub Issues; see `docs/agents/issue-tracker.md`).
- **`tdd`** — for the pure Edge Function helpers (HMAC verify, event→repo_id parsing,
  `fetch`→`GithubToMapInput` mapping) and the `mapsRepo`/store changes.
- **`review`** / **`code-review`** — before pushing the branch.

## Constraints reminder
- Do NOT open a PR unless the user explicitly asks.
- `src/styles/global.css` must not be converted to CSS Modules.
- Keep `src/lib/` pure; I/O-bearing Supabase code lives in `src/data/`.

---

# Implementation plan (inlined)

## Context

Today PointPlanner maps are hand-edited and cloud-stored in one Supabase `maps`
table; a separate `npm run generate-map` script can turn a repo's issues into a
map JSON, but only as a one-time local export run by a developer with the `gh`
CLI. There is no way to do this from the web app, and a generated map is a dead
snapshot.

We want a first-class **"Connect a repo"** action in the MapSwitcher, alongside
"New map", that creates a map which is a **read-only mirror of a GitHub repo's
issues** — read-only for everyone, owner and sharees alike — and that stays
**continuously up to date for all viewers** as issues change.

## Architecture overview

```
GitHub repo issues ──webhook──▶ Edge fn: github-webhook
                                   │ verify HMAC, find map_sources by repo_id
                                   │ fetch issues/milestones/links (installation token)
                                   │ githubToMapReport(input)  ← reuse pure transform
                                   ▼
                              maps.data (service-role write, version++)
                                   │ Postgres → supabase_realtime publication
                                   ▼
                     all open viewers (owner + sharees) update live
```

Reused as-is: the pure, tested transform `githubToMapReport(input)` /
`githubToMap(input)` in `src/lib/githubToMap.ts` (I/O-free). Only the `gh`-CLI
fetch layer in `scripts/generate-map.ts` is *not* reusable and gets reimplemented
as `fetch()`-based GitHub REST/GraphQL calls in an Edge Function shared module.

## Foundation: one GitHub App (human setup)

Register a single GitHub App for the deployment (read-only): permissions
**Issues: read**, **Metadata: read**; subscribe to webhook events **issues**,
**milestone**, and **sub_issue** (where available). The App provides three things
we need:
- **Webhook delivery** to our Edge Function (with a webhook secret for HMAC).
- **Installation access tokens** → read **private** repo issues via REST/GraphQL.
- **User-to-server tokens** → list the installations/repos a connecting user can
  access (`GET /user/installations`, `.../repositories`), so the connect modal
  only offers repos they truly have.

Secrets stored via `supabase secrets set` (App id, private key PEM, client
id/secret, webhook secret) — never shipped to the browser. Document the whole
setup in a new `docs/github-app-setup.md` (sibling to `docs/supabase-setup.md`),
and reference it from `CLAUDE.md`'s data-access section.

## Data model (new migrations in `supabase/migrations/`)

**`0006_map_sources.sql`** — marks a map as a mirror and records its origin:
- `map_id uuid PK references maps(id) on delete cascade`
- `owner uuid` (the connecting user), `provider text default 'github'`
- `repo_owner text`, `repo_name text`, `repo_id bigint` (stable across renames),
  `installation_id bigint`, `filter text null` (label/milestone scope)
- `last_synced_at timestamptz`, `last_sync_status text`, `last_sync_error text`
- index on `repo_id` (webhook lookup).
- RLS: owner-only `select` (so the client can show sync status); **no client
  insert/update/delete** — only the service role (Edge Functions) writes here.
- Also add `is_mirror boolean not null default false` to `maps` (set true by the
  connect flow) so `loadMap`/`listMaps` can flag read-only without a join.

**`0007_maps_realtime.sql`** — `alter publication supabase_realtime add table maps;`
Existing RLS already lets owners and sharees `select` their maps, and Realtime
honors RLS, so both audiences receive row updates; no new read policy needed.

**`0008_mirror_readonly_guard.sql`** — defense-in-depth trigger: reject client
`UPDATE`s to `data`/`version` on a row where `is_mirror` is true (service-role
writes bypass this). Owner may still rename/delete/share the container.

## Edge Functions (`supabase/functions/`, Deno)

A `_shared/` module holds the GitHub fetch layer + helpers, importing the pure
transform from `../../../src/lib/githubToMap.ts` (configure `deno.json` / import
map so the function bundler resolves `src/lib/*`; these files are pure TS with no
node-only APIs, verified: `githubToMap.ts` only pulls `indexes`, `dependencies`,
`layout`, `placeholders`, `maps`, `types`).

- `_shared/github.ts` — installation-token mint (App JWT → installation token);
  `fetchRepoInput(token, owner, repo, filter)` returning the existing
  `GithubToMapInput` shape (issues, milestones, repo, relationships). The GraphQL
  sub-issue/blocked-by query is lifted from `scripts/generate-map.ts`
  (`fetchRelationships`), `gh api graphql` → `fetch()`. Body-text fallback already
  lives in the transform.
- `_shared/sync.ts` — `syncMap(mapId)`: fetch → `githubToMapReport` →
  service-role `update maps set data, version=version+1, is_mirror=true` and write
  `last_synced_at/status` on `map_sources`. Shared by webhook + initial connect.
- `github-webhook` — verify `X-Hub-Signature-256` HMAC against the webhook secret;
  on `issues`/`milestone`/`sub_issue` events, look up `map_sources` by `repo_id`
  and call `syncMap` for each. (Factor signature verification + event→repo_id
  parsing into pure helpers so they're unit-testable.)
- `connect-repo` — authenticated (Supabase JWT). Verifies the caller can access
  the chosen repo via their user token + installation; runs the initial
  `syncMap` into a freshly created map row; inserts the `map_sources` row. Returns
  the new map meta.
- `github-repos` — authenticated; lists the caller's App installations + accessible
  repos to populate the connect modal. (Requires the user-to-server token; the
  modal kicks off the GitHub App authorize redirect when no token exists yet.)

## Client changes

**`src/data/mapsRepo.ts`**
- Surface mirror state: add `is_mirror` to the `select` in `loadMap`/`listMaps`
  and add `isMirror: boolean` to `MapRecord` and `MapListItem`.
- Add `connectRepo(params)` and `syncNow(mapId)` that invoke the Edge Functions
  via `supabase.functions.invoke(...)`, plus `listConnectableRepos()`.
- Add `getMapSource(mapId)` to read sync status for the banner.

**`src/store/mapRegistry.tsx`**
- Add `connectRepo(...)` mirroring `addOwnedMap`: call `repo.connectRepo`, then
  insert the returned mirror item (`role:'owner', isMirror:true`) and make active.
- Expose it through `MapRegistryContextValue`.

**`src/store/projectStore.tsx`**
- Thread `isMirror` through `loaded` and `LoadedStore`; set
  `readOnly = role === 'viewer' || isMirror`. This automatically reuses the
  existing `MUTATING_ACTIONS` drop + autosave skip — no new gating logic.
- Add a `SET_DATA` reducer action (in `reducer.ts`) and a Realtime subscription
  effect: subscribe to `maps` row `UPDATE` for `mapId`; on event, dispatch
  `SET_DATA` with the new `data` so open viewers update **in place** (smoother
  than the remount used by the stale-write reload). Unsubscribe on unmount.
- Replace the stale banner for mirrors with an info strip:
  "Mirrored from owner/repo · synced 2m ago" (from `getMapSource`).

**`src/components/MapSwitcher.tsx`**
- Add a third footer button `↗ Connect a repo…` next to `+ New map` /
  `↥ Import map…`, opening a new `ConnectRepoModal`.
- In the map list, show a small badge (e.g. "Repo") on `isMirror` items; keep
  owner rename/duplicate/delete actions (container ops are still allowed).

**`src/components/ConnectRepoModal.tsx`** (new, follow `ShareModal.tsx`/`CreateModal.tsx`
patterns) — GitHub auth redirect if needed → pick installation/repo from
`listConnectableRepos()` → optional `filter` input (label/milestone, reuses the
generator's `--filter` semantics) → Connect.

**Read-only UI** already keys off `readOnly` in `Topbar.tsx` (hides "+ Add task",
shows a viewer pill) and `DetailPanel.tsx` (read-only note) — mirrors inherit
this for free; just tweak the pill copy for mirrors.

## Tests

- `src/data/mapsRepo.test.ts` — extend for `isMirror` surfacing and the new
  invoke wrappers (mock the supabase client, as existing tests do).
- `src/store/projectStore` — `readOnly` true when `isMirror`, even for `owner`.
- Edge functions — unit-test the **pure** helpers: HMAC signature verification,
  webhook event→`repo_id` parsing, and `fetchRepoInput`'s response→`GithubToMapInput`
  mapping (mocked `fetch`). The transform itself stays covered by
  `src/lib/githubToMap.test.ts`.
- No changes needed to the transform or its tests.

## Verification

1. `npm run test` (unit), `npm run build` (tsc + bundle), `npm run lint`.
2. Edge functions locally: `supabase functions serve`; POST a **signed** sample
   `issues` webhook payload and confirm the target `maps.data` row updates and
   `version` bumps.
3. Apply migrations to a Supabase branch (via Supabase MCP `apply_migration` or
   `supabase db push`); confirm `maps` is in `supabase_realtime` and the mirror
   guard rejects a client `data` update.
4. End-to-end manual: register/install the GitHub App on a **private** test repo,
   "Connect a repo" from the UI, then edit an issue on GitHub and watch the map
   update live in two sessions — the owner and an emailed **sharee** — with no
   refresh, and confirm neither can edit (no "+ Add task", read-only detail).

## Scope / sequencing note

This is a backend-heavy feature. Suggested build order so value lands
incrementally and each slice is testable:
1. Migrations + `is_mirror` surfaced in `mapsRepo` + read-only wiring in the store
   (mirror behavior provable with a manually-inserted row).
2. `_shared` transform reuse + `syncMap` + `connect-repo` (initial snapshot works).
3. `github-webhook` + Realtime subscription (it goes live).
4. `github-repos` + `ConnectRepoModal` polish + GitHub App authorize flow.

Human-only setup (like existing migrations and Supabase config): registering the
GitHub App, setting Edge Function secrets, enabling the GitHub authorize callback
URL — captured in `docs/github-app-setup.md`.
