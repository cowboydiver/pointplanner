import type { Station } from '../types';
import { PAD_X, PAD_Y, COL, ROW } from './routing';

export interface Bounds {
  vx: number;
  vy: number;
  vw: number;
  vh: number;
}

export function computeBounds(stations: Station[]): Bounds {
  let maxCol = 0, maxRow = 0;
  let hasRight = false, hasLeft = false;

  stations.forEach(s => {
    if (s.col > maxCol) maxCol = s.col;
    if (s.row > maxRow) maxRow = s.row;
    if (s.lp === 'right') hasRight = true;
    if (s.lp === 'left') hasLeft = true;
  });

  const leftPad = hasLeft ? 80 : 0;
  const rightPad = hasRight ? 170 : 0;

  return {
    vx: -leftPad,
    vy: 0,
    vw: PAD_X * 2 + maxCol * COL + leftPad + rightPad,
    vh: PAD_Y * 2 + maxRow * ROW,
  };
}
