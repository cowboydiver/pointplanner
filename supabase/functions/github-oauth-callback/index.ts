// github-oauth-callback — the GitHub App's user-authorization callback. GitHub
// redirects the browser here with `?code=…&state=…` after the user authorizes.
// We exchange the code for a user-to-server token and store it (service-role)
// keyed by the Supabase user, then redirect back to the SPA.
//
// `state` carries the caller's Supabase access token (set by the SPA when it
// starts the authorize redirect); we validate it to learn which user to store
// the GitHub token for. Configure this function's URL as the App's "Callback
// URL". See docs/github-app-setup.md.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { exchangeOAuthCode } from '../_shared/githubAuth.ts';
import { getConfig } from '../_shared/env.ts';

function redirect(to: string): Response {
  return new Response(null, { status: 302, headers: { Location: to } });
}

Deno.serve(async (req: Request) => {
  const cfg = getConfig();
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state') ?? '';
  const back = cfg.appUrl || url.origin;

  if (!code) return redirect(`${back}?github=error`);

  const admin = createClient(cfg.supabaseUrl, cfg.serviceRoleKey);
  // `state` is the SPA's Supabase access token — identifies the user to bind to.
  const { data: auth } = await admin.auth.getUser(state);
  const user = auth?.user;
  if (!user) return redirect(`${back}?github=error`);

  try {
    const accessToken = await exchangeOAuthCode(cfg.clientId, cfg.clientSecret, code);
    const { error } = await admin
      .from('github_tokens')
      .upsert({ user_id: user.id, access_token: accessToken, updated_at: new Date().toISOString() });
    if (error) throw error;
    return redirect(`${back}?github=connected`);
  } catch (err) {
    console.error('oauth callback failed:', err);
    return redirect(`${back}?github=error`);
  }
});
