-- 0004_harden_current_email.sql — pin search_path on current_email() (security advisor 0011)
--
-- HOW TO APPLY: run via the Supabase SQL editor or CLI (`supabase db push`).
-- NOT run by the app at runtime.
--
-- 0002 created current_email() without a fixed search_path, which the database
-- linter flags (function_search_path_mutable). The two SECURITY DEFINER helpers
-- already pin `search_path = public`; this brings current_email() in line. Its
-- only reference, `auth.jwt()`, is schema-qualified, so an empty search_path is
-- safe and maximally restrictive. `create or replace` keeps the existing
-- function identity, so the RLS policies and helpers that call it are unaffected.

create or replace function public.current_email() returns text
language sql stable set search_path = '' as $$ select lower(auth.jwt() ->> 'email') $$;
