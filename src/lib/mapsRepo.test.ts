/**
 * Unit tests for mapsRepo — async Supabase data-access module.
 *
 * `./supabase` is mocked so no live Supabase project or credentials are needed.
 *
 * Mock design: `getSupabaseClient()` returns an object with `from(table)` that
 * builds a chainable Proxy. Each chainable method records itself and returns a
 * new Proxy. When the chain is awaited ("then" is accessed), the mock dequeues
 * the next `{ data, error }` from a FIFO queue and resolves with it.  This lets
 * multi-await functions (like duplicateMap) be tested without timing tricks.
 *
 * Inspection: `getLastCall()` returns { table, ops } for the most-recently
 * resolved chain, letting tests assert which table was targeted and which
 * operations were chained with which arguments.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MapData } from './maps';

// ── Fake Supabase query builder ───────────────────────────────────────────────

interface FakeResult {
  data: unknown;
  error: { message: string } | null;
}

interface Op { method: string; args: unknown[] }

interface CallRecord { table: string; ops: Op[] }

// Shared state across the mock — reset in beforeEach.
let _resultQueue: FakeResult[] = [];
const _calls: CallRecord[] = [];

/** Push results to be dequeued in order (one per terminal await). */
function queueResult(...results: FakeResult[]) {
  _resultQueue.push(...results);
}

/** Return the Nth-from-last completed call (0 = most recent). */
function getCall(fromEnd = 0): CallRecord {
  return _calls[_calls.length - 1 - fromEnd]!;
}

function makeFakeBuilder(table: string, ops: Op[]): object {
  return new Proxy({}, {
    get(_t, prop: string) {
      if (prop === 'then') {
        // Being awaited — dequeue the next result and record this call.
        const result = _resultQueue.shift() ?? { data: null, error: { message: 'No result queued' } };
        _calls.push({ table, ops: [...ops] });
        return (resolve: (v: FakeResult) => void) => resolve(result);
      }
      // Chainable — record the method and return a new builder.
      return (...args: unknown[]) => makeFakeBuilder(table, [...ops, { method: prop, args }]);
    },
  });
}

vi.mock('./supabase', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => makeFakeBuilder(table, []),
  }),
}));

// ── Import subject under test ─────────────────────────────────────────────────

import {
  listMaps,
  getMap,
  createMap,
  saveMapData,
  overwriteMapData,
  renameMap,
  deleteMap,
  duplicateMap,
} from './mapsRepo';

// ── Helpers ───────────────────────────────────────────────────────────────────

const sampleData: MapData = {
  project: { name: 'Test', subtitle: '' },
  lines: [],
  stations: [],
  edges: [],
};

function opNames(call: CallRecord): string[] {
  return call.ops.map(o => o.method);
}

function findOp(call: CallRecord, method: string): Op | undefined {
  return call.ops.find(o => o.method === method);
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _resultQueue = [];
  _calls.length = 0;
});

// ── listMaps ──────────────────────────────────────────────────────────────────

describe('listMaps', () => {
  it('maps snake_case rows to MapRow[] with camelCase updatedAt', async () => {
    queueResult({
      data: [
        { id: 'map-1', name: 'Alpha', version: 3, updated_at: '2024-01-01T00:00:00Z' },
        { id: 'map-2', name: 'Beta',  version: 1, updated_at: '2024-01-02T00:00:00Z' },
      ],
      error: null,
    });

    const rows = await listMaps();

    expect(rows).toEqual([
      { id: 'map-1', name: 'Alpha', version: 3, updatedAt: '2024-01-01T00:00:00Z' },
      { id: 'map-2', name: 'Beta',  version: 1, updatedAt: '2024-01-02T00:00:00Z' },
    ]);
    expect(getCall().table).toBe('maps');
  });

  it('returns [] when the query returns no rows', async () => {
    queueResult({ data: [], error: null });
    expect(await listMaps()).toEqual([]);
  });

  it('throws the supabase error message when the query fails', async () => {
    queueResult({ data: null, error: { message: 'permission denied' } });
    await expect(listMaps()).rejects.toThrow('permission denied');
  });
});

// ── getMap ────────────────────────────────────────────────────────────────────

