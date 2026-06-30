import { useMemo } from 'react';
import type { Edge, Station } from '../types';
import { routePoints, pointsToPath, CORNER_RADIUS, type Point } from '../lib/routing';

interface SegmentProps {
  edge: Edge;
  stationById: Record<string, Station>;
  /** Pre-offset waypoints when this edge shares a run with another line (bundling);
   *  falls back to the edge's own routed points when undefined. */
  points?: Point[];
  lineColor: string;
  isUpcoming: boolean;
  isDim: boolean;
}

export function Segment({ edge, stationById, points, lineColor, isUpcoming, isDim }: SegmentProps) {
  const d = useMemo(() => {
    const pts = points ?? routePoints(edge, stationById);
    return pointsToPath(pts, CORNER_RADIUS);
  }, [edge, stationById, points]);

  const segClass = `seg${isUpcoming ? ' upcoming' : ''}${isDim ? ' dim' : ''}`;

  // No white casing: lines render as continuous colored strokes so crossings
  // read as crossings, not breaks. Residual collinear cross-line overlap is
  // nudged into parallel lanes at render time (see bundling.ts); the rest of the
  // separation is handled at layout time (see layoutStations).
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
