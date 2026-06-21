// connect-repo — authenticated. Creates a read-only mirror map for the caller
// from a repo they can access, runs the initial sync, and returns the new map's
// meta. Invoked by the SPA's ConnectRepoModal via supabase.functions.invoke.
//
// Security: the caller's chosen repo is re-validated against THEIR GitHub
// installations (their stored user token) before we mirror it, so a user can
// only mirror repos they themselves can see — not every repo the App is on.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { json, preflight } from '../_shared/cors.ts';
import { listUserRepos } from '../_shared/githubAuth.ts';
import { createMirror } from '../_shared/sync.ts';
import { getConfig } from '../_shared/env.ts';

interface ConnectBody {
  installationId: number;
  repoId: number;
  filter?: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const cfg = getConfig();
  const admin = createClient(cfg.supabaseUrl, cfg.serviceRoleKey);

  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const { data: auth } = await admin.auth.getUser(token);
  const user = auth?.user;
  if (!user) return json({ error: 'unauthorized' }, 401);

  let body: ConnectBody;
  try {
    body = (await req.json()) as ConnectBody;
  } catch {
    return json({ error: 'invalid body' }, 400);
  }
  if (typeof body.repoId !== 'number' || typeof body.installationId !== 'number') {
    return json({ error: 'repoId and installationId are required' }, 400);
  }

  const { data: tok } = await admin
    .from('github_tokens')
    .select('access_token')
    .eq('user_id', user.id)
    .single();
  if (!tok?.access_token) return json({ error: 'github_not_connected' }, 412);

  const repos = await listUserRepos(tok.access_token);
  const match = repos.find(r => r.repoId === body.repoId && r.installationId === body.installationId);
  if (!match) return json({ error: 'repo_not_accessible' }, 403);

  const filter = body.filter && body.filter.trim() ? body.filter.trim() : null;
  try {
    const map = await createMirror(admin, cfg, {
      ownerId: user.id,
      repoOwner: match.owner,
      repoName: match.name,
      repoId: match.repoId,
      installationId: match.installationId,
      filter,
    });
    return json({ map });
  } catch (err) {
    console.error('connect-repo failed:', err);
    return json({ error: 'sync_failed', message: err instanceof Error ? err.message : String(err) }, 502);
  }
});
