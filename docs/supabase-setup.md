# Supabase setup

PointPlanner uses **Supabase** (hosted Postgres + Auth + Row-Level Security) as
its cloud backend (see [ADR 0001](adr/0001-supabase-as-backend.md)). The SPA
talks to Supabase directly from the browser; access is enforced by RLS, so the
client only ever uses the low-privilege **publishable** key — there is no
backend server and no secret key in this app.

## TL;DR — local dev

1. `npm install` (pulls in `@supabase/supabase-js`).
2. Copy `.env.example` to `.env.local` and fill in the two values below.
3. `npm run dev`.

```bash
# .env.local  (gitignored via the *.local rule)
VITE_SUPABASE_URL=https://pkpajhsepnomvkabqpoj.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Project: **PointPlanner** · ref `pkpajhsepnomvkabqpoj` · region `eu-north-1`.

If the env vars are absent the app still builds and runs; the sign-in screen
just shows a "not configured" notice (`isSupabaseConfigured()` in
`src/data/supabase.ts`).

## API keys (read this — it changed in 2025)

Supabase replaced the old JWT-based keys. Use the new ones:

| Legacy (JWT, deprecated) | Current | Used by |
| --- | --- | --- |
| `anon` | **Publishable** `sb_publishable_…` | Browser / SPA — safe to expose |
| `service_role` | **Secret** `sb_secret_…` | Backend only — **never** ship to a client |

- The legacy `anon` / `service_role` keys keep working **until the end of 2026**
  but are no longer recommended. The new keys can be rotated and revoked
  independently without downtime.
- This app uses **only the publishable key**. It carries the same low privileges
  as the old `anon` key, so RLS policies behave identically.
- **Never** place a secret key or the JWT secret behind a `VITE_` prefix — Vite
  inlines every `VITE_*` variable into the client bundle.

### Where to find them in the dashboard

- **Project URL:** Settings → API → *Project URL*.
- **Publishable key:** Settings → API Keys → **"Publishable and secret API keys"**
  tab. (If the project only shows legacy keys, click *Create new API keys* — it
  safely adds a `default` publishable + secret key alongside the existing ones.)
- The Connect dialog (top of the dashboard) also surfaces the URL + key.

## Database migrations

SQL migrations live in [`supabase/migrations/`](../supabase/migrations) and are
applied by a **human**, not by the app at runtime. Apply them in order via the
Supabase SQL editor (paste & run) or the CLI (`supabase db push`).

| Migration | Purpose |
| --- | --- |
| `0001_maps.sql` | `maps` table (JSONB blob + `owner`/`version`/`updated_at`) + owner-only RLS (#16) |
| `0002_map_shares.sql` | `map_shares` table + email-keyed sharing RLS; `SECURITY DEFINER` helpers to break `maps ↔ map_shares` recursion (#19) |
| `0003_map_editor_update.sql` | additive Editor update policy on `maps` (#20) |
| `0004_harden_current_email.sql` | pin `search_path` on `current_email()` (linter `function_search_path_mutable`) |
| `0005_private_rls_helpers.sql` | move the `SECURITY DEFINER` helpers into a non-exposed `private` schema so they aren't PostgREST RPC-callable (linter `0028`/`0029`) |
| `0006_github_synced_maps.sql` | `source`/`is_public` columns + `maps_select_public` RLS + NULL-able `owner` for the canonical GitHub-synced roadmap row; adds `maps` to the Realtime publication (see [ADR 0003](adr/0003-github-synced-roadmap-map.md)) |

> **Security note on the helpers.** `is_map_owner` / `map_share_role` are
> `SECURITY DEFINER`, which is what lets the `maps` and `map_shares` policies
> read across each other without infinite RLS recursion. They live in the
> `private` schema (migration `0005`) precisely because PostgREST only exposes
> RPC for functions in the *public/exposed* schema — so they cannot be called
> directly over the API. They **keep** `usage`/`execute` for `anon` +
> `authenticated`: an RLS policy is evaluated with the *caller's* privileges, so
> revoking execute would make the policies fail (`permission denied for
> function`). The security boundary is the schema not being exposed, not a
> revoke.

After any schema change, run the database linter (Advisors → Security in the
dashboard, or the Supabase MCP `get_advisors` tool) and confirm it is clean.

## Server-side roadmap sync (CI)

The SPA uses only the publishable key. The **one** place a secret key is used is
CI: the `Sync roadmap map` GitHub Action
([`.github/workflows/sync-roadmap.yml`](../.github/workflows/sync-roadmap.yml))
keeps the canonical GitHub-synced roadmap row in step with the issue tracker
(see [ADR 0003](adr/0003-github-synced-roadmap-map.md)). It runs
`npm run sync-roadmap`, which fetches issues via `gh`, runs the same transform as
`generate-map`, and upserts the public roadmap row using the **service-role**
key (which bypasses RLS to write the owner-less row).

Set these as repository **Secrets** (Settings → Secrets and variables → Actions →
**Secrets** — *not* Variables, unlike the publishable `VITE_*` values used by
`deploy.yml`):

| Secret | Value |
| --- | --- |
| `SUPABASE_URL` | the Project URL (same as `VITE_SUPABASE_URL`) |
| `SUPABASE_SERVICE_ROLE_KEY` | the **secret** key `sb_secret_…` (Settings → API Keys) |

`GH_TOKEN` is the workflow's built-in `secrets.GITHUB_TOKEN`; no extra setup. The
key bypasses RLS, so it must never be exposed to the browser or placed behind a
`VITE_` prefix.

## Auth: magic link / email OTP

v1 auth is **passwordless email only** — no passwords, no OAuth (per ADR 0001).
The same `signInWithOtp` call drives both a magic link and a 6-digit code; which
one the user receives depends on the email template
(`{{ .ConfirmationURL }}` → link, `{{ .Token }}` → code).

```ts
import { supabase } from './data/supabase'

