/**
 * mapsRepo — async data-access module for the `maps` and `map_shares` Supabase
 * tables.
 *
 * With the introduction of map_shares (migration 0002), RLS on `maps` now
 * returns owned AND shared maps. The `owner` field on MapRow lets callers
 * distinguish them: `owner !== myUserId` means the map was shared with the
 * authenticated user (read-only for Viewers). PART B (MapRegistry + ProjectStore
 * rewire) will use this to compute a read-only flag on each map.
 *
 * Ordering: `listMaps` returns maps ordered by `updated_at DESC` (most-recently
 * saved first), which suits the "jump back to recent work" use-case in the UI.
 *
 * Error handling: Supabase errors are re-thrown as plain `Error`s with the
 * Supabase message. Callers decide how to surface them.
 *
 * Part B (MapRegistry + ProjectStore rewire) consumes this module — keep
 * function signatures stable.
 */

import type { MapData } from './maps';
import { getSupabaseClient } from './supabase';

// ── Public types ──────────────────────────────────────────────────────────────

export interface MapRow {
  id: string;
  /** UUID of the User who owns this map. Compare to the authenticated user's id
   *  to detect a shared (read-only) map: `owner !== myUserId`. */
  owner: string;
  name: string;
  version: number;
  updatedAt: string;
}

/**
 * A single share record returned by listShares. Represents one User's access
 * grant to a map.
 */
export interface ShareRow {
  email: string;
  role: 'viewer' | 'editor';
}

export interface MapDataWithVersion {
  data: MapData;
  version: number;
}

/** Result of a version-guarded save. */
export type SaveResult =
  | { status: 'saved'; version: number }
  | { status: 'stale' };

// ── Internal helpers ──────────────────────────────────────────────────────────

interface DbRow {
  id: string;
  owner: string;
  name: string;
  version: number;
  updated_at: string;
}

interface DbShareRow {
  email: string;
  role: string;
}

function toMapRow(row: DbRow): MapRow {
  return {
    id: row.id,
    owner: row.owner,
    name: row.name,
    version: row.version,
    updatedAt: row.updated_at,
  };
}

function toShareRow(row: DbShareRow): ShareRow {
  return {
    email: row.email,
    role: row.role as 'viewer' | 'editor',
  };
}

function throwOnError(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

/**
 * Normalise an email address for consistent storage and lookup: trim whitespace
 * and convert to lowercase. Applied to all email values before they reach the
 * database so that comparisons in RLS policies are always case-insensitive.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * List maps visible to the authenticated user (owned AND shared via map_shares),
 * ordered by updated_at DESC (most recent first). Returns [] when the user has
 * no maps. The `owner` field on each MapRow identifies who owns the map; PART B
 * uses `owner !== myUserId` to mark shared maps as read-only for Viewers.
 */
export async function listMaps(): Promise<MapRow[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('maps')
    .select('id, name, version, updated_at, owner')
    .order('updated_at', { ascending: false });

  throwOnError(error);
  return ((data as DbRow[]) ?? []).map(toMapRow);
}

/**
 * Fetch a single map's data and version. Returns null when not found.
 *
 * When `owner` is provided the query filters on both `(owner, id)` — the
 * composite PK — which is unambiguous even for shared maps where the caller is
 * not the owner. PART B will always pass `owner` to disambiguate shared maps.
 *
 * When `owner` is omitted the query filters only on `id`, preserving back-compat
 * for existing callers (which are always the owner).
 */
export async function getMap(
  id: string,
  owner?: string,
): Promise<MapDataWithVersion | null> {
  const sb = getSupabaseClient();
  let query = sb.from('maps').select('data, version');
  if (owner !== undefined) {
    query = query.eq('owner', owner).eq('id', id);
  } else {
    query = query.eq('id', id);
  }
  const { data, error } = await query;

  throwOnError(error);
  const rows = data as Array<{ data: MapData; version: number }> | null;
  if (!rows || rows.length === 0) return null;
  return { data: rows[0]!.data, version: rows[0]!.version };
}

/**
 * Create a new map row. Version starts at 1. The `owner` column defaults to
 * `auth.uid()` server-side — we do not pass it here. Returns the created row
 * as a MapRow.
 */
export async function createMap(
  id: string,
  name: string,
  data: MapData,
): Promise<MapRow> {
  const sb = getSupabaseClient();
  const { data: rows, error } = await sb
    .from('maps')
    .insert({ id, name, data, version: 1 })
    .select('id, name, version, updated_at');

  throwOnError(error);
  const created = (rows as DbRow[])[0]!;
  return toMapRow(created);
}

/**
 * Autosave with optimistic concurrency: updates the map's data blob only when
 * the row's current `version` matches `expectedVersion`. The `maps_touch`
 * BEFORE UPDATE trigger atomically bumps `version` and sets `updated_at`.
 *
 * Returns `{ status: 'saved', version }` on success, or `{ status: 'stale' }`
 * when the server's version no longer matches (another Editor saved first).
 * Throws on actual Supabase errors.
 */
export async function saveMapData(
  id: string,
  data: MapData,
  expectedVersion: number,
): Promise<SaveResult> {
  const sb = getSupabaseClient();
  const { data: rows, error } = await sb
    .from('maps')
    .update({ data })
    .eq('id', id)
    .eq('version', expectedVersion)
    .select('version');

  throwOnError(error);
  const matched = rows as Array<{ version: number }> | null;
  if (!matched || matched.length === 0) return { status: 'stale' };
  return { status: 'saved', version: matched[0]!.version };
}

/**
 * Unconditional overwrite: updates the map's data blob without a version check.
 * Used by re-import (which intentionally discards any concurrent edits).
 * Returns the new version assigned by the DB trigger.
 */
export async function overwriteMapData(
  id: string,
  data: MapData,
): Promise<{ version: number }> {
  const sb = getSupabaseClient();
  const { data: rows, error } = await sb
    .from('maps')
    .update({ data })
    .eq('id', id)
    .select('version');

  throwOnError(error);
  const updated = (rows as Array<{ version: number }>)[0]!;
  return { version: updated.version };
}

/**
 * Rename a map (updates the `name` column only). Does not touch `data` or
 * `version`.
 */
export async function renameMap(id: string, name: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb
    .from('maps')
    .update({ name })
    .eq('id', id);

  throwOnError(error);
}

/**
 * Delete a map row. RLS ensures only the owner can delete.
 */
export async function deleteMap(id: string): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb
    .from('maps')
    .delete()
    .eq('id', id);

  throwOnError(error);
}

