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

## Edge Functions: share-invite emails

Sharing emails the recipient a link to the map. The browser can't send mail (it
only holds the publishable key and there's no backend), so a single **Edge
Function** does it: [`supabase/functions/send-share-invite`](../supabase/functions/send-share-invite/index.ts).
The SPA calls it via `supabase.functions.invoke('send-share-invite', …)`
(`sendShareInvite` in `src/data/mapsRepo.ts`) right after granting the share.

It uses **Supabase Auth's own emails** — no third-party provider:

- recipient has **no account** → `admin.inviteUserByEmail` (the *Invite user*
  template) — confirming creates their account and signs them in;
- recipient **already exists** → `signInWithOtp` (the *Magic Link* template).

Either way the link's `redirectTo` carries `?map=<id>`, so after the auth
round-trip they land on the shared map (`main.tsx` captures the param,
`mapRegistry` opens it). The function is also an anti-abuse boundary: it verifies
the caller owns the map and that a `map_shares` row already exists for the
recipient's email before sending, so it can't be used as an open relay.

### Human setup (one-time)

1. **Secret** — give the function the app's base URL so it can build the link:
   ```bash
   supabase secrets set APP_URL=https://cowboydiver.github.io/pointplanner/
   ```
   (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are injected
   automatically — do **not** set them yourself.)
2. **Deploy:**
   ```bash
   supabase functions deploy send-share-invite
   ```
3. **Redirect URLs** — the `?map=…` link is already covered by the
   `https://cowboydiver.github.io/pointplanner/**` glob added above; no change
   needed.
4. **Templates (optional)** — customise the *Invite user* and *Magic Link*
   templates (Authentication → Email Templates) to mention PointPlanner sharing.
   Note: the specific map name isn't injected into the email body (a limitation
   of using Auth's templates rather than a transactional provider) — the email
   carries the link; the map name shows once the recipient opens it.

> The built-in email sender is rate-limited and dev-grade; configure custom SMTP
> (Authentication → Emails → SMTP) for production share volume.

## References

- API keys: https://supabase.com/docs/guides/api/api-keys
- Passwordless email: https://supabase.com/docs/guides/auth/auth-email-passwordless
- Redirect URLs: https://supabase.com/docs/guides/auth/redirect-urls
- SECURITY DEFINER helpers in RLS: https://supabase.com/docs/guides/troubleshooting/do-i-need-to-expose-security-definer-functions-in-row-level-security-policies-iI0uOw
