// PROTOTYPE — throwaway. See NOTES.md in this directory.
//
// The app has no router, so the prototype reads/writes its `?view=` and
// `?variant=` keys straight off window.location.

export function readParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

export function writeParam(name: string, value: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set(name, value);
  window.history.replaceState(null, '', url);
}

/** Current `?variant=` key, defaulting to the first of `keys`. */
export function readVariant(keys: readonly string[]): string {
  const raw = (readParam('variant') ?? '').toUpperCase();
  return keys.includes(raw) ? raw : keys[0];
}
