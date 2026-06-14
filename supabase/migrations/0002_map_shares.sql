-- Migration: 0002_map_shares.sql
-- A human applies this after 0001_maps.sql. This migration is the SECURITY
-- BOUNDARY for all map sharing — every row here grants access to a Map. Review
-- carefully before applying.
--
-- Design decisions:
--   • Sharing is keyed by email (lower-cased at write time) so a share survives
--     the recipient signing up after the invite.
--   • Map identity is composite: maps(owner, id). Therefore map_shares must
--     reference both columns via a composite FK.
--   • The `role` column is introduced now (viewer/editor) so that issue #20
--     (Editor write-access) can reuse the same table without a schema change.
--   • No "accept" step — a share is effective the moment it is inserted.

-- ── map_shares table ──────────────────────────────────────────────────────────

create table if not exists public.map_shares (
  map_owner  uuid  not null,
  map_id     text  not null,
  email      text  not null,  -- stored lowercase/normalised; never raw input
  role       text  not null default 'viewer'
               check (role in ('viewer', 'editor')),
  primary key (map_owner, map_id, email),
  foreign key (map_owner, map_id)
    references public.maps(owner, id)
    on delete cascade
);

alter table public.map_shares enable row level security;

-- ── RLS on map_shares ─────────────────────────────────────────────────────────

-- Policy 1 — Owner manages shares
-- The Owner (map_owner = auth.uid()) can SELECT, INSERT, UPDATE and DELETE share
-- rows for their own maps. No other User can reach these rows via this policy.
create policy "owner manages shares"
  on public.map_shares
  for all
  using  (map_owner = auth.uid())
  with check (map_owner = auth.uid());

-- Policy 2 — Recipient can see shares addressed to them
-- A User whose JWT email matches the `email` column may SELECT the share row.
-- This policy is REQUIRED so that the shared-read policy on `maps` (below) can
-- read from `map_shares` in its EXISTS subquery while the caller is the
-- recipient (not the owner). When Postgres evaluates the subquery
-- `select 1 from public.map_shares s where s.email = lower(auth.jwt() ->> 'email')`
-- it also enforces RLS on map_shares — so the subquery would return nothing
-- for the recipient unless this SELECT policy exists.
--
-- Recursion safety: this policy references only map_shares columns; it never
-- references maps. The shared-read policy on maps references map_shares. There
-- is therefore no cycle: maps → map_shares is one-directional. Postgres
-- evaluates RLS on each table exactly once per query context; the map_shares
-- policies do not re-enter the maps policies.
create policy "recipient can see own share rows"
  on public.map_shares
  for select
  using (email = lower(auth.jwt() ->> 'email'));

-- ── RLS on maps — shared-read policy (additive; 0001 owner policies stand) ───

-- Policy 3 — Viewer (and Editor) can SELECT a shared map
-- This is intentionally SELECT-only. Write access for Editors is issue #20.
-- The EXISTS subquery checks both halves of the composite PK (map_owner AND
-- map_id) so that a share on "alice's pointplanner" never leaks "bob's
-- pointplanner" even if they share the same map slug.
-- The email match is case-normalised on the left side with lower(); the right
-- side is already normalised at insert time, but lower() on both sides is
-- belt-and-braces and has no performance cost here.
create policy "viewer can select shared maps"
  on public.maps
  for select
  using (
    exists (
      select 1
      from public.map_shares s
      where s.map_owner = maps.owner
        and s.map_id    = maps.id
        and s.email     = lower(auth.jwt() ->> 'email')
    )
  );
