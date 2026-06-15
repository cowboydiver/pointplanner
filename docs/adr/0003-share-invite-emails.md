# Share-invite emails via an Edge Function using Supabase Auth emails

## Status

accepted

## Context

Sharing a Map (#19/#20) grants access by email through `map_shares`, but the
original design had **no notification** — the recipient only saw the Map if they
happened to sign in with that email. Users reasonably expected an email. We need
to email a recipient a link to the shared Map, and for a recipient with no
account yet, funnel them through the existing magic-link flow and still land them
on the Map.

Two constraints shape the decision: the SPA holds only the low-privilege
**publishable** key and there is **no backend server** (ADR 0001), so the
browser cannot send mail; and we already rely on Supabase's built-in email for
magic-link sign-in.

## Decision

Add one **Edge Function**, `send-share-invite`, as the single trusted
server-side sender. The SPA calls it (`sendShareInvite` in `mapsRepo`) right
after granting the share. It sends via **Supabase Auth's own emails** — no
third-party provider:

- recipient has no account → `admin.inviteUserByEmail` (*Invite user* template);
- recipient already exists → `signInWithOtp` (*Magic Link* template).

The link's `redirectTo` carries `?map=<id>`; the app captures that param
(`main.tsx`), stashes it across any manual sign-in, and opens the Map once the
list loads (`mapRegistry`). Sending is **best-effort and decoupled** from the
grant: `addShare` is the source of truth for access, the email is a separate
call, and the owner gets a **Resend** action. The function re-checks that the
caller owns the Map and that a matching `map_shares` row exists before sending,
so it cannot be used as an open email relay.

## Consequences

- No new dependency or provider account: reuses the email channel already in use
  for sign-in. The trade-off is that Auth's templates can't embed the specific
  Map name in the body — the email carries the link, the name shows on open.
- The new-user vs existing-user paths diverge (invite vs magic-link), handled by
  attempt-invite-then-fall-back-to-OTP inside the function.
- A failed email never blocks or rolls back the access grant; Resend covers
  transient failures and Supabase's per-email rate limits.
- This is the first Edge Function in the repo (`supabase/functions/`), deployed
  and configured by a human — it needs the `APP_URL` secret and a deploy step
  (see `docs/supabase-setup.md`).
