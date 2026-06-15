-- 0001_maps.sql — cloud-backed maps for the Owner (issue #16)
--
-- HOW TO APPLY: run this file via the Supabase SQL editor (paste & run) or the
-- Supabase CLI (`supabase db push` / `supabase migration up`). It is NOT run by
-- the app at runtime.
--
-- A Map is one row in `public.maps`: the whole MapData blob lives in `data jsonb`
-- (see docs/adr/0002), alongside `owner`, `version` and `updated_at` (adr/0001).
--
-- RLS POLICY DESIGN: the policies below are OWNER-ONLY and named with an
-- `_owner` suffix so that later slices (#19/#20 sharing) can ADD separate,
-- additively-OR'd policies (e.g. `maps_select_shared`) without colliding.

create extension if not exists "pgcrypto";

create table if not exists public.maps (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.maps enable row level security;

create policy "maps_select_owner" on public.maps for select using (owner = auth.uid());
create policy "maps_insert_owner" on public.maps for insert with check (owner = auth.uid());
create policy "maps_update_owner" on public.maps for update using (owner = auth.uid()) with check (owner = auth.uid());
create policy "maps_delete_owner" on public.maps for delete using (owner = auth.uid());

create index if not exists maps_owner_idx on public.maps (owner);
