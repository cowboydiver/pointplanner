-- 0003_map_editor_update.sql — Editor write access to a shared map (issue #20)
--
-- HITL / SECURITY-CRITICAL. Like 0001/0002, this is NOT run by the app at
-- runtime — apply it via the Supabase SQL editor (paste & run) or the Supabase
-- CLI (`supabase db push` / `supabase migration up`). A human MUST review this
-- RLS change: it widens who can UPDATE a `maps` row, so it is security-critical.
--
-- WHAT THIS ADDS: an ADDITIVE update policy on `maps` that lets a user with an
-- *editor* share UPDATE the map. It reuses the existing `map_share_role()`
-- SECURITY DEFINER helper from 0002, which bypasses RLS, so there is NO
-- maps<->map_shares policy recursion. Postgres OR's multiple permissive policies
-- of the same command together, so this stacks with `maps_update_owner` (0001):
-- a row is updatable if the caller is the owner OR has role = 'editor'.
--
-- WHY ONLY role = 'editor': `map_share_role()` returns 'viewer'/'editor'/null.
-- The check is strictly `= 'editor'`, so a Viewer (role='viewer') and a
-- non-shared user (null) are NOT granted update — they remain read-only.
--
-- WHY NO insert/delete/share policies for editors (Owner-only re-share + delete):
--   * RE-SHARE stays owner-only because `map_shares` only has *_owner write
--     policies (insert/update/delete gated on `is_map_owner`). We add NO editor
--     policy on `map_shares` here, so an editor simply cannot write share rows.
--   * DELETE of a map stays owner-only because `maps_delete_owner` (0001) is the
--     only delete policy on `maps`, and we add NO editor delete policy here.
--   Owner-only behaviour is therefore enforced by the ABSENCE of editor policies
--   on `map_shares` and on `maps` delete — there is nothing to grant it.

create policy "maps_update_editor" on public.maps for update
  using (public.map_share_role(id) = 'editor')
  with check (public.map_share_role(id) = 'editor');
