import { describe, it, expect, vi, beforeEach } from 'vitest';

// A chainable query-builder double. Every non-terminal method returns the same
// builder; the builder itself is awaitable (thenable) and the `single`/
// `maybeSingle` terminals resolve to the configured result. This mirrors just
// enough of the supabase-js query API for mapsRepo's calls.
function makeBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'order']) {
    builder[m] = vi.fn(() => builder);
  }
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  // Make `await builder` resolve to the result (for terminal .eq()/.order()).
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result);
  return builder;
}

const fromMock = vi.fn();

vi.mock('./supabase', () => ({
  supabase: { from: (...args: unknown[]) => fromMock(...args) },
}));

import { listMaps, loadMap, createMap, saveMap, renameMap } from './mapsRepo';
import { createBlankMapData } from './maps';

beforeEach(() => {
  fromMock.mockReset();
});

describe('listMaps', () => {
  it('maps owned rows to MapMeta', async () => {
    fromMock.mockReturnValue(
      makeBuilder({ data: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }], error: null }),
    );
    const metas = await listMaps();
    expect(metas).toEqual([{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }]);
  });

  it('throws on error', async () => {
    fromMock.mockReturnValue(makeBuilder({ data: null, error: { message: 'boom' } }));
    await expect(listMaps()).rejects.toBeTruthy();
  });
});

describe('loadMap', () => {
  it('returns a MapRecord', async () => {
    const data = createBlankMapData('X');
    fromMock.mockReturnValue(makeBuilder({ data: { id: 'm1', name: 'X', data, version: 7 }, error: null }));
    const rec = await loadMap('m1');
    expect(rec).toEqual({ id: 'm1', name: 'X', data, version: 7 });
  });

  it('returns null when the row is missing', async () => {
    fromMock.mockReturnValue(makeBuilder({ data: null, error: null }));
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
  it('writes version = baseVersion + 1 and returns the new version', async () => {
    const builder = makeBuilder({ data: null, error: null });
    fromMock.mockReturnValue(builder);
    const data = createBlankMapData('Y');
    const result = await saveMap('m1', data, 3);
    expect(result).toEqual({ ok: true, version: 4 });
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data, version: 4 }),
    );
  });

  it('returns an error result (not a throw) when the update fails', async () => {
    fromMock.mockReturnValue(makeBuilder({ data: null, error: { message: 'denied' } }));
    const result = await saveMap('m1', createBlankMapData('Y'), 1);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('error');
    expect(result.message).toBe('denied');
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
