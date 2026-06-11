import type { Station, Line, Edge } from '../types';

export interface Indexes {
  stationById: Record<string, Station>;
  lineById: Record<string, Line>;
  prereqs: Record<string, string[]>;    // to -> [from...]
  dependents: Record<string, string[]>; // from -> [to...]
}

export function buildIndexes(stations: Station[], lines: Line[], edges: Edge[]): Indexes {
  const stationById: Record<string, Station> = {};
  stations.forEach(s => { stationById[s.id] = s; });

  const lineById: Record<string, Line> = {};
  lines.forEach(l => { lineById[l.id] = l; });

  const prereqs: Record<string, string[]> = {};
  const dependents: Record<string, string[]> = {};
  edges.forEach(e => {
    (prereqs[e.to] = prereqs[e.to] || []).push(e.from);
    (dependents[e.from] = dependents[e.from] || []).push(e.to);
  });

  return { stationById, lineById, prereqs, dependents };
}
