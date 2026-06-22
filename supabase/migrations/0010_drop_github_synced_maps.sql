-- 0010_drop_github_synced_maps.sql — revert the discarded "github_synced_maps"
-- design (a server-synced, public-read roadmap built on maps.source /
-- maps.is_public). It was applied to the cloud project from an earlier branch
-- that has since been abandoned; the connect-a-repo mirror feature (0006–0009)
-- supersedes it with per-map mirrors in `map_sources` + a `maps.is_mirror` flag.
--
-- HOW TO APPLY: run via the Supabase SQL editor or CLI (`supabase db push`). It
-- is NOT run by the app at runtime.
--
-- Safe + idempotent: every drop is guarded `if exists`, so on a database that
-- never had the discarded design (a fresh one applying 0001–0010 in order) this
-- is a no-op. Restoring owner NOT NULL is likewise a no-op where it already is.
-- Verified before applying to the cloud project that no rows used these columns
-- (0 with source set, 0 public, 0 with a null owner).

drop policy if exists "maps_select_public" on public.maps;
drop index if exists public.maps_source_key;
alter table public.maps drop column if exists source;
alter table public.maps drop column if exists is_public;

-- Restore the owner NOT NULL constraint the discarded design relaxed (it allowed
-- an owner-less canonical row). Mirror maps are owned by the user who connects
-- them (auth.uid()), so every row has an owner again. The Realtime publication on
-- public.maps is intentionally kept — the mirror feature relies on it (see 0007).
alter table public.maps alter column owner set not null;
