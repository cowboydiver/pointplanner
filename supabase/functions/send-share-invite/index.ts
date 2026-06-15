// Edge Function: send a share-invite email for a map.
//
// Why this exists: the SPA only holds the low-privilege publishable key and there
// is no backend server, so it cannot send email. This function is the one trusted
// server-side actor that can. The browser calls it (via `supabase.functions
// .invoke('send-share-invite', …)`) right after granting a share.
//
// Email channel: Supabase Auth's own emails (no third-party provider).
//   - Recipient has no account  → `admin.inviteUserByEmail` (the "Invite user"
//     template). Confirming creates their account and signs them in.
//   - Recipient already exists   → `signInWithOtp` (the "Magic Link" template).
// Either way `redirectTo` carries `?map=<id>` so they land on the shared map.
//
// Authorization (this is also an anti-abuse boundary — it can make Supabase send
// mail to arbitrary addresses): the function verifies the caller is authenticated,
// owns the target map, and that a `map_shares` row already exists for the
// recipient's (normalised) email. No matching grant → no email.
//
// Required secrets / env (see docs/supabase-setup.md):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY  (auto-injected)
//   APP_URL  — e.g. https://cowboydiver.github.io/pointplanner/  (must be on the
//              dashboard Redirect URLs allow-list)
//
// Deploy: `supabase functions deploy send-share-invite`

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const APP_URL = Deno.env.get('APP_URL');
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY || !APP_URL) {
    return json(500, { error: 'function is missing required env (see docs)' });
  }

  let mapId: unknown, email: unknown;
  try {
    ({ mapId, email } = await req.json());
  } catch {
    return json(400, { error: 'invalid JSON body' });
  }
  if (typeof mapId !== 'string' || typeof email !== 'string') {
    return json(400, { error: 'mapId and email are required' });
  }
  const normEmail = email.trim().toLowerCase();
  if (!normEmail) return json(400, { error: 'email is required' });

  // Identify the caller from the forwarded JWT (the SDK forwards it on invoke).
  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData } = await userClient.auth.getUser();
  const caller = userData?.user;
  if (!caller) return json(401, { error: 'not authenticated' });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Authz: caller must own the map …
  const { data: mapRow, error: mapErr } = await admin
    .from('maps')
    .select('owner')
    .eq('id', mapId)
    .maybeSingle();
  if (mapErr) return json(500, { error: mapErr.message });
  if (!mapRow || mapRow.owner !== caller.id) {
    return json(403, { error: 'not the map owner' });
  }

  // … and a share must already exist for this recipient (no open relay).
  const { data: shareRow, error: shareErr } = await admin
    .from('map_shares')
    .select('email')
    .eq('map_id', mapId)
    .eq('email', normEmail)
    .maybeSingle();
  if (shareErr) return json(500, { error: shareErr.message });
  if (!shareRow) return json(403, { error: 'no matching share for that email' });

  const redirectTo = `${APP_URL.replace(/\/?$/, '/')}?map=${encodeURIComponent(mapId)}`;

  // New recipient → invite email; existing user → magic-link sign-in email.
  const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(normEmail, {
    redirectTo,
  });
  if (inviteErr) {
    const { error: otpErr } = await admin.auth.signInWithOtp({
      email: normEmail,
      options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
    });
    if (otpErr) {
      return json(502, {
        error: `could not send invite: ${inviteErr.message}; magic link: ${otpErr.message}`,
      });
    }
  }

  return json(200, { ok: true });
});
