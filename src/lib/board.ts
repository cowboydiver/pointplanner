import type { Line, Station } from '../types.ts';
import { collectSelfAndDescendants, type Indexes } from './indexes.ts';

/**
 * A station plus the graph facts the board views need to rank and explain it.
 * The map answers "where does this sit"; a board has to answer "should I pick
 * this up", which needs the dependency counts spelled out.
 */
export interface BoardStation {
  station: Station;
  /** Direct dependents — how many stations this one is the last prereq for. */
  dependents: number;
  /** Every station transitively downstream, i.e. how much waits behind it. */
  downstream: number;
  /** Prereqs that are not `done` yet. Empty unless the station is `locked`. */
  waitingOn: Station[];
  /** Primary line (`station.lines[0]`), which carries the accent colour — ADR 0005. */
  line: Line | undefined;
}

/** Stations grouped by status, each group ordered for reading. */
export interface BoardModel {
  available: BoardStation[];
  active: BoardStation[];
  locked: BoardStation[];
  done: BoardStation[];
  byId: Record<string, BoardStation>;
  lines: Line[];
  total: number;
}

/**
 * Order by how much of the map is waiting behind a station: deepest downstream
 * first, then most direct dependents, then name so the result is stable. This is
 * what makes an `available` list a queue rather than an arbitrary pile — the
 * station at the top is the one whose completion frees the most work.
 */
function byDownstreamFirst(a: BoardStation, b: BoardStation): number {
  return (
    b.downstream - a.downstream ||
    b.dependents - a.dependents ||
    a.station.name.localeCompare(b.station.name)
  );
}

export function buildBoardModel(
  stations: Station[],
  lines: Line[],
  indexes: Indexes,
): BoardModel {
  const { stationById, lineById, prereqs, dependents } = indexes;

  const entries: BoardStation[] = stations.map(station => ({
    station,
    dependents: (dependents[station.id] ?? []).length,
    // collectSelfAndDescendants includes the station itself, so drop one.
    downstream: collectSelfAndDescendants(station.id, dependents).size - 1,
    waitingOn: (prereqs[station.id] ?? [])
      .map(id => stationById[id])
      .filter((s): s is Station => s !== undefined && s.status !== 'done'),
    line: lineById[station.lines[0]],
  }));

  const byId: Record<string, BoardStation> = {};
  entries.forEach(e => { byId[e.station.id] = e; });

  const inStatus = (status: Station['status']) =>
    entries.filter(e => e.station.status === status);

  return {
    available: inStatus('available').sort(byDownstreamFirst),
    active: inStatus('active').sort(byDownstreamFirst),
    locked: inStatus('locked').sort(byDownstreamFirst),
    // Completed work is history, so it keeps map order rather than being ranked.
    done: inStatus('done'),
    byId,
    lines,
    total: entries.length,
  };
}

/**
 * Every stop a line serves, in map order (column then row). Interchanges appear
 * on each of their lines, matching how the map draws them.
 */
export function stopsOnLine(model: BoardModel, lineId: string): BoardStation[] {
  return Object.values(model.byId)
    .filter(e => e.station.lines.includes(lineId))
    .sort((a, b) => a.station.col - b.station.col || a.station.row - b.station.row);
}

/**
 * How many stations are waiting behind this one, phrased for a tight space. A
 * station with no dependents is the end of its route, so it reads as a terminus
 * rather than as "0 waiting".
 */
export function waitingLabel(dependents: number): string {
  return dependents === 0 ? 'terminus' : `${dependents} waiting on this`;
}
