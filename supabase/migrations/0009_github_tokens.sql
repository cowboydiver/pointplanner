-- 0009_github_tokens.sql — store each user's GitHub user-to-server OAuth token so
-- the connect flow can list the repos they may mirror (connect-a-repo feature).
--
-- HOW TO APPLY: run via the Supabase SQL editor or CLI (`supabase db push`). It
-- is NOT run by the app at runtime.
--
-- These tokens are SECRET (they read on the user's behalf) and are only ever read
-- and written by the service-role Edge Functions (github-oauth-callback writes;
-- github-repos / connect-repo read). RLS is enabled with NO policies, so the
-- anon/authenticated client can neither read nor write them — only the service
-- role, which bypasses RLS, can.

create table if not exists public.github_tokens (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  access_token text not null,
  scope        text,
  updated_at   timestamptz not null default now()
);

alter table public.github_tokens enable row level security;
-- Intentionally NO policies: service-role only.
