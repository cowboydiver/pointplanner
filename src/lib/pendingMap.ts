// Deep-link to a shared map (the share-invite feature). An invite email links to
// `…/?map=<id>`. The auth round-trip (magic-link / invite confirmation) lands the
// recipient back on the app with that query param still present, and the app then
// opens that map. These helpers are pure (they take a `Storage` double and a raw
// query string) so the URL handling can be unit-tested without `window`.

const PENDING_KEY = 'pointplanner.pendingMap';

/**
 * Extract the `map` id from a `location.search` string (e.g. `"?map=abc&x=1"`).
 * Returns null when absent or empty. Never throws.
 */
export function parseMapParam(search: string): string | null {
  try {
    const params = new URLSearchParams(search);
    const id = params.get('map');
    return id && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Remember a pending map id across an auth redirect. Used when a signed-out user
 * follows an invite deep link: the id is stashed before sign-in and consumed once
 * the session and map list are ready. Best-effort; never throws.
 */
export function stashPendingMap(storage: Pick<Storage, 'setItem'>, id: string): void {
  try {
    storage.setItem(PENDING_KEY, id);
  } catch {
    // Storage unavailable — the deep link just won't survive a manual sign-in.
  }
}

/**
 * Read and clear the pending map id (one-shot). Returns null when none is set.
 * Never throws.
 */
export function takePendingMap(storage: Pick<Storage, 'getItem' | 'removeItem'>): string | null {
  let id: string | null;
  try {
    id = storage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
  if (!id) return null;
  try {
    storage.removeItem(PENDING_KEY);
  } catch {
    // Best-effort; a stale value is harmless (it only ever selects a real map).
  }
  return id.trim() ? id.trim() : null;
}
