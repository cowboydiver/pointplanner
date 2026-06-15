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
}

export interface SaveResult {
  ok: boolean;
  version?: number; // new version on success
  reason?: 'stale' | 'error';
  message?: string;
}

const TABLE = 'maps';
const SHARES_TABLE = 'map_shares';

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
    .select('id, name, owner')
    .order('updated_at', { ascending: false });

  if (error) throw error;

  const { uid } = await currentIdentity();
  const shares = await shareRoleLookup();

  return ((data ?? []) as { id: string; name: string; owner: string }[]).map(row => ({
    id: row.id,
    name: row.name,
    role: row.owner === uid ? 'owner' : (shares[row.id] ?? 'viewer'),
  }));
}

export async function loadMap(id: string): Promise<MapRecord | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('id, name, data, version, owner')
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

/**
 * Email the recipient an invite with a deep link to the map. Best-effort and
 * separate from {@link addShare}: the share row is the source of truth for access;
 * if the email fails the grant still stands and the owner can Resend.
 *
 * Delivery happens server-side in the `send-share-invite` Edge Function — the
 * browser only holds the publishable key and cannot send mail. That function
 * re-checks that the caller owns the map and that a matching `map_shares` row
 * exists before emailing (Supabase Auth: an invite email for a new recipient, a
 * magic-link sign-in for an existing one), so it can't be used as an open relay.
 * The link lands the recipient on `?map=<id>` after the auth round-trip.
 */
export async function sendShareInvite(
  mapId: string,
  email: string,
  role: MapRole = 'viewer',
): Promise<void> {
  const { error } = await supabase.functions.invoke('send-share-invite', {
    body: { mapId, email: email.trim().toLowerCase(), role },
  });

  if (error) throw error;
}
