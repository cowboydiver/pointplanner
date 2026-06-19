import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildGithubSource, upsertSyncedMap, type GithubSource } from './roadmapSync';
import { createBlankMapData } from '../lib/maps';

// A chainable builder double: every non-terminal returns itself, the builder is
// awaitable (resolves to `result`), and `single` resolves to `result`. Mirrors
// just enough of supabase-js for upsertSyncedMap's select/update/insert calls.
function makeBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'update', 'eq']) {
    builder[m] = vi.fn(() => builder);
  }
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result);
  return builder;
}

// A client whose `from()` returns successive queued builders, one per call.
function clientWith(...builders: ReturnType<typeof makeBuilder>[]): {
  client: SupabaseClient;
  from: ReturnType<typeof vi.fn>;
} {
  const queue = [...builders];
  const from = vi.fn(() => {
    const b = queue.shift();
    if (!b) throw new Error('unexpected extra from() call');
    return b;
  });
  return { client: { from } as unknown as SupabaseClient, from };
}

const SOURCE: GithubSource = { type: 'github', owner: 'acme', repo: 'widget', filter: null };

describe('buildGithubSource', () => {
  it('builds a github descriptor with a null filter for the whole-repo map', () => {
    expect(buildGithubSource('acme', 'widget', null)).toEqual(SOURCE);
  });

  it('records the filter slug for a scoped map', () => {
    expect(buildGithubSource('acme', 'widget', 'v1-0')).toEqual({
      type: 'github',
      owner: 'acme',
      repo: 'widget',
      filter: 'v1-0',
    });
  });
});

describe('upsertSyncedMap', () => {
  it('overwrites the matching row and bumps its version (GitHub wins)', async () => {
    const data = createBlankMapData('Roadmap');
    const select = makeBuilder({
      data: [{ id: 'r1', version: 3, source: SOURCE }],
      error: null,
    });
    const update = makeBuilder({ data: null, error: null });
    const { client } = clientWith(select, update);

    const result = await upsertSyncedMap(client, SOURCE, 'Roadmap', data);

    expect(result).toEqual({ inserted: false, id: 'r1', version: 4 });
    expect(update.update).toHaveBeenCalledWith(
      expect.objectContaining({ data, name: 'Roadmap', is_public: true, version: 4 }),
    );
    expect(update.eq).toHaveBeenCalledWith('id', 'r1');
  });

  it('inserts a fresh public row when no source row exists', async () => {
    const data = createBlankMapData('Roadmap');
    const select = makeBuilder({ data: [], error: null });
    const insert = makeBuilder({ data: { id: 'r2', version: 1 }, error: null });
    const { client } = clientWith(select, insert);

    const result = await upsertSyncedMap(client, SOURCE, 'Roadmap', data);

    expect(result).toEqual({ inserted: true, id: 'r2', version: 1 });
    expect(insert.insert).toHaveBeenCalledWith({
      name: 'Roadmap',
      data,
      source: SOURCE,
      is_public: true,
    });
  });

  it('matches the row by filter, not just owner/repo', async () => {
    // Same owner/repo, but the existing row is the whole-repo map (filter null);
    // syncing a scoped map (filter "v1") must NOT overwrite it — it inserts.
    const scoped: GithubSource = { ...SOURCE, filter: 'v1' };
    const data = createBlankMapData('Scoped');
    const select = makeBuilder({
      data: [{ id: 'whole', version: 9, source: SOURCE }],
      error: null,
    });
    const insert = makeBuilder({ data: { id: 'scoped-row', version: 1 }, error: null });
    const { client } = clientWith(select, insert);

    const result = await upsertSyncedMap(client, scoped, 'Scoped', data);

    expect(result).toEqual({ inserted: true, id: 'scoped-row', version: 1 });
  });

  it('throws when the lookup query errors', async () => {
    const select = makeBuilder({ data: null, error: { message: 'boom' } });
    const { client } = clientWith(select);
    await expect(
      upsertSyncedMap(client, SOURCE, 'Roadmap', createBlankMapData('R')),
    ).rejects.toBeTruthy();
  });
});
