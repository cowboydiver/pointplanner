// github-webhook — GitHub App webhook receiver. Verifies the HMAC signature,
// and on an issues/milestone/sub_issue event re-syncs every mirror map tracking
// that repo (looked up by the stable repo id). Server-to-server (no CORS).
//
// Configure the App's webhook URL to this function and set GITHUB_WEBHOOK_SECRET
// to the App's webhook secret. See docs/github-app-setup.md.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { verifyWebhookSignature, parseWebhookEvent } from '../_shared/webhook.ts';
import { syncMap } from '../_shared/sync.ts';
import { getConfig } from '../_shared/env.ts';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const cfg = getConfig();

  // Read the RAW body once — the signature is over the exact bytes.
  const raw = await req.text();
  const signature = req.headers.get('X-Hub-Signature-256');
  if (!(await verifyWebhookSignature(cfg.webhookSecret, raw, signature))) {
    return new Response('invalid signature', { status: 401 });
  }

  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }
  const parsed = parseWebhookEvent(req.headers.get('X-GitHub-Event'), body);
  if (!parsed.shouldSync || parsed.repoId === null) {
    return new Response('ignored', { status: 202 });
  }

  const admin = createClient(cfg.supabaseUrl, cfg.serviceRoleKey);
  const { data: sources, error } = await admin
    .from('map_sources')
    .select('map_id')
    .eq('repo_id', parsed.repoId);
  if (error) return new Response('lookup failed', { status: 500 });

  const results = await Promise.allSettled(
    (sources ?? []).map((s: { map_id: string }) => syncMap(admin, cfg, s.map_id)),
  );
  const failed = results.filter(r => r.status === 'rejected').length;
  for (const r of results) {
    if (r.status === 'rejected') console.error('sync failed:', r.reason);
  }
  return new Response(JSON.stringify({ mirrors: results.length, failed }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
