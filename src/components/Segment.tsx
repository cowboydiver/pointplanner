import { useMemo } from 'react';
import type { Edge, Station } from '../types';
import { routePoints, pointsToPath, CORNER_RADIUS } from '../lib/routing';

interface SegmentProps {
  edge: Edge;
  stationById: Record<string, Station>;
  lineColor: string;
  isUpcoming: boolean;
  isDim: boolean;
}

export function Segment({ edge, stationById, lineColor, isUpcoming, isDim }: SegmentProps) {
  const d = useMemo(() => {
    const pts = routePoints(edge, stationById);
    return pointsToPath(pts, CORNER_RADIUS);
  }, [edge, stationById]);

  const segClass = `seg${isUpcoming ? ' upcoming' : ''}${isDim ? ' dim' : ''}`;

  // No white casing: lines render as continuous colored strokes so crossings
  // read as crossings, not breaks. Parallel-line separation is handled at layout
  // time (see layoutStations) rather than by a paper-colored outline.
  return (
    <path
      d={d}
      className={segClass}
      fill="none"
      stroke={lineColor}
      data-line={edge.line}
      data-from={edge.from}
      data-to={edge.to}
    />
  );
}