describe('getMap', () => {
  it('returns { data, version } for a hit', async () => {
    queueResult({ data: [{ data: sampleData, version: 5 }], error: null });

    const result = await getMap('map-1');

    expect(result).toEqual({ data: sampleData, version: 5 });
    const call = getCall();
    expect(call.table).toBe('maps');
    const eqOp = findOp(call, 'eq');
    expect(eqOp?.args).toEqual(['id', 'map-1']);
  });

  it('returns null when the map is not found (empty array)', async () => {
    queueResult({ data: [], error: null });
    expect(await getMap('missing')).toBeNull();
  });

  it('throws when supabase returns an error', async () => {
    queueResult({ data: null, error: { message: 'db error' } });
    await expect(getMap('x')).rejects.toThrow('db error');
  });
});

// ── createMap ─────────────────────────────────────────────────────────────────

describe('createMap', () => {
  it('inserts with version=1 and returns the mapped MapRow', async () => {
    queueResult({
      data: [{ id: 'new-map', name: 'New Map', version: 1, updated_at: '2024-06-01T00:00:00Z' }],
      error: null,
    });

    const row = await createMap('new-map', 'New Map', sampleData);

    expect(row).toEqual({ id: 'new-map', name: 'New Map', version: 1, updatedAt: '2024-06-01T00:00:00Z' });
    const call = getCall();
    expect(call.table).toBe('maps');
    const insertOp = findOp(call, 'insert');
    expect(insertOp).toBeDefined();
    const payload = insertOp!.args[0] as Record<string, unknown>;
    expect(payload.id).toBe('new-map');
    expect(payload.name).toBe('New Map');
    expect(payload.version).toBe(1);
    expect(payload.data).toBe(sampleData);
  });

  it('throws when supabase returns an error', async () => {
    queueResult({ data: null, error: { message: 'insert failed' } });
    await expect(createMap('x', 'X', sampleData)).rejects.toThrow('insert failed');
  });
});

// ── saveMapData ───────────────────────────────────────────────────────────────

describe('saveMapData', () => {
  it('sends .eq("version", expectedVersion) in the query chain', async () => {
    queueResult({ data: [{ version: 4 }], error: null });

    await saveMapData('map-1', sampleData, 3);

    const call = getCall();
    // There are two .eq() calls: one for id, one for version.
    const eqOps = call.ops.filter(o => o.method === 'eq');
    const versionEq = eqOps.find(o => o.args[0] === 'version');
    expect(versionEq).toBeDefined();
    expect(versionEq!.args).toEqual(['version', 3]);
  });

  it('returns {status:"saved", version} when a row comes back', async () => {
    queueResult({ data: [{ version: 4 }], error: null });

    const result = await saveMapData('map-1', sampleData, 3);

    expect(result).toEqual({ status: 'saved', version: 4 });
    const call = getCall();
    expect(call.table).toBe('maps');
    const updateOp = findOp(call, 'update');
    expect(updateOp).toBeDefined();
    const payload = updateOp!.args[0] as Record<string, unknown>;
    expect(payload.data).toBe(sampleData);
    // version + updated_at are maintained by the maps_touch DB trigger, not sent
    // in the payload (PostgREST would store a literal string, not evaluate SQL).
    expect(payload.version).toBeUndefined();
    expect(payload.updated_at).toBeUndefined();
  });

  it('returns {status:"stale"} when result rows are empty (version mismatch)', async () => {
    queueResult({ data: [], error: null });

    const result = await saveMapData('map-1', sampleData, 3);

    expect(result).toEqual({ status: 'stale' });
  });

  it('scopes the update to the correct map id', async () => {
    queueResult({ data: [{ version: 2 }], error: null });
    await saveMapData('my-map', sampleData, 1);
    const eqOps = getCall().ops.filter(o => o.method === 'eq');
    const idEq = eqOps.find(o => o.args[0] === 'id');
    expect(idEq?.args).toEqual(['id', 'my-map']);
  });

  it('throws on supabase error', async () => {
    queueResult({ data: null, error: { message: 'update failed' } });
    await expect(saveMapData('x', sampleData, 1)).rejects.toThrow('update failed');
  });
});

// ── overwriteMapData ──────────────────────────────────────────────────────────

