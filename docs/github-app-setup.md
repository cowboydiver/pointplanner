# GitHub App setup — "Connect a repo" live mirror

PointPlanner can mirror a GitHub repo's **issues** as a **read-only map** that
stays continuously up to date for every viewer (owner and sharees alike). Issue
changes arrive by **webhook**, are transformed server-side by the same pure
`githubToMap` transform the `generate-map` script uses, written back to the map
row by a service-role Edge Function, and pushed to open browsers over **Supabase
Realtime**.

This document is the **human-only setup** (sibling to
[`supabase-setup.md`](./supabase-setup.md)): register a GitHub App, apply the
migrations, set the Edge Function secrets, deploy the functions, and add two
front-end env vars. None of this runs from the app at runtime.

## Architecture

```
GitHub repo issues ──webhook──▶ github-webhook (Edge fn)
                                  │ verify HMAC, find map_sources by repo_id
                                  │ installation token → fetch issues/milestones/sub-issues
                                  │ githubToMapReport(input)   ← reused pure transform
                                  ▼
                            maps.data (service-role write, version++)
                                  │ Postgres → supabase_realtime publication
                                  ▼
                    all open viewers (owner + sharees) update live
```

The browser never sees a GitHub token. Everything that touches GitHub runs in an
Edge Function with the service role.

## 1. Apply the migrations

Apply, in order (Supabase SQL editor or `supabase db push`):

| Migration | Adds |
|---|---|
| `0006_map_sources.sql` | `maps.is_mirror` flag + `map_sources` table (origin + sync status), owner-only `select`, service-role-only writes |
| `0007_maps_realtime.sql` | `maps` added to the `supabase_realtime` publication (RLS-honored) |
| `0008_mirror_readonly_guard.sql` | trigger rejecting client edits to a mirror's `data`/`version` |
| `0009_github_tokens.sql` | `github_tokens` table (per-user OAuth token), RLS-enabled with **no** policies (service-role only) |

> **Apply 0006 before deploying the client code** that selects `maps.is_mirror`,
> or those queries will error.

After applying, run the Supabase **security advisor** and confirm no new
warnings (the new tables are RLS-enabled; `github_tokens` is service-role only).

## 2. Register the GitHub App

Create one GitHub App for the deployment (Settings → Developer settings → GitHub
Apps → New). It is read-only.

- **Permissions** (Repository): **Issues → Read-only**, **Metadata → Read-only**.
- **Subscribe to events**: **Issues**, **Milestone**, and **Sub-issue** (where
  available).
- **Webhook**
  - **Active**: on.
  - **URL**: the `github-webhook` function URL,
    `https://<PROJECT_REF>.supabase.co/functions/v1/github-webhook`.
  - **Secret**: generate a strong random string — this is `GITHUB_WEBHOOK_SECRET`.
- **Callback URL** (user authorization): the `github-oauth-callback` function URL,
  `https://<PROJECT_REF>.supabase.co/functions/v1/github-oauth-callback`.
- **Request user authorization (OAuth) during installation**: optional; the app
  also triggers the authorize redirect on demand.
- After creating: note the **App ID** and **Client ID**, generate a **Client
  secret**, and generate a **private key** (downloads a `.pem`).

Install the App on the account/repos you want to be mirror-able. Private repos
are supported — the installation token reads them.

### Convert the private key to PKCS#8

GitHub issues a **PKCS#1** key (`-----BEGIN RSA PRIVATE KEY-----`). Web Crypto in
the Edge runtime needs **PKCS#8** (`-----BEGIN PRIVATE KEY-----`). Convert once:

```bash
openssl pkcs8 -topk8 -nocrypt -in app-key.pem -out app-key.pkcs8.pem
```

Use the PKCS#8 contents as `GITHUB_APP_PRIVATE_KEY`.

## 3. Set the Edge Function secrets

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically. Set the
rest with `supabase secrets set`:

```bash
supabase secrets set \
  GITHUB_APP_ID=123456 \
  GITHUB_CLIENT_ID=Iv1.xxxxxxxx \
  GITHUB_CLIENT_SECRET=xxxxxxxx \
  GITHUB_WEBHOOK_SECRET=<the webhook secret from step 2> \
  APP_URL=https://cowboydiver.github.io/pointplanner/ \
  GITHUB_APP_PRIVATE_KEY="$(cat app-key.pkcs8.pem)"
```

- `APP_URL` is where `github-oauth-callback` redirects the browser back to after
  authorization.

## 4. Deploy the Edge Functions

The functions live in `supabase/functions/`. The sync function reuses the pure
transform from `src/lib/`. The Supabase deploy bundler does **not** honor Deno's
`sloppy-imports`, so those `src/lib` modules use explicit `.ts` import extensions
(allowed by the app's `allowImportingTsExtensions` tsconfig, so Vite + `tsc` build
the SPA unchanged). Deploy from the repo root so the bundler can reach `src/lib/`.

```bash
supabase functions deploy github-webhook       --no-verify-jwt   # GitHub calls it; auth is the HMAC
supabase functions deploy github-oauth-callback --no-verify-jwt   # browser redirect from GitHub
supabase functions deploy connect-repo                            # JWT-authenticated (default)
supabase functions deploy github-repos                            # JWT-authenticated (default)
```

| Function | Auth | Purpose |
|---|---|---|
| `github-webhook` | HMAC signature | On issues/milestone/sub-issue events, re-sync every mirror tracking that repo. |
| `connect-repo` | Supabase JWT | Create a mirror map from a repo the caller can access + run the first sync. |
| `github-repos` | Supabase JWT | List the caller's connectable repos (or `connected:false` to trigger authorize). |
| `github-oauth-callback` | `state` token | Exchange the OAuth code for a user token and store it. |

## 5. Front-end env vars

Add to `.env.local` (and the Pages build config) alongside the `VITE_SUPABASE_*`
values:

```bash
VITE_GITHUB_CLIENT_ID=Iv1.xxxxxxxx
VITE_GITHUB_CALLBACK_URL=https://<PROJECT_REF>.supabase.co/functions/v1/github-oauth-callback
```

These are public (the client id is not secret; the callback URL is just a route).
Without them the "Connect a repo" modal reports that GitHub isn't configured.

## 6. Verify end-to-end

1. **Connect**: in the app, MapSwitcher → **↗ Connect a repo…** → authorize the
   App (first time) → pick a repo → **Connect**. The new map appears, badged
   **Repo**, read-only, with a "Mirrored from owner/repo · synced …" strip.
2. **Live update**: open the same map in two sessions (the owner and an emailed
   **sharee**). Edit an issue on GitHub. Both maps update with no refresh, and
   neither can edit (no "+ Add task", read-only detail panel).
3. **Guard**: confirm a client `update` to a mirror's `data` is rejected by the
   `0008` trigger (only the service role can write it).

## Notes & follow-ups

- The OAuth `state` carries the caller's Supabase access token so the callback
  can bind the GitHub token to the right user. It travels over HTTPS and is
  short-lived; a future hardening could sign an opaque nonce instead.
- There is no manual "Sync now" button yet — webhooks keep mirrors live. Adding
  one is a small follow-up (a service-role `resync` endpoint calling `syncMap`).
- The Edge Functions' pure helpers (HMAC verification, event parsing, the
  REST→`GithubToMapInput` mapping) are unit-tested by the repo's vitest suite
  under `supabase/functions/_shared/*.test.ts`; the rest is Deno-only and runs in
  the Edge runtime.
