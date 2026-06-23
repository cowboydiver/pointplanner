-- 0008_mirror_readonly_guard.sql — defense-in-depth: a mirror map's `data` and
-- `version` may only be written by the service role (the sync Edge Functions),
-- never by a client (connect-a-repo feature).
--
-- HOW TO APPLY: run via the Supabase SQL editor or CLI (`supabase db push`). It
-- is NOT run by the app at runtime. SECURITY-RELEVANT — review before applying.
--
-- The client already declines to autosave a read-only map, so this trigger is a
-- backstop, not the primary gate. It rejects any UPDATE that changes `data` or
-- `version` on a row where `is_mirror` is true, UNLESS the caller is the service
-- role (`auth.role() = 'service_role'`), which is how the Edge Functions write.
-- Owners may still rename / delete / share the mirror container — only the synced
-- payload is frozen — so updates that leave `data` and `version` untouched pass.
--
-- SECURITY: this is the ONLY server-side guard on a mirror's payload — the
-- `maps_update_owner` RLS policy still lets an owner UPDATE their own row, so the
-- whole boundary rests on `auth.role()`. That is sound on Supabase: the role is
-- read from the verified JWT (`authenticated` for a signed-in user; `service_role`
-- only for the service key, which never reaches the browser), so a client cannot
-- spoof it. Verify manually per docs/github-app-setup.md step 6.3 — an automated
-- assertion would need a live Postgres + JWT harness this repo's vitest suite
-- doesn't have.

create or replace function private.reject_mirror_client_write()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(old.is_mirror, false)
     and auth.role() <> 'service_role'
     and (new.data is distinct from old.data
          or new.version is distinct from old.version) then
    raise exception 'mirror maps are read-only (synced from GitHub)';
  end if;
  return new;
end;
$$;

drop trigger if exists maps_mirror_readonly on public.maps;
create trigger maps_mirror_readonly
  before update on public.maps
  for each row execute function private.reject_mirror_client_write();
