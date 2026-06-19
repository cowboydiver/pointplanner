import type { SupabaseClient } from '@supabase/supabase-js';
import type { MapData } from '../lib/maps';

// Server-side data-access for the canonical GitHub-synced map row. Unlike the
// rest of src/data, these helpers take an explicit client because the sync job
// (scripts/sync-roadmap.ts) runs in Node with a *service-role* client, not the
// browser publishable client in ./supabase. The client param also keeps this
// unit-testable with a mocked builder (see roadmapSync.test.ts).

const TABLE = 'maps';

/** Descriptor stored in `maps.source` to identify a tracker-mirroring row. */
export interface GithubSource {
  type: 'github';
  owner: string;
  repo: string;
  /** A `--filter` slug for a scoped map, or null for the whole-repo roadmap. */
  filter: string | null;
}

export function buildGithubSource(
  owner: string,
  repo: string,
  filter: string | null,
): GithubSource {
  return { type: 'github', owner, repo, filter };
}

export interface SyncResult {
  inserted: boolean;
  id: string;
  version: number;
}

/**
 * Upsert the canonical synced row for `source`. GitHub wins: if a row already
 * exists for this (owner, repo, filter) it is overwritten and its version
 * bumped; otherwise a fresh public row is inserted. The row carries no `owner`
 * (the service role has none), so clients can only read it.
 *
 * The job is the single writer, so a plain select-then-write is race-free; we
 * avoid ON CONFLICT because the uniqueness lives in a partial index that the
 * supabase-js upsert conflict target cannot express.
 */
export async function upsertSyncedMap(
  client: SupabaseClient,
  source: GithubSource,
  name: string,
  data: MapData,
): Promise<SyncResult> {
  const { data: rows, error } = await client
    .from(TABLE)
    .select('id, version, source')
    .eq('source->>owner', source.owner)
    .eq('source->>repo', source.repo);
  if (error) throw error;

  const existing = ((rows ?? []) as { id: string; version: number; source: GithubSource | null }[])
    .find(r => (r.source?.filter ?? null) === source.filter);

  if (existing) {
    const nextVersion = existing.version + 1;
    const { error: upErr } = await client
      .from(TABLE)
      .update({
        name,
        data,
        is_public: true,
        version: nextVersion,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    if (upErr) throw upErr;
    return { inserted: false, id: existing.id, version: nextVersion };
  }

  const { data: row, error: insErr } = await client
    .from(TABLE)
    .insert({ name, data, source, is_public: true })
    .select('id, version')
    .single();
  if (insErr) throw insErr;
  return { inserted: true, id: row.id as string, version: row.version as number };
}