/**
 * Duplicate a map: reads the source's current data then inserts a new row at
 * `newId` with `version = 1`. Throws if the source map is not found.
 */
export async function duplicateMap(
  sourceId: string,
  newId: string,
  newName: string,
): Promise<MapRow> {
  const source = await getMap(sourceId);
  if (!source) throw new Error(`Map not found: ${sourceId}`);
  return createMap(newId, newName, source.data);
}

// ── Sharing functions (map_shares table) ──────────────────────────────────────

/**
 * List all share records for a map. Only the map Owner can call this — RLS on
 * `map_shares` enforces it (the "owner manages shares" policy is the only ALL
 * policy; the recipient SELECT policy returns only the recipient's own row, so
 * an owner-only list requires the caller to be the map_owner).
 */
export async function listShares(
  mapOwner: string,
  mapId: string,
): Promise<ShareRow[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('map_shares')
    .select('email, role')
    .eq('map_owner', mapOwner)
    .eq('map_id', mapId);

  throwOnError(error);
  return ((data as DbShareRow[]) ?? []).map(toShareRow);
}

/**
 * Grant a User access to a map by email. If the email already has a share row
 * for this map the role is updated (upsert on the composite PK). Email is
 * normalised (trim + lowercase) before storage so RLS comparisons are
 * case-insensitive. Only the map Owner can call this — RLS enforces it.
 */
export async function addShare(
  mapOwner: string,
  mapId: string,
  email: string,
  role: 'viewer' | 'editor' = 'viewer',
): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb
    .from('map_shares')
    .upsert(
      { map_owner: mapOwner, map_id: mapId, email: normaliseEmail(email), role },
      { onConflict: 'map_owner,map_id,email' },
    );

  throwOnError(error);
}

/**
 * Revoke a User's access to a map. Email is normalised before the lookup so
 * the match is case-insensitive and consistent with how it was stored. Only the
 * map Owner can call this — RLS enforces it.
 */
export async function removeShare(
  mapOwner: string,
  mapId: string,
  email: string,
): Promise<void> {
  const sb = getSupabaseClient();
  const { error } = await sb
    .from('map_shares')
    .delete()
    .eq('map_owner', mapOwner)
    .eq('map_id', mapId)
    .eq('email', normaliseEmail(email));

  throwOnError(error);
}
