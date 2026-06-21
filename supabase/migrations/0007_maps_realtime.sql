-- 0007_maps_realtime.sql — stream `maps` row changes over Supabase Realtime so a
-- mirror's live re-syncs reach every open viewer (owner + sharees) with no
-- refresh (connect-a-repo feature).
--
-- HOW TO APPLY: run via the Supabase SQL editor or CLI (`supabase db push`). It
-- is NOT run by the app at runtime.
--
-- Realtime honours RLS, and the existing `maps_select_owner` / `maps_select_shared`
-- policies already let owners and sharees SELECT their maps — so adding the table
-- to the publication reaches exactly that audience, with no new read policy. The
-- client only subscribes for read-only maps (mirrors / Viewer shares), so an
-- editable map's autosave loop is unaffected.
--
-- Idempotent: only adds `maps` to the publication if it isn't already a member.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'maps'
  ) then
    alter publication supabase_realtime add table public.maps;
  end if;
end $$;
