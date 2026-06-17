# Share-invite emails via an Edge Function using Resend

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
browser cannot send mail; and we want the email to actually read like a sharing
notification — naming the inviter, the Map and the role.

We considered reusing Supabase Auth's own emails (`inviteUserByEmail` /
`signInWithOtp`). It needs no extra provider, but its templates can't embed the
Map name, and the new-user vs existing-user paths diverge awkwardly. Since a good
invite email is the whole point of the feature, that limitation was decisive.

## Decision

Add one **Edge Function**, `send-share-invite`, as the single trusted
server-side sender. The SPA calls it (`sendShareInvite` in `mapsRepo`) right
after granting the share. It sends a custom HTML email through **Resend** that
names the inviter, the Map and the role.

The email links to a **plain, non-expiring deep link** `${APP_URL}?map=<id>` —
*not* a one-time auth link. The recipient signs in with that email (the existing
magic-link flow; a brand-new email creates an account), and the app opens the
Map: `main.tsx` captures `?map`, stashes it across the sign-in in sessionStorage,
and `mapRegistry` opens it once the list loads.

Sending is **best-effort and decoupled** from the grant: `addShare` is the
source of truth for access, the email is a separate call, and the owner gets a
**Resend** action. The function re-checks that the caller owns the Map and that a
matching `map_shares` row exists before sending, so it cannot be used as an open
email relay.

## Consequences

- The invite email is fully branded and self-explanatory (inviter, Map, role,
  one button) rather than a generic auth template.
- A plain app deep link never expires, so an invite that sits in an inbox for
  days still works; the cost is one extra step (the recipient enters their email
  to sign in) rather than a one-click auth link that could expire.
- Adds a third-party dependency: a Resend account, a verified sending domain, and
  the `RESEND_API_KEY` / `INVITE_FROM` secrets (a human action; see
  `docs/supabase-setup.md`).
- A failed email never blocks or rolls back the access grant; Resend covers
  transient failures.
- This is the first Edge Function in the repo (`supabase/functions/`), deployed
  and configured by a human.
