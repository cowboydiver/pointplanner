/**
 * mapsRepo — async data-access module for the `maps` Supabase table.
 *
 * All functions operate on the authenticated user's maps only. Row-Level
 * Security on the `maps` table enforces that automatically; no `owner` filter
 * is needed in these queries.
 *
 * Ordering: `listMaps` returns maps ordered by `updated_at DESC` (most-recently
 * saved first), which suits the "jump back to recent work" use-case in the UI.
 *
 * Error handling: Supabase errors are re-thrown as plain `Error`s with the
 * Supabase message. Callers decide how to surface them.
 *
 * Part 2 (MapRegistry + ProjectStore rewire) consumes this module — keep
 * function signatures stable.
 */

import type { MapData } from './maps';
import { getSupabaseClient } from './supabase';

// ── Public types ──────────────────────────────────────────────────────────────

export interface MapRow {
  id: string;
  name: string;
  version: number;
  updatedAt: string;
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
  name: string;
  version: number;
  updated_at: string;
}

function toMapRow(row: DbRow): MapRow {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    updatedAt: row.updated_at,
  };
}

function throwOnError(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * List the authenticated user's maps, ordered by updated_at DESC (most recent
 * first). Returns [] when the user has no maps.
 */
export async function listMaps(): Promise<MapRow[]> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('maps')
    .select('id, name, version, updated_at')
    .order('updated_at', { ascending: false });

  throwOnError(error);
  return ((data as DbRow[]) ?? []).map(toMapRow);
}

/**
 * Fetch a single map's data and version. Returns null when not found.
 */
export async function getMap(id: string): Promise<MapDataWithVersion | null> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from('maps')
    .select('data, version')
    .eq('id', id);

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
