-- 0005_private_rls_helpers.sql — move SECURITY DEFINER helpers out of the
-- API-exposed schema (database-linter 0028/0029).
--
-- HOW TO APPLY: run via the Supabase SQL editor or CLI (`supabase db push`).
-- NOT run by the app at runtime. SECURITY-CRITICAL — this moves the helpers the
-- sharing RLS depends on; review before applying.
--
-- PROBLEM: 0002 created `is_map_owner` and `map_share_role` as SECURITY DEFINER
-- functions in `public`. PostgREST exposes every function in `public` as an RPC
-- endpoint (`/rest/v1/rpc/...`), so anon/authenticated could invoke these
-- RLS-bypassing helpers directly. The linter flags this (0028/0029).
--
-- FIX (per Supabase guidance — "Do I need to expose security definer Functions
-- in RLS Policies?"): move the helpers into a NON-exposed `private` schema and
-- reference them schema-qualified from the policies. PostgREST only routes RPC
-- to exposed schemas, so the helpers are no longer API-callable — while RLS,
-- which resolves them by name, keeps working.
--
-- WHY NOT just REVOKE EXECUTE: an RLS policy that calls a helper is evaluated
-- with the *caller's* privileges, so the caller must retain EXECUTE (verified:
-- revoking it makes the policy fail with "permission denied for function").
-- The helpers therefore KEEP usage/execute for anon+authenticated; the security
-- gain comes purely from the schema no longer being exposed by PostgREST.
--
-- `current_email()` stays in `public`: it is SECURITY INVOKER (no privilege
-- escalation) and only ever returns the caller's own JWT email, so RPC exposure
-- is harmless and the linter does not flag it.

create schema if not exists private;
grant usage on schema private to anon, authenticated;

-- Helpers, relocated. Same bodies as 0002; still SECURITY DEFINER to break the
-- maps <-> map_shares policy recursion, still with a pinned search_path.
create or replace function private.is_map_owner(p_map_id uuid) returns boolean
  language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.maps m where m.id = p_map_id and m.owner = auth.uid())
$$;

create or replace function private.map_share_role(p_map_id uuid) returns text
  language sql security definer stable set search_path = public as $$
  select role from public.map_shares s
  where s.map_id = p_map_id and s.email = public.current_email() limit 1
$$;

revoke execute on function private.is_map_owner(uuid)  from public;
revoke execute on function private.map_share_role(uuid) from public;
grant  execute on function private.is_map_owner(uuid)  to anon, authenticated;
grant  execute on function private.map_share_role(uuid) to anon, authenticated;

-- Repoint every policy from public.* to private.* (drop + recreate), then drop
-- the public helpers now that nothing depends on them.
drop policy if exists "maps_select_shared" on public.maps;
create policy "maps_select_shared" on public.maps for select
  using (private.map_share_role(id) is not null);

drop policy if exists "maps_update_editor" on public.maps;
create policy "maps_update_editor" on public.maps for update
  using (private.map_share_role(id) = 'editor')
  with check (private.map_share_role(id) = 'editor');

drop policy if exists "map_shares_select_owner" on public.map_shares;
create policy "map_shares_select_owner" on public.map_shares for select
  using (private.is_map_owner(map_id));

drop policy if exists "map_shares_insert_owner" on public.map_shares;
create policy "map_shares_insert_owner" on public.map_shares for insert
  with check (private.is_map_owner(map_id));

drop policy if exists "map_shares_update_owner" on public.map_shares;
create policy "map_shares_update_owner" on public.map_shares for update
  using (private.is_map_owner(map_id)) with check (private.is_map_owner(map_id));

drop policy if exists "map_shares_delete_owner" on public.map_shares;
create policy "map_shares_delete_owner" on public.map_shares for delete
  using (private.is_map_owner(map_id));

drop function if exists public.is_map_owner(uuid);
drop function if exists public.map_share_role(uuid);
