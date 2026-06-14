import { describe, it, expect, vi, beforeEach } from 'vitest';

// A chainable query-builder double. Every non-terminal method returns the same
// builder; the builder itself is awaitable (thenable) and the `single`/
// `maybeSingle` terminals resolve to the configured result. This mirrors just
// enough of the supabase-js query API for mapsRepo's calls.
function makeBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'update', 'delete', 'upsert', 'eq', 'order']) {
    builder[m] = vi.fn(() => builder);
  }
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  // Make `await builder` resolve to the result (for terminal .eq()/.order()).
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result);
  return builder;
}

const fromMock = vi.fn();
const getUserMock = vi.fn();

vi.mock('./supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
    auth: { getUser: (...args: unknown[]) => getUserMock(...args) },
  },
}));

import {
  listMaps,
  loadMap,
  createMap,
  saveMap,
  renameMap,
  listShares,
  addShare,
  removeShare,
} from './mapsRepo';
import { createBlankMapData } from './maps';

// Default identity helper: the signed-in user.
function signInAs(id: string, email: string) {
  getUserMock.mockResolvedValue({ data: { user: { id, email } }, error: null });
}

// Route `supabase.from(table)` to a per-table builder so tests that touch both
// `maps` and `map_shares` (role resolution) can configure each independently.
function routeFrom(builders: Record<string, ReturnType<typeof makeBuilder>>) {
  fromMock.mockImplementation((table: string) => {
    const b = builders[table];
    if (!b) throw new Error('unexpected table: ' + table);
    return b;
  });
}

beforeEach(() => {
  fromMock.mockReset();
  getUserMock.mockReset();
  signInAs('me', 'me@example.com');
});

describe('listMaps', () => {
  it('labels owned rows owner and shared rows by their share role', async () => {
    routeFrom({
      maps: makeBuilder({
        data: [
          { id: 'a', name: 'Alpha', owner: 'me' },
          { id: 'b', name: 'Beta', owner: 'someone-else' },
        ],
        error: null,
      }),
      map_shares: makeBuilder({ data: [{ map_id: 'b', role: 'viewer' }], error: null }),
    });

    const metas = await listMaps();
    expect(metas).toEqual([
      { id: 'a', name: 'Alpha', role: 'owner' },
      { id: 'b', name: 'Beta', role: 'viewer' },
    ]);
  });

  it('labels an editor-shared map with role "editor"', async () => {
    routeFrom({
      maps: makeBuilder({
        data: [{ id: 'b', name: 'Beta', owner: 'someone-else' }],
        error: null,
      }),
      map_shares: makeBuilder({ data: [{ map_id: 'b', role: 'editor' }], error: null }),
    });

    const metas = await listMaps();
    expect(metas).toEqual([{ id: 'b', name: 'Beta', role: 'editor' }]);
  });

  it('throws on error', async () => {
    routeFrom({ maps: makeBuilder({ data: null, error: { message: 'boom' } }) });
    await expect(listMaps()).rejects.toBeTruthy();
  });
});

describe('loadMap', () => {
  it('returns role "owner" when the row owner is the current user', async () => {
    const data = createBlankMapData('X');
    routeFrom({
      maps: makeBuilder({ data: { id: 'm1', name: 'X', data, version: 7, owner: 'me' }, error: null }),
    });
    const rec = await loadMap('m1');
    expect(rec).toEqual({ id: 'm1', name: 'X', data, version: 7, role: 'owner' });
  });

  it('returns role "viewer" when not the owner but a viewer share exists', async () => {
    const data = createBlankMapData('X');
    routeFrom({
      maps: makeBuilder({ data: { id: 'm1', name: 'X', data, version: 7, owner: 'other' }, error: null }),
      map_shares: makeBuilder({ data: [{ map_id: 'm1', role: 'viewer' }], error: null }),
    });
    const rec = await loadMap('m1');
    expect(rec).toEqual({ id: 'm1', name: 'X', data, version: 7, role: 'viewer' });
  });

  it('returns role "editor" when not the owner but an editor share exists', async () => {
    // The store treats role !== 'viewer' as editable, so an editor share must
    // surface as 'editor' (not read-only) — #20.
    const data = createBlankMapData('X');
    routeFrom({
      maps: makeBuilder({ data: { id: 'm1', name: 'X', data, version: 7, owner: 'other' }, error: null }),
      map_shares: makeBuilder({ data: [{ map_id: 'm1', role: 'editor' }], error: null }),
    });
    const rec = await loadMap('m1');
    expect(rec).toEqual({ id: 'm1', name: 'X', data, version: 7, role: 'editor' });
  });

  it('returns null when the row is missing', async () => {
    routeFrom({ maps: makeBuilder({ data: null, error: null }) });
    expect(await loadMap('nope')).toBeNull();
  });
});

describe('createMap', () => {
  it('inserts name + data and returns the new {id, name}', async () => {
    const builder = makeBuilder({ data: { id: 'new-id', name: 'Fresh' }, error: null });
    fromMock.mockReturnValue(builder);
    const data = createBlankMapData('Fresh');
    const meta = await createMap('Fresh', data);
    expect(meta).toEqual({ id: 'new-id', name: 'Fresh' });
    expect(builder.insert).toHaveBeenCalledWith({ name: 'Fresh', data });
  });
});

