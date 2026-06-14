import { supabase } from './supabase';
import type { MapData, MapMeta } from './maps';

// Data-access layer for cloud-backed maps (issue #16). Every query below is
// scoped to the current user automatically by the `maps` RLS policies — we never
// pass `owner` from the client; the column default `auth.uid()` sets it.

export interface MapRecord {
  id: string;
  name: string;
  data: MapData;
  version: number;
}

export interface SaveResult {
  ok: boolean;
  version?: number; // new version on success
  reason?: 'stale' | 'error';
  message?: string;
}

const TABLE = 'maps';

/** Owned maps, most-recently-updated first. */
export async function listMaps(): Promise<MapMeta[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('id, name')
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map(row => ({ id: row.id as string, name: row.name as string }));
}

export async function loadMap(id: string): Promise<MapRecord | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('id, name, data, version')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id as string,
    name: data.name as string,
    data: data.data as MapData,
    version: data.version as number,
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
 * #16: plain last-writer-wins update (no version guard yet — that conditional
 * check is added in #18). Bumps `version` to `baseVersion + 1` and `updated_at`.
 */
export async function saveMap(
  id: string,
  data: MapData,
  baseVersion: number,
): Promise<SaveResult> {
  const nextVersion = baseVersion + 1;
  const { error } = await supabase
    .from(TABLE)
    .update({ data, version: nextVersion, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) return { ok: false, reason: 'error', message: error.message };
  return { ok: true, version: nextVersion };
}
