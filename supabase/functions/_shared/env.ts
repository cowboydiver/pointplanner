// Reads the Edge Function secrets/config from the environment (set via
// `supabase secrets set …`; SUPABASE_* are injected automatically). Kept in one
// place so every function validates the same names. See docs/github-app-setup.md.

export interface FunctionConfig {
  appId: string;
  privateKeyPem: string;
  webhookSecret: string;
  clientId: string;
  clientSecret: string;
  supabaseUrl: string;
  serviceRoleKey: string;
  /** Where the OAuth callback redirects back to (the deployed SPA URL). */
  appUrl: string;
}

function need(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing required env: ${name}`);
  return v;
}

export function getConfig(): FunctionConfig {
  return {
    appId: need('GITHUB_APP_ID'),
    privateKeyPem: need('GITHUB_APP_PRIVATE_KEY'),
    webhookSecret: need('GITHUB_WEBHOOK_SECRET'),
    clientId: need('GITHUB_CLIENT_ID'),
    clientSecret: need('GITHUB_CLIENT_SECRET'),
    supabaseUrl: need('SUPABASE_URL'),
    serviceRoleKey: need('SUPABASE_SERVICE_ROLE_KEY'),
    appUrl: Deno.env.get('APP_URL') ?? '',
  };
}
