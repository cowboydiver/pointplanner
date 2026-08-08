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
  /**
   * True when a line filter is on and this station does not serve that line —
   * the board's equivalent of the map's `.station.dim`. Always false when no
   * filter is on, and always false in `hide` mode (those entries are gone).
   */
  dim: boolean;
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
    dim: false,
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
 * How a board renders the stations a line filter excludes.
 *
 * - `fade` — keep them, faded, exactly as the map dims off-line stations. The
 *   filtered line is read in the context of everything around it.
 * - `hide` — drop them entirely, so counts, ranks and lanes describe the line
 *   alone. A board is a list, not a picture, so unlike the map it can honestly
 *   re-count itself around a subset.
 */
export type LineFilterMode = 'fade' | 'hide';

/** Whether a station serves the filtered line. Interchanges serve several. */
function servesLine(entry: BoardStation, lineId: string): boolean {
  return entry.station.lines.includes(lineId);
}

/**
 * Narrow a board to one line, the same selection the map's legend makes — a
 * filter is a way of looking at the graph, so it is applied to the finished
 * model rather than threaded through `buildBoardModel`.
 *
 * `fade` preserves every group, ordering and count and only marks the excluded
 * entries `dim`. `hide` removes them, which re-counts the model around the
 * survivors: `total` and every group length describe the line alone, and
 * `lines` collapses to the filtered line so per-line layouts show one lane.
 * Ranking is unaffected either way — `byDownstreamFirst` already ordered the
 * groups, and dropping entries preserves the order of those that remain.
 */
export function applyLineFilter(
  model: BoardModel,
  lineId: string | null,
  mode: LineFilterMode,
): BoardModel {
  if (lineId === null) return model;

  const rewrite = mode === 'hide'
    ? (group: BoardStation[]) => group.filter(e => servesLine(e, lineId))
    : (group: BoardStation[]) =>
        group.map(e => (servesLine(e, lineId) ? e : { ...e, dim: true }));

  const byId: Record<string, BoardStation> = {};
  rewrite(Object.values(model.byId)).forEach(e => { byId[e.station.id] = e; });

  return {
    available: rewrite(model.available),
    active: rewrite(model.active),
    locked: rewrite(model.locked),
    done: rewrite(model.done),
    byId,
    lines: mode === 'hide' ? model.lines.filter(l => l.id === lineId) : model.lines,
    total: mode === 'hide' ? Object.keys(byId).length : model.total,
  };
}

/**
 * How many of these stations a line serves. Counted from the raw stations, not
 * a model, because the filter bar has to report the same "N of M" in both modes
 * and a `hide`-filtered model no longer knows what it dropped.
 */
export function countOnLine(stations: Station[], lineId: string): number {
  return stations.filter(s => s.lines.includes(lineId)).length;
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
