// PROTOTYPE — throwaway. See NOTES.md in this directory.
//
// Derived read-only view of the store for the board variants. Every variant
// gets the same facts and disagrees about how to present them.

import { useMemo } from 'react';
import { useStore } from '../../store/projectStore';
import type { Line, Station } from '../../types';

export interface BoardTask {
  station: Station;
  /** Direct dependents — "finishing this unblocks N tasks". */
  unblocks: number;
  /** Transitive dependents — how much of the map sits behind this one. */
  downstream: number;
  /** Prereqs that are not yet done (empty for anything ready/active/done). */
  waitingOn: Station[];
  /** First line of the station, used for the accent colour. */
  line: Line | undefined;
}

export interface BoardData {
  ready: BoardTask[];
  inProgress: BoardTask[];
  blocked: BoardTask[];
  done: BoardTask[];
  byId: Record<string, BoardTask>;
  lines: Line[];
  total: number;
}

export function useBoardData(): BoardData {
  const { state, indexes } = useStore();
  const { stations, lines } = state;
  const { stationById, lineById, prereqs, dependents } = indexes;

  return useMemo(() => {
    // Transitive dependent count, memo'd across the walk.
    const downstreamCache: Record<string, number> = {};
    function downstreamOf(id: string, seen = new Set<string>()): number {
      if (downstreamCache[id] !== undefined) return downstreamCache[id];
      const stack = [...(dependents[id] ?? [])];
      const reached = new Set<string>();
      while (stack.length) {
        const next = stack.pop()!;
        if (reached.has(next) || seen.has(next)) continue;
        reached.add(next);
        stack.push(...(dependents[next] ?? []));
      }
      downstreamCache[id] = reached.size;
      return reached.size;
    }

    const tasks: BoardTask[] = stations.map(station => ({
      station,
      unblocks: (dependents[station.id] ?? []).length,
      downstream: downstreamOf(station.id),
      waitingOn: (prereqs[station.id] ?? [])
        .map(pid => stationById[pid])
        .filter((s): s is Station => Boolean(s) && s.status !== 'done'),
      line: lineById[station.lines[0]],
    }));

    const byId: Record<string, BoardTask> = {};
    for (const t of tasks) byId[t.station.id] = t;

    // Ready work is ordered by leverage: what unlocks the most, soonest.
    const byLeverage = (a: BoardTask, b: BoardTask) =>
      b.downstream - a.downstream || b.unblocks - a.unblocks ||
      a.station.name.localeCompare(b.station.name);

    return {
      ready: tasks.filter(t => t.station.status === 'available').sort(byLeverage),
      inProgress: tasks.filter(t => t.station.status === 'active').sort(byLeverage),
      blocked: tasks.filter(t => t.station.status === 'locked').sort(byLeverage),
      done: tasks.filter(t => t.station.status === 'done'),
      byId,
      lines,
      total: tasks.length,
    };
  }, [stations, lines, stationById, lineById, prereqs, dependents]);
}

/** Stops on a line, in map order (column then row) — used by the swimlanes variant. */
export function stopsOnLine(data: BoardData, lineId: string): BoardTask[] {
  return Object.values(data.byId)
    .filter(t => t.station.lines.includes(lineId))
    .sort((a, b) => a.station.col - b.station.col || a.station.row - b.station.row);
}
