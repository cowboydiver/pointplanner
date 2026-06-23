// Mirror sync orchestration (Deno runtime). Fetches a repo's issues with an
// installation token, runs the pure transform, and writes the result back to the
// map row with the service-role client. Shared by the webhook (re-sync) and
// connect-repo (initial snapshot) functions.
import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { githubToMapReport, scopeInputByFilter } from '../../../src/lib/githubToMap.ts';
import { createBlankMapData } from '../../../src/lib/maps.ts';
import { fetchRepoInput } from './githubFetch.ts';
import { getInstallationToken } from './githubAuth.ts';

export interface SyncConfig {
  appId: string;
  privateKeyPem: string;
}

interface MapSourceRow {
  repo_owner: string;
  repo_name: string;
  installation_id: number;
  filter: string | null;
}

/**
 * Re-sync one mirror map: fetch → transform → service-role write (data,
 * version++, is_mirror=true), and record the sync status on map_sources. On
 * failure, records the error on map_sources before rethrowing so the owner sees
 * it in the banner.
 */
export async function syncMap(admin: SupabaseClient, config: SyncConfig, mapId: string): Promise<void> {
  const { data: src, error } = await admin
    .from('map_sources')
    .select('repo_owner, repo_name, installation_id, filter')
    .eq('map_id', mapId)
    .single<MapSourceRow>();
  if (error || !src) throw new Error(`no map_source for ${mapId}: ${error?.message ?? 'missing'}`);

  try {
    const token = await getInstallationToken(config.appId, config.privateKeyPem, src.installation_id);
    let input = await fetchRepoInput(token, src.repo_owner, src.repo_name);
    if (src.filter) {
      input = scopeInputByFilter(input, src.filter);
      input = { ...input, repo: { ...input.repo, name: `${input.repo?.name ?? 'Roadmap'} — ${src.filter}` } };
    }
    const { map } = githubToMapReport(input);

    const { data: cur } = await admin.from('maps').select('version').eq('id', mapId).single<{ version: number }>();
    const nextVersion = (cur?.version ?? 1) + 1;
    const { error: upErr } = await admin
      .from('maps')
      .update({ data: map, version: nextVersion, is_mirror: true, updated_at: new Date().toISOString() })
      .eq('id', mapId);
    if (upErr) throw upErr;

    await admin
      .from('map_sources')
      .update({ last_synced_at: new Date().toISOString(), last_sync_status: 'ok', last_sync_error: null })
      .eq('map_id', mapId);
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    await admin
      .from('map_sources')
      .update({ last_synced_at: new Date().toISOString(), last_sync_status: 'error', last_sync_error: message })
      .eq('map_id', mapId);
    throw err;
  }
}

export interface CreateMirrorParams {
  ownerId: string;
  repoOwner: string;
  repoName: string;
  repoId: number;
  installationId: number;
  filter: string | null;
}

/**
 * Create a new mirror map for a user and run its first sync. Inserts the `maps`
 * row (owned by the connecting user, flagged is_mirror) and the `map_sources`
 * row, then calls {@link syncMap} to populate it. Returns the new map's id+name.
 */
export async function createMirror(
  admin: SupabaseClient,
  config: SyncConfig,
  params: CreateMirrorParams,
): Promise<{ id: string; name: string }> {
  const name = params.filter
    ? `${params.repoOwner}/${params.repoName} — ${params.filter}`
    : `${params.repoOwner}/${params.repoName}`;

  const { data: map, error: insErr } = await admin
    .from('maps')
    .insert({ owner: params.ownerId, name, data: createBlankMapData(name), is_mirror: true })
    .select('id, name')
    .single<{ id: string; name: string }>();
  if (insErr || !map) throw new Error(`create mirror map failed: ${insErr?.message ?? 'no row'}`);

  const { error: srcErr } = await admin.from('map_sources').insert({
    map_id: map.id,
    owner: params.ownerId,
    provider: 'github',
    repo_owner: params.repoOwner,
    repo_name: params.repoName,
    repo_id: params.repoId,
    installation_id: params.installationId,
    filter: params.filter,
  });
  if (srcErr) {
    // Roll back the orphaned map so a retry starts clean.
    await admin.from('maps').delete().eq('id', map.id);
    throw new Error(`create map_source failed: ${srcErr.message}`);
  }

  try {
    await syncMap(admin, config, map.id);
  } catch (err) {
    // The initial sync failed (bad token, GitHub fetch error, etc.). connect-repo
    // is meant to be atomic, so roll back BOTH rows rather than leaving the user
    // an empty mirror map that surfaces on their next listMaps() and could be
    // populated by a later webhook. syncMap already recorded the error status,
    // but the rows are about to be deleted, so that's moot.
    await admin.from('map_sources').delete().eq('map_id', map.id);
    await admin.from('maps').delete().eq('id', map.id);
    throw err;
  }
  return map;
}
