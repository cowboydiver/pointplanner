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
}

export function Segment({ edge, stationById, points, lineColor }: SegmentProps) {
  const d = useMemo(() => {
    const pts = points ?? routePoints(edge, stationById);
    return pointsToPath(pts, CORNER_RADIUS);
  }, [edge, stationById, points]);

  // read as crossings, not breaks. Residual collinear cross-line overlap is
  // nudged into parallel lanes at render time (see bundling.ts); the rest of the
  // separation is handled at layout time (see layoutStations).
  //
  // Opacity for the faded `upcoming`/`dim` states lives on the wrapping tier
  // groups in TransitMap, not on this path — group opacity composites overlaps
  // once so stacked faded lines (e.g. same-line legs bundling leaves coincident)
  // don't darken where they run together.
  return (
    <path
      d={d}
      className="seg"
      fill="none"
      stroke={lineColor}
      data-line={edge.line}
      data-from={edge.from}
      data-to={edge.to}
    />
  );
}
