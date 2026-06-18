import type { MapData } from './maps';
import type { Edge, Line, Station } from '../types';
import { validateMapData } from './validateMap';

// Import a map from a JSON file produced by the `generate-map` generator (the
// roadmap-map agent skill writes `maps/*.json` in exactly this `MapData` shape).
// Pure and I/O-free: callers read the file text, this parses + validates it, and
// the registry hands the result to `createMap`. Never throws — every failure
// path returns a human-readable `error` the UI can surface.

export type ParseMapFileResult =
  | { ok: true; name: string; data: MapData }
  | { ok: false; error: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Structural check that a parsed blob is a `MapData` with the fields the renderer
 * and `validateMapData` rely on. Returns a problem string, or null when the shape
 * is sound. Tolerant of hand-edited files: only the load-bearing fields are
 * required; cosmetic station fields (desc/owner/…) are defaulted on the way out.
 */
function checkShape(value: unknown): string | null {
  if (!isObject(value)) return 'Not a map file: expected a JSON object.';
  if (!isObject(value.project) || typeof value.project.name !== 'string') {
    return 'Not a map file: missing a project with a name.';
  }
  if (!Array.isArray(value.lines)) return 'Not a map file: "lines" must be an array.';
  if (!Array.isArray(value.stations)) return 'Not a map file: "stations" must be an array.';
  if (!Array.isArray(value.edges)) return 'Not a map file: "edges" must be an array.';

  for (const line of value.lines) {
    if (!isObject(line) || typeof line.id !== 'string') {
      return 'Malformed line: every line needs a string "id".';
    }
  }
  for (const st of value.stations) {
    if (!isObject(st) || typeof st.id !== 'string') {
      return 'Malformed station: every station needs a string "id".';
    }
    if (!Array.isArray(st.lines)) {
      return `Malformed station "${st.id}": "lines" must be an array.`;
    }
  }
  for (const edge of value.edges) {
    if (!isObject(edge) || typeof edge.from !== 'string' || typeof edge.to !== 'string') {
      return 'Malformed edge: every edge needs string "from" and "to".';
    }
  }
  return null;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const PLACEMENTS = new Set(['top', 'bottom', 'left', 'right']);
const STATUSES = new Set(['locked', 'available', 'active', 'done']);

/**
 * Rebuild a clean `MapData` from the parsed object, keeping only known fields and
 * defaulting the cosmetic ones. This strips any extra top-level keys a hand-edited
 * file might carry before we persist the map.
 */
function normalize(value: Record<string, unknown>): MapData {
  const project = value.project as Record<string, unknown>;

  const lines: Line[] = (value.lines as Record<string, unknown>[]).map(l => ({
    id: l.id as string,
    name: asString(l.name, l.id as string),
    color: asString(l.color, '#2563C9'),
    short: asString(l.short, (l.id as string).slice(0, 2).toUpperCase()),
  }));

  const stations: Station[] = (value.stations as Record<string, unknown>[]).map(s => {
    const lp = asString(s.lp, 'top');
    const status = asString(s.status, 'available');
    const station: Station = {
      id: s.id as string,
      name: asString(s.name, s.id as string),
      lines: (s.lines as unknown[]).map(String),
      col: asNumber(s.col),
      row: asNumber(s.row),
      lp: (PLACEMENTS.has(lp) ? lp : 'top') as Station['lp'],
      status: (STATUSES.has(status) ? status : 'available') as Station['status'],
      desc: asString(s.desc),
      owner: asString(s.owner),
      role: asString(s.role),
      due: asString(s.due),
      est: asString(s.est),
      tags: Array.isArray(s.tags) ? s.tags.map(String) : [],
    };
    if (typeof s.sourceUrl === 'string') station.sourceUrl = s.sourceUrl;
    return station;
  });

  const edges: Edge[] = (value.edges as Record<string, unknown>[]).map(e => {
    const edge: Edge = {
      from: e.from as string,
      to: e.to as string,
      line: asString(e.line),
    };
    if (typeof e.df === 'boolean') edge.df = e.df;
    return edge;
  });

  return {
    project: { name: asString(project.name), subtitle: asString(project.subtitle) },
    lines,
    stations,
    edges,
  };
}

/**
 * Parse + validate a map JSON file's text. On success returns the normalized
 * `MapData` and a suggested map name (the project name, or a fallback). On
 * failure returns a single human-readable reason.
 */
export function parseMapFile(json: string): ParseMapFileResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'File is not valid JSON.' };
  }

  const shapeError = checkShape(parsed);
  if (shapeError) return { ok: false, error: shapeError };

  const data = normalize(parsed as Record<string, unknown>);

  const errors = validateMapData(data);
  if (errors.length) return { ok: false, error: errors.join(' ') };

  const name = data.project.name.trim() || 'Imported map';
  return { ok: true, name, data };
}
