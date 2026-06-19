-- 0006_github_synced_maps.sql — a canonical, GitHub-synced, public-read roadmap map
--
-- HOW TO APPLY: run this file via the Supabase SQL editor (paste & run) or the
-- Supabase CLI (`supabase db push` / `supabase migration up`). It is NOT run by
-- the app at runtime.
--
-- WHY: maps generated from GitHub issues were a one-time, per-account import that
-- never tracked the tracker again. This migration lets a server-side job (a
-- GitHub Action using the service-role key — see scripts/sync-roadmap.ts and
-- .github/workflows/sync-roadmap.yml) keep ONE canonical row in sync with the
-- repo's issues, and exposes that row read-only to every signed-in user.
--
-- MODEL:
--   * `source jsonb` tags a row as mirroring a tracker, e.g.
--       {"type":"github","owner":"cowboydiver","repo":"pointplanner","filter":null}
--     The sync job looks the row up by this descriptor to upsert it.
--   * `is_public boolean` makes a row readable by any authenticated user.
--   * The synced row has NO `owner`: it is written by the service role (which has
--     no `auth.uid()`), so `owner` is relaxed to NULL-able. A NULL owner never
--     matches the owner RLS policies, so no client can write it — GitHub wins.

-- The service-role writer has no auth.uid(); allow the canonical row to have no
-- owner. Existing user-owned rows keep their owner; the FK still applies to
-- non-null values.
alter table public.maps alter column owner drop not null;

alter table public.maps add column if not exists source jsonb;
alter table public.maps add column if not exists is_public boolean not null default false;

-- One canonical row per (tracker) source. Partial so ordinary user maps
-- (source IS NULL) are unconstrained.
create unique index if not exists maps_source_key
  on public.maps ((source->>'owner'), (source->>'repo'), (source->>'filter'))
  where source is not null;

-- Additive OR with the existing owner/shared select policies: any signed-in user
-- can READ a public row. There is deliberately no public insert/update/delete
-- policy, so a public map is read-only to clients (the sync job writes it via the
-- service role, which bypasses RLS).
create policy "maps_select_public" on public.maps for select
  to authenticated
  using (is_public);

-- Realtime: let viewers of the synced map receive live UPDATEs so an open map
-- refreshes itself when the sync job overwrites it. RLS still gates which rows a
-- client receives, so only readable (public/owned/shared) rows are delivered.
-- `add table` errors if the table is already in the publication; guard it.
do $$
begin
  alter publication supabase_realtime add table public.maps;
exception
  when duplicate_object then null;
end $$;
