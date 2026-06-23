import { supabase } from './supabase';
import type { MapData, MapMeta } from '../lib/maps';

// Data-access layer for cloud-backed maps (issue #16). Every query below is
// scoped to the current user automatically by the `maps` RLS policies — we never
// pass `owner` from the client; the column default `auth.uid()` sets it.

// A map the current user can read is one of: owned, or shared with them by email
// via `map_shares` (issue #19 Viewer; #20 adds Editor). The role rides alongside
// every record/list item so the store and UI can gate editing.
export type MapRole = 'owner' | 'editor' | 'viewer';

export interface MapListItem extends MapMeta {
  role: MapRole;
  // True for a GitHub-mirror map: read-only for everyone (owner included), its
  // `data` rewritten server-side from a repo's issues. See migration 0006.
  isMirror: boolean;
}

export interface ShareEntry {
  email: string;
  role: MapRole;
}

export interface MapRecord {
  id: string;
  name: string;
  data: MapData;
  version: number;
  role: MapRole;
  isMirror: boolean;
}

/** A repo the signed-in user can mirror, returned by the github-repos function. */
export interface ConnectableRepo {
  installationId: number;
  repoId: number;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
}

/** Result of listing connectable repos: `connected` is false until the user has
 * authorized the GitHub App (the caller then kicks off the authorize redirect).
 * `error` is set when the user IS connected but the repo fetch failed transiently
 * (e.g. a GitHub 5xx/rate-limit) — the caller should offer a retry, not re-auth. */
export interface ConnectableReposResult {
  connected: boolean;
  repos: ConnectableRepo[];
  error?: string;
}

/** Origin + last-sync status of a mirror map (migration 0006), owner-only. */
export interface MapSource {
  provider: string;
  repoOwner: string;
  repoName: string;
  filter: string | null;
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
}

export interface SaveResult {
  ok: boolean;
  version?: number; // new version on success
  reason?: 'stale' | 'error';
  message?: string;
}

const TABLE = 'maps';
const SHARES_TABLE = 'map_shares';
const SOURCES_TABLE = 'map_sources';

/**
 * The current user's id + lowercased email, used to resolve each readable map's
 * role (owner vs shared). Returns nulls when there is no session.
 */
async function currentIdentity(): Promise<{ uid: string | null; email: string | null }> {
  const { data } = await supabase.auth.getUser();
  const user = data?.user ?? null;
  return {
    uid: user?.id ?? null,
    email: user?.email ? user.email.toLowerCase() : null,
  };
}

/**
 * Build a `map_id → role` lookup of the caller's shares. RLS
 * (`map_shares_select_self`) already restricts these rows to the caller's email,
 * so a bare select returns exactly the shares granted to them.
 */
async function shareRoleLookup(): Promise<Record<string, MapRole>> {
  const { data, error } = await supabase.from(SHARES_TABLE).select('map_id, role');
  if (error) throw error;
  const lookup: Record<string, MapRole> = {};
  for (const row of (data ?? []) as { map_id: string; role: MapRole }[]) {
    lookup[row.map_id] = row.role;
  }
  return lookup;
}

/** Maps the current user can read (owned AND shared, via RLS), most-recent first. */
export async function listMaps(): Promise<MapListItem[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('id, name, owner, is_mirror')
    .order('updated_at', { ascending: false });

  if (error) throw error;

  const { uid } = await currentIdentity();
  const shares = await shareRoleLookup();

  return ((data ?? []) as { id: string; name: string; owner: string; is_mirror?: boolean }[]).map(row => ({
    id: row.id,
    name: row.name,
    role: row.owner === uid ? 'owner' : (shares[row.id] ?? 'viewer'),
    isMirror: Boolean(row.is_mirror),
  }));
}

export async function loadMap(id: string): Promise<MapRecord | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('id, name, data, version, owner, is_mirror')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const { uid } = await currentIdentity();
  let role: MapRole;
  if (data.owner === uid) {
    role = 'owner';
  } else {
    const shares = await shareRoleLookup();
    role = shares[data.id as string] ?? 'viewer';
  }

  return {
    id: data.id as string,
    name: data.name as string,
    data: data.data as MapData,
    version: data.version as number,
    role,
    isMirror: Boolean(data.is_mirror),
  };
}

/**
 * The mirror origin + last-sync status for a map (owner-only via RLS). Returns
 * null for a non-mirror map (no `map_sources` row) or when there is no session.
 */
