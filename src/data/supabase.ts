import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
// Supabase replaced the legacy JWT `anon` key with a publishable key
// (`sb_publishable_…`) in 2025. It carries the same low privileges as the old
// anon key — safe to ship in the browser bundle — so RLS still does all the
// gating. See docs/supabase-setup.md.
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/** True only when both Supabase env vars are supplied. */
export function isSupabaseConfigured(): boolean {
  return Boolean(url && publishableKey);
}

// Initialised once and reused. Uses placeholder fallbacks so the client never
// throws when env vars are missing (keeps build, tests and an unconfigured dev
// run working).
export const supabase: SupabaseClient = createClient(
  url || 'http://localhost:54321',
  publishableKey || 'sb_publishable_placeholder',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);