// Send the magic link / code
const { error } = await supabase.auth.signInWithOtp({
  email,
  options: {
    // origin omits the Vite base path; include import.meta.env.BASE_URL so the
    // link targets /pointplanner/ on GitHub Pages (origin alone → org-root 404).
    emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}`,
    // shouldCreateUser: false, // reject sign-ins from unknown emails
  },
})

// (Code flow) verify the 6-digit code
await supabase.auth.verifyOtp({ email, token: '123456', type: 'email' })
```

A plain SPA does **not** need `@supabase/ssr` (that's for cookie-based server
rendering). `createClient` persists the session in `localStorage` by default.

### URL configuration (must be set in the dashboard)

This **cannot** be set via the Supabase MCP tools — do it in
Authentication → **URL Configuration**
(`/dashboard/project/pkpajhsepnomvkabqpoj/auth/url-configuration`):

- **Site URL** — the default redirect when no `redirectTo` is given. Set to the
  production URL: `https://cowboydiver.github.io/pointplanner/`.
- **Redirect URLs** (allow list) — only URLs on this list are accepted as
  magic-link destinations. Add:
  - `http://localhost:5173/**` — local Vite dev
  - `https://cowboydiver.github.io/pointplanner/**` — production

  `**` is a globstar (matches across `/`). Prefer exact paths in production.

### Caveats

- Magic links are one-time-use and email-only.
- Per-email rate limits apply; OTP expiry is configurable under
  Authentication → Providers → Email (max 1 day).
- The built-in email sender is fine for development; configure custom SMTP for
  production volume.
- To switch from magic link to a 6-digit code, edit the Magic Link template
  (Authentication → Email Templates) to include `{{ .Token }}`.

## References

- API keys: https://supabase.com/docs/guides/api/api-keys
- Passwordless email: https://supabase.com/docs/guides/auth/auth-email-passwordless
- Redirect URLs: https://supabase.com/docs/guides/auth/redirect-urls
- SECURITY DEFINER helpers in RLS: https://supabase.com/docs/guides/troubleshooting/do-i-need-to-expose-security-definer-functions-in-row-level-security-policies-iI0uOw
