import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** True only when both Supabase env vars are supplied. */
export function isSupabaseConfigured(): boolean {
  return Boolean(url && anonKey);
}

// Initialised once and reused. Uses placeholder fallbacks so the client never
// throws when env vars are missing (keeps build, tests and an unconfigured dev
// run working).
export const supabase: SupabaseClient = createClient(
  url || 'http://localhost:54321',
  anonKey || 'public-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);