describe('overwriteMapData', () => {
  it('issues an unconditional update (no version eq) and returns the new version', async () => {
    queueResult({ data: [{ version: 5 }], error: null });

    const result = await overwriteMapData('map-1', sampleData);

    expect(result).toEqual({ version: 5 });
    const call = getCall();
    expect(call.table).toBe('maps');
    const updateOp = findOp(call, 'update');
    expect(updateOp).toBeDefined();
    const payload = updateOp!.args[0] as Record<string, unknown>;
    expect(payload.data).toBe(sampleData);
    // No version eq filter — unconditional overwrite.
    const eqOps = call.ops.filter(o => o.method === 'eq');
    const versionEq = eqOps.find(o => o.args[0] === 'version');
    expect(versionEq).toBeUndefined();
  });

  it('scopes the update to the correct map id', async () => {
    queueResult({ data: [{ version: 3 }], error: null });
    await overwriteMapData('target-map', sampleData);
    const eqOps = getCall().ops.filter(o => o.method === 'eq');
    const idEq = eqOps.find(o => o.args[0] === 'id');
    expect(idEq?.args).toEqual(['id', 'target-map']);
  });

  it('throws on supabase error', async () => {
    queueResult({ data: null, error: { message: 'overwrite failed' } });
    await expect(overwriteMapData('x', sampleData)).rejects.toThrow('overwrite failed');
  });
});

// ── renameMap ─────────────────────────────────────────────────────────────────

describe('renameMap', () => {
  it('issues an update scoped to the map id with the new name', async () => {
    queueResult({ data: [{}], error: null });

    await renameMap('map-1', 'Renamed');

    const call = getCall();
    expect(call.table).toBe('maps');
    expect(opNames(call)).toContain('update');
    const updateOp = findOp(call, 'update');
    expect((updateOp!.args[0] as Record<string, unknown>).name).toBe('Renamed');
    const eqOp = findOp(call, 'eq');
    expect(eqOp?.args).toEqual(['id', 'map-1']);
  });

  it('throws when supabase returns an error', async () => {
    queueResult({ data: null, error: { message: 'rename failed' } });
    await expect(renameMap('x', 'Y')).rejects.toThrow('rename failed');
  });
});

// ── deleteMap ─────────────────────────────────────────────────────────────────

describe('deleteMap', () => {
  it('issues a delete scoped to the map id', async () => {
    queueResult({ data: [{}], error: null });

    await deleteMap('map-1');

    const call = getCall();
    expect(call.table).toBe('maps');
    expect(opNames(call)).toContain('delete');
    const eqOp = findOp(call, 'eq');
    expect(eqOp?.args).toEqual(['id', 'map-1']);
  });

  it('throws when supabase returns an error', async () => {
    queueResult({ data: null, error: { message: 'delete failed' } });
    await expect(deleteMap('x')).rejects.toThrow('delete failed');
  });
});

// ── duplicateMap ──────────────────────────────────────────────────────────────

describe('duplicateMap', () => {
  it('reads source data then inserts a copy at newId with version=1', async () => {
    // First await = getMap (select); second await = createMap (insert)
    queueResult(
      { data: [{ data: sampleData, version: 7 }], error: null },
      { data: [{ id: 'my-copy', name: 'My Copy', version: 1, updated_at: '2024-06-01T00:00:00Z' }], error: null },
    );

    const row = await duplicateMap('source', 'my-copy', 'My Copy');

    expect(row).toEqual({ id: 'my-copy', name: 'My Copy', version: 1, updatedAt: '2024-06-01T00:00:00Z' });

    // Assert the insert call (most recent)
    const insertCall = getCall(0);
    expect(insertCall.table).toBe('maps');
    const insertOp = findOp(insertCall, 'insert');
    expect(insertOp).toBeDefined();
    const payload = insertOp!.args[0] as Record<string, unknown>;
    expect(payload.id).toBe('my-copy');
    expect(payload.name).toBe('My Copy');
    expect(payload.version).toBe(1);
    expect(payload.data).toEqual(sampleData);

    // Assert the select call (second-to-last)
    const selectCall = getCall(1);
    expect(selectCall.table).toBe('maps');
    const eqOp = findOp(selectCall, 'eq');
    expect(eqOp?.args).toEqual(['id', 'source']);
  });

  it('throws when the source map is not found', async () => {
    queueResult({ data: [], error: null });
    await expect(duplicateMap('missing', 'copy', 'Copy')).rejects.toThrow();
  });

  it('throws when supabase returns an error on the source fetch', async () => {
    queueResult({ data: null, error: { message: 'fetch error' } });
    await expect(duplicateMap('bad-src', 'copy', 'Copy')).rejects.toThrow('fetch error');
  });
});
