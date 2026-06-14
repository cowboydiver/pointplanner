-- Migration: 0001_maps.sql
-- Apply this in your Supabase project via the SQL Editor (Dashboard → SQL Editor →
-- New query) or via the Supabase CLI (`supabase db push`). It is idempotent if
-- re-run after a failure only at the "if not exists" boundary — drop the table
-- first if you need a clean re-apply.

-- ── maps table ────────────────────────────────────────────────────────────────
-- Each row is one Map owned by one User. The whole MapData (project, lines,
-- stations, edges) is stored as a single JSONB blob. The primary key is
-- (owner, id) so two Users can independently own a Map with the same slug id
-- (e.g. both have a map whose id is "pointplanner"). Client-generated ids may be
-- plain slugs or the "committed-<fileId>" scheme used for committed maps.

create table if not exists public.maps (
  id          text        not null,
  owner       uuid        not null references auth.users(id) on delete cascade default auth.uid(),
  name        text        not null,
  data        jsonb       not null,
  version     integer     not null default 1,
  updated_at  timestamptz not null default now(),
  primary key (owner, id)
);

-- ── Row-Level Security ────────────────────────────────────────────────────────
-- Sharing is out of scope for this migration. Only the Owner can see or modify
-- their maps. All four policies are scoped to auth.uid() = owner.

alter table public.maps enable row level security;

-- SELECT: owner can read their own maps
create policy "owner can select own maps"
  on public.maps
  for select
  using (owner = auth.uid());

-- INSERT: owner can insert maps (with check so row owner matches the caller)
create policy "owner can insert own maps"
  on public.maps
  for insert
  with check (owner = auth.uid());

-- UPDATE: owner can update their own maps
create policy "owner can update own maps"
  on public.maps
  for update
  using (owner = auth.uid())
  with check (owner = auth.uid());

-- DELETE: owner can delete their own maps
create policy "owner can delete own maps"
  on public.maps
  for delete
  using (owner = auth.uid());

-- ── version + updated_at maintenance ──────────────────────────────────────────
-- PostgREST does not evaluate SQL expressions in an UPDATE's JSON payload, so the
-- client cannot send `version = version + 1`. Instead a BEFORE UPDATE trigger
-- maintains both columns server-side and atomically: every update stamps
-- `updated_at = now()`, and `version` is incremented only when the `data` blob
-- actually changes (so a plain rename does not bump it). This also sets up the
-- optimistic stale-write guard in issue #18: a conditional update that matches on
-- the loaded `version` will see the trigger advance it to loaded + 1 on success.

create or replace function public.maps_touch()
  returns trigger
  language plpgsql
as $$
begin
  new.updated_at := now();
  if new.data is distinct from old.data then
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

create trigger maps_touch_before_update
  before update on public.maps
  for each row
  execute function public.maps_touch();
