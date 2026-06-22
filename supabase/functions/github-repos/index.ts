// github-repos — authenticated. Lists the repos the caller can mirror, using
// their stored GitHub user-to-server token. When they haven't connected GitHub
// yet, returns { connected: false } so the SPA can kick off the App authorize
// redirect. Invoked via supabase.functions.invoke.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { json, preflight } from '../_shared/cors.ts';
import { listUserRepos } from '../_shared/githubAuth.ts';
import { getConfig } from '../_shared/env.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const cfg = getConfig();
  const admin = createClient(cfg.supabaseUrl, cfg.serviceRoleKey);

  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const { data: auth } = await admin.auth.getUser(token);
  const user = auth?.user;
  if (!user) return json({ error: 'unauthorized' }, 401);

  const { data: tok } = await admin
    .from('github_tokens')
    .select('access_token')
    .eq('user_id', user.id)
    .single();
  if (!tok?.access_token) return json({ connected: false, repos: [] });

  try {
    const repos = await listUserRepos(tok.access_token);
    return json({ connected: true, repos });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Only a 401 (bad/revoked/expired credential) should bounce the user back
    // through the authorize redirect — re-authing won't fix a transient 5xx,
    // rate-limit, or network blip, and would trap them in an authorize loop. For
    // those, stay "connected" and surface a retryable error so the SPA can offer
    // "couldn't load repos, try again" instead.
    console.error('github-repos failed:', err);
    if (/\b401\b/.test(message)) {
      return json({ connected: false, repos: [] });
    }
    return json({ connected: true, repos: [], error: 'fetch_failed' });
  }
});
