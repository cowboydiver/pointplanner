import type { Station } from '../types';

export function slugify(name: string, stationById: Record<string, Station>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'task';
  let id = base;
  let n = 2;
  while (stationById[id]) {
    id = base + '-' + n;
    n++;
  }
  return id;
}

export function occupied(col: number, row: number, stations: Station[]): boolean {
  return stations.some(s => s.col === col && s.row === row);
}

export function findFreeRow(col: number, row: number, stations: Station[]): number {
  if (!occupied(col, row, stations)) return row;
  for (let d = 1; d < 14; d++) {
    if (!occupied(col, row + d, stations)) return row + d;
    if (row - d >= 0 && !occupied(col, row - d, stations)) return row - d;
  }
  return row + 14;
}

export interface PlacedPosition {
  col: number;
  row: number;
}

export function placeNewStation(
  lineId: string,
  prereqIds: string[],
  stationById: Record<string, Station>,
  stations: Station[]
): PlacedPosition {
  let col: number, row: number;

  if (prereqIds.length) {
    const cols = prereqIds.map(id => stationById[id].col);
    col = Math.max(...cols) + 1;
    const sameLine = prereqIds
      .map(id => stationById[id])
      .filter(s => s.lines.indexOf(lineId) >= 0);
    if (sameLine.length) {
      row = sameLine[sameLine.length - 1].row;
    } else {
      row = Math.round(prereqIds.reduce((a, id) => a + stationById[id].row, 0) / prereqIds.length);
    }
  } else {
    col = 0;
    row = 0;
  }

  return { col, row: findFreeRow(col, row, stations) };
}
