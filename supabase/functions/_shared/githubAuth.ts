// GitHub App auth helpers (Deno runtime). Mints the App JWT (RS256), exchanges
// it for installation access tokens, runs the user OAuth code exchange, and lists
// a user's accessible installations/repos. Uses only Web APIs (Web Crypto +
// fetch) so it runs in the Supabase Edge runtime.
//
// IMPORTANT: the App private key must be supplied in PKCS#8 PEM form
// (`-----BEGIN PRIVATE KEY-----`). GitHub issues PKCS#1 (`BEGIN RSA PRIVATE KEY`);
// convert once with `openssl pkcs8 -topk8 -nocrypt -in key.pem`. See
// docs/github-app-setup.md.

const GH_API = 'https://api.github.com';

export function base64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode a PKCS#8 PEM into the DER bytes Web Crypto's importKey expects. */
export function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const der = atob(body);
  const bytes = new Uint8Array(der.length);
  for (let i = 0; i < der.length; i++) bytes[i] = der.charCodeAt(i);
  return bytes.buffer;
}

/** Mint a short-lived (≈9 min) App JWT signed RS256 with the App private key. */
export async function createAppJwt(appId: string, privateKeyPem: string, nowMs = Date.now()): Promise<string> {
  const now = Math.floor(nowMs / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  // `iat` is backdated 30s to tolerate minor clock skew (per GitHub guidance).
  const payload = base64url(JSON.stringify({ iat: now - 30, exp: now + 540, iss: appId }));
  const signingInput = `${header}.${payload}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64url(sig)}`;
}

function appHeaders(jwt: string): HeadersInit {
  return {
    Authorization: `Bearer ${jwt}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'pointplanner-mirror',
  };
}

/** Exchange the App JWT for an installation access token (reads private repos). */
export async function getInstallationToken(
  appId: string,
  privateKeyPem: string,
  installationId: number,
): Promise<string> {
  const jwt = await createAppJwt(appId, privateKeyPem);
  const res = await fetch(`${GH_API}/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: appHeaders(jwt),
  });
  if (!res.ok) {
    throw new Error(`installation token failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { token: string };
  return body.token;
}

/** Exchange an OAuth `code` (user authorize callback) for a user-to-server token. */
export async function exchangeOAuthCode(
  clientId: string,
  clientSecret: string,
  code: string,
): Promise<string> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  if (!res.ok) throw new Error(`oauth exchange failed: ${res.status}`);
  const body = (await res.json()) as { access_token?: string; error?: string };
  if (!body.access_token) throw new Error(`oauth exchange error: ${body.error ?? 'no token'}`);
  return body.access_token;
}

export interface ConnectableRepo {
  installationId: number;
  repoId: number;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
}

/**
 * List the repos a user can connect: every installation of this App the user can
 * access (`GET /user/installations`), expanded to its accessible repositories
 * (`GET /user/installations/{id}/repositories`), using the user-to-server token.
 */
export async function listUserRepos(userToken: string): Promise<ConnectableRepo[]> {
  const headers = {
    Authorization: `Bearer ${userToken}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'pointplanner-mirror',
  };
  const instRes = await fetch(`${GH_API}/user/installations?per_page=100`, { headers });
  if (!instRes.ok) throw new Error(`list installations failed: ${instRes.status}`);
  const { installations } = (await instRes.json()) as { installations: { id: number }[] };

  const repos: ConnectableRepo[] = [];
  for (const inst of installations ?? []) {
    for (let page = 1; page <= 20; page++) {
      const res = await fetch(
        `${GH_API}/user/installations/${inst.id}/repositories?per_page=100&page=${page}`,
        { headers },
      );
      if (!res.ok) break;
      const { repositories } = (await res.json()) as {
        repositories: { id: number; name: string; full_name: string; private: boolean; owner: { login: string } }[];
      };
      if (!repositories || repositories.length === 0) break;
      for (const r of repositories) {
        repos.push({
          installationId: inst.id,
          repoId: r.id,
          owner: r.owner.login,
          name: r.name,
          fullName: r.full_name,
          private: r.private,
        });
      }
      if (repositories.length < 100) break;
    }
  }
  return repos;
}