export async function getMapSource(mapId: string): Promise<MapSource | null> {
  const { data, error } = await supabase
    .from(SOURCES_TABLE)
    .select('provider, repo_owner, repo_name, filter, last_synced_at, last_sync_status, last_sync_error')
    .eq('map_id', mapId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return {
    provider: data.provider as string,
    repoOwner: data.repo_owner as string,
    repoName: data.repo_name as string,
    filter: (data.filter as string | null) ?? null,
    lastSyncedAt: (data.last_synced_at as string | null) ?? null,
    lastSyncStatus: (data.last_sync_status as string | null) ?? null,
    lastSyncError: (data.last_sync_error as string | null) ?? null,
  };
}

export async function createMap(name: string, data: MapData): Promise<MapMeta> {
  // owner + id + version come from column defaults.
  const { data: row, error } = await supabase
    .from(TABLE)
    .insert({ name, data })
    .select('id, name')
    .single();

  if (error) throw error;
  return { id: row.id as string, name: row.name as string };
}

export async function renameMap(id: string, name: string): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .update({ name, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw error;
}

export async function deleteMap(id: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) throw error;
}

export async function duplicateMap(id: string): Promise<MapMeta> {
  const source = await loadMap(id);
  if (!source) throw new Error('Map not found: ' + id);
  return createMap(source.name + ' copy', source.data);
}

/**
 * #18: conditional (optimistic-concurrency) update. The write only applies when
 * the row's `version` still equals `baseVersion` — i.e. nobody else saved since
 * this client loaded. On success `version` bumps to `baseVersion + 1` and
 * `updated_at` refreshes. If the server moved on, no row matches the guard and
 * we report `{ ok: false, reason: 'stale' }` without overwriting the newer
 * state. (Replaces the earlier last-writer-wins behaviour.)
 */
export async function saveMap(
  id: string,
  data: MapData,
  baseVersion: number,
): Promise<SaveResult> {
  const nextVersion = baseVersion + 1;
  const { data: rows, error } = await supabase
    .from(TABLE)
    .update({ data, version: nextVersion, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('version', baseVersion)
    .select('version');

  if (error) return { ok: false, reason: 'error', message: error.message };
  if (!rows || (rows as unknown[]).length === 0) return { ok: false, reason: 'stale' };
  return { ok: true, version: nextVersion };
}

// --- GitHub mirror (connect-a-repo) -----------------------------------------
// These go through Supabase Edge Functions (service-role GitHub access lives
// server-side; the browser never sees an installation token). The functions are
// documented in docs/github-app-setup.md.

/**
 * Begin the GitHub App user-authorization redirect. Sends the user to GitHub to
 * grant the App access; GitHub returns them to the `github-oauth-callback`
 * function (which stores their token and redirects back here). The current
 * Supabase access token rides in `state` so the callback knows which user to
 * bind the GitHub token to.
 */
export async function startGithubAuthorize(): Promise<void> {
  const clientId = import.meta.env.VITE_GITHUB_CLIENT_ID;
  const callbackUrl = import.meta.env.VITE_GITHUB_CALLBACK_URL;
  if (!clientId || !callbackUrl) {
    throw new Error('GitHub App is not configured (VITE_GITHUB_CLIENT_ID / VITE_GITHUB_CALLBACK_URL).');
  }
  const { data } = await supabase.auth.getSession();
  const state = data.session?.access_token ?? '';
  const url =
    `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(callbackUrl)}&state=${encodeURIComponent(state)}`;
  window.location.href = url;
}

/** List the repos the signed-in user can mirror (github-repos function). */
export async function listConnectableRepos(): Promise<ConnectableReposResult> {
  const { data, error } = await supabase.functions.invoke('github-repos', { body: {} });
  if (error) throw error;
  return data as ConnectableReposResult;
}

/**
 * Create a read-only mirror map from a repo the user can access (connect-repo
 * function). Returns the new map's meta; the registry then adds it as an
 * owned, mirror item and makes it active.
 */
export async function connectRepo(params: {
  installationId: number;
  repoId: number;
  filter?: string | null;
}): Promise<MapMeta> {
  const { data, error } = await supabase.functions.invoke('connect-repo', { body: params });
  if (error) throw error;
  return (data as { map: MapMeta }).map;
}

// --- Sharing (issue #19) ----------------------------------------------------
// All three are owner-only via `map_shares` RLS. Emails are case-normalised
// (lowercased) on write so a share resolves regardless of how it was typed and
// matches the lowercased JWT email used by the RLS policies.

/** The shares on a map (owner-only via RLS). */
export async function listShares(mapId: string): Promise<ShareEntry[]> {
  const { data, error } = await supabase
    .from(SHARES_TABLE)
    .select('email, role')
    .eq('map_id', mapId);

  if (error) throw error;
  return ((data ?? []) as { email: string; role: MapRole }[]).map(row => ({
    email: row.email,
    role: row.role,
  }));
}

/**
 * Grant (or update) a share. Upsert on (map_id, email) so re-sharing or changing
 * a role is idempotent. `role` is generic so #20 can reuse this for 'editor'.
 */
export async function addShare(
  mapId: string,
  email: string,
  role: MapRole = 'viewer',
): Promise<void> {
  const { error } = await supabase
    .from(SHARES_TABLE)
    .upsert(
      { map_id: mapId, email: email.trim().toLowerCase(), role },
      { onConflict: 'map_id,email' },
    );

  if (error) throw error;
}

/** Revoke a share. */
export async function removeShare(mapId: string, email: string): Promise<void> {
  const { error } = await supabase
    .from(SHARES_TABLE)
    .delete()
    .eq('map_id', mapId)
    .eq('email', email.trim().toLowerCase());

  if (error) throw error;
}
