import { describe, it, expect } from 'vitest';
import { parseMapParam, stashPendingMap, takePendingMap } from './pendingMap';

// A minimal in-memory Storage double (mirrors the localImport tests' approach).
function makeStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    has: (k: string) => store.has(k),
  };
}

describe('parseMapParam', () => {
  it('reads the map id from a query string', () => {
    expect(parseMapParam('?map=abc123')).toBe('abc123');
    expect(parseMapParam('?x=1&map=abc&y=2')).toBe('abc');
  });

  it('returns null when absent or empty', () => {
    expect(parseMapParam('')).toBeNull();
    expect(parseMapParam('?x=1')).toBeNull();
    expect(parseMapParam('?map=')).toBeNull();
    expect(parseMapParam('?map=%20%20')).toBeNull();
  });
});

describe('stash/takePendingMap', () => {
  it('round-trips a pending id and clears it on read', () => {
    const storage = makeStorage();
    stashPendingMap(storage, 'map-7');
    expect(storage.has('pointplanner.pendingMap')).toBe(true);

    expect(takePendingMap(storage)).toBe('map-7');
    // One-shot: cleared after the first read.
    expect(takePendingMap(storage)).toBeNull();
    expect(storage.has('pointplanner.pendingMap')).toBe(false);
  });

  it('returns null when nothing is stashed', () => {
    expect(takePendingMap(makeStorage())).toBeNull();
  });
});
