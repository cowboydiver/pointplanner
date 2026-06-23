-- 0006_map_sources.sql — mark a map as a read-only GitHub mirror and record its
-- origin (connect-a-repo feature).
--
-- HOW TO APPLY: run via the Supabase SQL editor or CLI (`supabase db push`). It
-- is NOT run by the app at runtime. Apply this BEFORE deploying the client code
-- that selects `maps.is_mirror`, otherwise those queries error.
--
-- A mirror map is an ordinary `public.maps` row whose `data` blob is rewritten by
-- an Edge Function from a GitHub repo's issues. Two things mark it:
--   * `maps.is_mirror` — a cheap boolean the client selects (no join) so it can
--     render the map read-only and badge it, exactly like a Viewer share.
--   * `public.map_sources` — one row per mirror recording where it syncs from and
--     the last sync result, so the owner can see status.
--
-- WRITES TO `map_sources` AND TO A MIRROR's `data` ARE SERVICE-ROLE ONLY (the
-- Edge Functions). The client may only SELECT its own sources (sync status), and
-- 0008 adds a trigger blocking client edits to a mirror's `data`/`version`.

-- Cheap read-only flag on the map itself (no join needed in loadMap/listMaps).
alter table public.maps
  add column if not exists is_mirror boolean not null default false;

create table if not exists public.map_sources (
  map_id           uuid primary key references public.maps(id) on delete cascade,
  owner            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  provider         text not null default 'github',
  repo_owner       text not null,
  repo_name        text not null,
  -- Stable numeric repo id — survives repo renames; the webhook looks mirrors up
  -- by this rather than owner/name.
  repo_id          bigint not null,
  installation_id  bigint,
  -- Optional label/milestone scope (reuses the generator's --filter semantics).
  filter           text,
  last_synced_at   timestamptz,
  last_sync_status text,
  last_sync_error  text,
  created_at       timestamptz not null default now()
);

-- Webhook lookup: "which mirrors track this repo?"
create index if not exists map_sources_repo_id_idx on public.map_sources (repo_id);

alter table public.map_sources enable row level security;

-- Owner-only SELECT so the client can show sync status. There is deliberately NO
-- insert/update/delete policy: only the service role (Edge Functions), which
-- bypasses RLS, writes here.
create policy "map_sources_select_owner" on public.map_sources for select
  using (owner = auth.uid());
