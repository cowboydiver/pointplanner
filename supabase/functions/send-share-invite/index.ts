// Edge Function: send a share-invite email for a map.
//
// Why this exists: the SPA only holds the low-privilege publishable key and there
// is no backend server, so it cannot send email. This function is the one trusted
// server-side actor that can. The browser calls it (via `supabase.functions
// .invoke('send-share-invite', …)`) right after granting a share.
//
// Email channel: Resend (https://resend.com) — a custom, branded HTML email that
// names the inviter, the map and the role. The email links to `${APP_URL}?map=<id>`
// (a plain, non-expiring deep link). The recipient signs in with that email (the
// existing magic-link flow; a brand-new email creates an account) and the app
// opens the shared map — `main.tsx` captures `?map` and survives the sign-in via
// sessionStorage, `mapRegistry` opens it once the list loads.
//
// Authorization (also an anti-abuse boundary — it can make us send mail to
// arbitrary addresses): the function verifies the caller is authenticated, owns
// the target map, and that a `map_shares` row already exists for the recipient's
// (normalised) email. No matching grant → no email.
//
// Required secrets / env (see docs/supabase-setup.md):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY  (auto-injected)
//   RESEND_API_KEY    — Resend API key (re_…)
//   INVITE_FROM       — verified sender, e.g. "PointPlanner <invites@example.com>"
//   APP_URL           — e.g. https://cowboydiver.github.io/pointplanner/
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

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!),
  );
}

function inviteEmail(opts: {
  inviter: string;
  mapName: string;
  role: string;
  link: string;
}): { html: string; text: string } {
  const { inviter, mapName, role } = opts;
  const map = escapeHtml(mapName);
  const who = escapeHtml(inviter);
  const link = escapeHtml(opts.link);
  const access = role === 'editor' ? 'edit' : 'view';
  const text =
    `${inviter} shared the PointPlanner map "${mapName}" with you (${role} access).\n\n` +
    `Open it: ${opts.link}\n\n` +
    `Sign in with this email address and you'll land right on the map — there's no accept step.`;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1d23">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 0">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;padding:32px;text-align:left">
        <tr><td style="font-size:18px;font-weight:800;color:#2563C9;padding-bottom:16px">PointPlanner</td></tr>
        <tr><td style="font-size:15px;line-height:1.5;padding-bottom:20px">
          <strong>${who}</strong> shared the map <strong>“${map}”</strong> with you,
          with <strong>${access}</strong> access.
        </td></tr>
        <tr><td style="padding-bottom:24px">
          <a href="${link}" style="display:inline-block;background:#2563C9;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:10px">Open the map</a>
        </td></tr>
        <tr><td style="font-size:13px;line-height:1.5;color:#6b7280">
          Sign in with this email address and you'll land right on the map — there's no accept step.
          If the button doesn't work, paste this link into your browser:<br>
          <a href="${link}" style="color:#2563C9;word-break:break-all">${link}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  return { html, text };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
  const INVITE_FROM = Deno.env.get('INVITE_FROM');
  const APP_URL = Deno.env.get('APP_URL');
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY || !RESEND_API_KEY || !INVITE_FROM || !APP_URL) {
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
    .select('owner, name')
    .eq('id', mapId)
    .maybeSingle();
  if (mapErr) return json(500, { error: mapErr.message });
  if (!mapRow || mapRow.owner !== caller.id) {
    return json(403, { error: 'not the map owner' });
  }

  // … and a share must already exist for this recipient (no open relay).
  const { data: shareRow, error: shareErr } = await admin
    .from('map_shares')
    .select('role')
    .eq('map_id', mapId)
    .eq('email', normEmail)
    .maybeSingle();
  if (shareErr) return json(500, { error: shareErr.message });
  if (!shareRow) return json(403, { error: 'no matching share for that email' });

  const link = `${APP_URL.replace(/\/?$/, '/')}?map=${encodeURIComponent(mapId)}`;
  const { html, text } = inviteEmail({
    inviter: caller.email ?? 'Someone',
    mapName: (mapRow.name as string) || 'a map',
    role: (shareRow.role as string) || 'viewer',
    link,
  });

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: INVITE_FROM,
      to: [normEmail],
      subject: `${caller.email ?? 'Someone'} shared a PointPlanner map with you`,
      html,
      text,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return json(502, { error: `Resend send failed (${res.status}): ${detail}` });
  }

  return json(200, { ok: true });
});
