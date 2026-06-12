// Pure helpers for creating/editing transit lines. No React.

export function lineIdFromName(name: string, existingIds: string[]): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'line';
  let id = base;
  let n = 2;
  while (existingIds.includes(id)) {
    id = base + '-' + n;
    n++;
  }
  return id;
}

// Derive a 2-letter short code from a line name, e.g. "Design Line" → "DL".
export function deriveShort(name: string): string {
  const words = name.trim().split(/\s+/).map(w => w.replace(/[^a-z0-9]/gi, '')).filter(Boolean);
  if (words.length === 0) return 'LN';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

// Normalize a user-typed short code: trim, strip whitespace, cap at 3 chars, uppercase.
export function normalizeShort(short: string, name: string): string {
  const cleaned = short.replace(/\s+/g, '').slice(0, 3).toUpperCase();
  return cleaned || deriveShort(name);
}
