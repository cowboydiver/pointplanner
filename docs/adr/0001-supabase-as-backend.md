# Supabase as the cloud backend

## Status

accepted

## Context

PointPlanner was a purely client-side SPA storing maps in `localStorage`. We
want online accounts, cloud-stored maps, and peer-to-peer sharing of maps with
coworkers (view-only or async editing). This requires authentication, a
persistent store, and a way to enforce who-can-see-what — none of which exist.

## Decision

Use **Supabase** (hosted Postgres + Auth + Row-Level Security) as the backend.
Maps and shares are rows; the SPA talks to Supabase directly, with access
enforced by RLS policies rather than a custom API server.

## Considered options

- **Google Drive + Google sign-in** — A Google Drive integration is connected
  to this project, and Drive offers "free" account + sharing infrastructure
  (each map a file, shared by email via Drive's native UI). We rejected it
  because: it forces every User and coworker to have a Google account; it
  requires broad Drive OAuth scopes; sharing/permissions would be owned by
  Drive, so the app cannot enforce its own Owner/Editor/Viewer roles or query
  "maps shared with me"; and concurrent JSON file edits get crude
  last-writer-wins with no version guard. Drive is built for files, not for an
  app-owned permission model.
- **Firebase** — Comparable BaaS, but document-based with deeper Google
  lock-in, and its main differentiator (real-time sync) is something we
  deliberately chose not to use.
- **Custom backend** — Maximum control, but an ongoing ops burden
  (server, DB, auth, deployment) that is hard to justify for a small SPA.

## Consequences

- Auth and data are coupled to Supabase; migrating away later means moving both
  the auth identities and the Postgres data.
- We can express the entire access model ("maps I own ∪ maps shared with my
  email") as RLS policies and a single query, with no backend code to maintain.