describe('saveMap', () => {
  it('writes version = baseVersion + 1, guards on the loaded version, and returns the new version', async () => {
    // Conditional update matches the row (one row returned) → success.
    const builder = makeBuilder({ data: [{ version: 4 }], error: null });
    fromMock.mockReturnValue(builder);
    const data = createBlankMapData('Y');
    const result = await saveMap('m1', data, 3);
    expect(result).toEqual({ ok: true, version: 4 });
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data, version: 4 }),
    );
    // The optimistic-concurrency guard: the save is conditioned on version === base.
    expect(builder.eq).toHaveBeenCalledWith('version', 3);
  });

  it('returns { ok: false, reason: "stale" } when the conditional update matches no rows', async () => {
    // Server moved on → the .eq('version', base) guard matches nothing.
    const builder = makeBuilder({ data: [], error: null });
    fromMock.mockReturnValue(builder);
    const result = await saveMap('m1', createBlankMapData('Y'), 1);
    expect(result).toEqual({ ok: false, reason: 'stale' });
  });

  it('returns an error result (not a throw) when the update fails', async () => {
    fromMock.mockReturnValue(makeBuilder({ data: null, error: { message: 'denied' } }));
    const result = await saveMap('m1', createBlankMapData('Y'), 1);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('error');
    expect(result.message).toBe('denied');
  });

  it('two clients with diverging versions: the second save is rejected as stale', async () => {
    const data = createBlankMapData('Shared');

    // Client A loaded v1 and saves. The row still matches → success, server is now v2.
    const builderA = makeBuilder({ data: [{ version: 2 }], error: null });
    fromMock.mockReturnValue(builderA);
    const resultA = await saveMap('shared', data, 1);
    expect(resultA).toEqual({ ok: true, version: 2 });
    expect(builderA.eq).toHaveBeenCalledWith('version', 1);

    // Client B is still on v1 and saves. The server is now v2, so the
    // .eq('version', 1) guard matches no rows → stale (B's write is not applied).
    const builderB = makeBuilder({ data: [], error: null });
    fromMock.mockReturnValue(builderB);
    const resultB = await saveMap('shared', data, 1);
    expect(resultB).toEqual({ ok: false, reason: 'stale' });
    expect(builderB.eq).toHaveBeenCalledWith('version', 1);
  });
});

describe('renameMap', () => {
  it('updates the name', async () => {
    const builder = makeBuilder({ data: null, error: null });
    fromMock.mockReturnValue(builder);
    await renameMap('m1', 'Renamed');
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Renamed' }),
    );
  });
});

describe('sharing', () => {
  it('listShares maps rows to ShareEntry[]', async () => {
    const builder = makeBuilder({
      data: [
        { email: 'a@x.com', role: 'viewer' },
        { email: 'b@x.com', role: 'editor' },
      ],
      error: null,
    });
    fromMock.mockReturnValue(builder);
    const shares = await listShares('m1');
    expect(shares).toEqual([
      { email: 'a@x.com', role: 'viewer' },
      { email: 'b@x.com', role: 'editor' },
    ]);
    expect(builder.eq).toHaveBeenCalledWith('map_id', 'm1');
  });

  it('addShare lowercases the email before writing', async () => {
    const builder = makeBuilder({ data: null, error: null });
    fromMock.mockReturnValue(builder);
    await addShare('m1', '  Person@Example.COM ', 'viewer');
    expect(builder.upsert).toHaveBeenCalledWith(
      { map_id: 'm1', email: 'person@example.com', role: 'viewer' },
      { onConflict: 'map_id,email' },
    );
  });

  it('addShare writes role "editor" with the email lowercased', async () => {
    const builder = makeBuilder({ data: null, error: null });
    fromMock.mockReturnValue(builder);
    await addShare('m1', '  Editor@Example.COM ', 'editor');
    expect(builder.upsert).toHaveBeenCalledWith(
      { map_id: 'm1', email: 'editor@example.com', role: 'editor' },
      { onConflict: 'map_id,email' },
    );
  });

  it('switching a role: re-adding the same email upserts with the new role', async () => {
    // Switching Viewer→Editor is just addShare again; the upsert on
    // (map_id,email) changes the role in place rather than inserting a duplicate.
    const builder = makeBuilder({ data: null, error: null });
    fromMock.mockReturnValue(builder);
    await addShare('m1', 'person@example.com', 'editor');
    expect(builder.upsert).toHaveBeenCalledWith(
      { map_id: 'm1', email: 'person@example.com', role: 'editor' },
      { onConflict: 'map_id,email' },
    );
  });

  // The "two Editors diverging → stale, not a silent overwrite" guarantee is
  // identical to the optimistic-concurrency path covered by the saveMap
  // "two clients with diverging versions" test above (#18). Editor saves go
  // through the same saveMap guard, so it is not duplicated here.

  it('removeShare deletes by map_id + lowercased email', async () => {
    const builder = makeBuilder({ data: null, error: null });
    fromMock.mockReturnValue(builder);
    await removeShare('m1', 'Person@Example.COM');
    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith('map_id', 'm1');
    expect(builder.eq).toHaveBeenCalledWith('email', 'person@example.com');
  });
});
