-- 0002_map_shares.sql — email-keyed peer-to-peer sharing of a map (issue #19 Viewer; #20 adds Editor)
--
-- HITL / SECURITY-CRITICAL. Like 0001, this is NOT run by the app at runtime —
-- apply it via the Supabase SQL editor (paste & run) or the Supabase CLI
-- (`supabase db push` / `supabase migration up`). A human MUST review this RLS
-- before issue #20 builds the Editor write path on top of these policies.
--
-- WHY SECURITY DEFINER HELPERS: the `maps` select policy needs to consult
-- `map_shares`, and the `map_shares` policies need to consult `maps`. With both
-- tables under RLS, a policy on one table that queries the other re-triggers the
-- other table's policies, which query back — Postgres treats this as infinite
-- recursion and aborts. The helper functions below are `security definer`, so
-- they run as the function owner and BYPASS RLS, breaking the cycle while still
-- gating on `auth.uid()` / the caller's JWT email explicitly inside the function.
--
-- SHARING MODEL: keyed by (map_id, email), emails stored lowercased. There is no
-- accept step — an email that has no account yet simply resolves the moment that
-- person signs in with the matching email (the JWT email then matches a row).
--
-- NOTE: the Editor UPDATE policy on `maps` is issue #20's job — do NOT add it here.

create table if not exists public.map_shares (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null references public.maps(id) on delete cascade,
  email text not null,
  role text not null check (role in ('viewer','editor')),
  created_at timestamptz not null default now(),
  unique (map_id, email)
);

alter table public.map_shares enable row level security;

-- Helper: the caller's normalised email from their JWT.
create or replace function public.current_email() returns text
language sql stable as $$ select lower(auth.jwt() ->> 'email') $$;

-- SECURITY DEFINER helpers bypass RLS to break the maps<->map_shares recursion.
create or replace function public.is_map_owner(p_map_id uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.maps m where m.id = p_map_id and m.owner = auth.uid())
$$;

create or replace function public.map_share_role(p_map_id uuid) returns text
language sql security definer stable set search_path = public as $$
  select role from public.map_shares s
  where s.map_id = p_map_id and s.email = public.current_email() limit 1
$$;

-- maps: ADD a shared-read policy (additive OR with the existing owner policy).
create policy "maps_select_shared" on public.maps for select
  using (public.map_share_role(id) is not null);

-- map_shares policies:
create policy "map_shares_select_owner" on public.map_shares for select
  using (public.is_map_owner(map_id));
create policy "map_shares_select_self" on public.map_shares for select
  using (email = public.current_email());
create policy "map_shares_insert_owner" on public.map_shares for insert
  with check (public.is_map_owner(map_id));
create policy "map_shares_update_owner" on public.map_shares for update
  using (public.is_map_owner(map_id)) with check (public.is_map_owner(map_id));
create policy "map_shares_delete_owner" on public.map_shares for delete
  using (public.is_map_owner(map_id));

create index if not exists map_shares_email_idx on public.map_shares (email);
create index if not exists map_shares_map_idx on public.map_shares (map_id);
