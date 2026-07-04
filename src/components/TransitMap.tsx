import { useMemo, useCallback, useRef } from 'react';
import { useStore } from '../store/projectStore';
import { computeBounds } from '../lib/bounds';
import { resolveRouting, routePoints, LANE_PITCH, INTERCHANGE_MARKER_RADIUS } from '../lib/routing';
import { offsetCollinearLegs } from '../lib/bundling';
import { clearPassedStations } from '../lib/clearance';
import { toTransform } from '../lib/panzoom';
import { usePanZoom } from './usePanZoom';
import { Segment } from './Segment';
import { StationNode } from './StationNode';

// Render order is back-to-front: dimmed and faded lines sit behind fully-lit
// ones, so cross-tier overlaps resolve by coverage instead of stacking alpha.
const LINE_TIERS = [
  { tier: 'dim', className: 'lines-dim' },
  { tier: 'upcoming', className: 'lines-upcoming' },
  { tier: 'normal', className: 'lines-normal' },
] as const;

export function TransitMap() {
  const { state, indexes, dispatch } = useStore();
  const { stations, edges, selectedId, highlightLine, hoveredStationId } = state;
  const { stationById, lineById } = indexes;

  const bounds = useMemo(() => computeBounds(stations), [stations]);

  const svgRef = useRef<SVGSVGElement>(null);
  const { transform, isPanning, onPointerDown, zoomIn, zoomOut, reset } = usePanZoom(svgRef);

  // Routing (df) is derived from current positions + graph shape so edges stay
  // clean after re-placement or dependency changes, rather than trusting the
  // creation-time flag stored on each edge.
  const routedEdges = useMemo(() => resolveRouting(edges, stationById), [edges, stationById]);

  // Two pure pixel-space passes over the routed waypoints, keyed by the same
  // routedEdges index used as `index` on each tiered edge below:
  //  1. Bundling — nudge the few residual runs where different lines share an
  //     identical grid run into parallel lanes (trunk-fixed; see bundling.ts).
  //  2. Clearance — step an edge around any station marker its own line does not
  //     serve, so a line never reads as stopping where it doesn't (see clearance.ts).
  //     Runs on the post-bundling points, so a bundled lane (already a marker's
  //     width off-centre) is left alone and only straight/trunk legs are rewritten.
  const overridePoints = useMemo(() => {
    const routed = routedEdges.map(edge => ({ edge, points: routePoints(edge, stationById) }));
    const bundled = offsetCollinearLegs(routed, { lanePitch: LANE_PITCH }, state.lines.map(l => l.id));

    const effective = routed.map(({ edge }, i) => ({ edge, points: bundled.get(i) ?? routed[i].points }));
    // Clear against the larger (interchange) marker, so no marker reads as a false stop.
    const cleared = clearPassedStations(effective, stations, { clearance: LANE_PITCH, markerRadius: INTERCHANGE_MARKER_RADIUS });

    const merged = new Map(bundled);
    cleared.forEach((pts, i) => merged.set(i, pts));
    return merged;
  }, [routedEdges, stationById, stations, state.lines]);

  // Bucket each edge into an opacity tier. Opacity is applied once per tier on
  // the wrapping <g> (see LINE_TIERS / global.css) rather than per path, so
  // faded lines that overlap don't stack alpha and read darker — this covers the
  // same-line collinear legs that bundling leaves coincident. `dim` wins over
  // `upcoming`, matching the old `.seg.dim` !important. The original routedEdges
  // index is preserved as `index` to keep React keys unique across buckets and to
  // look up each edge's bundled (lane-offset) waypoints.
  const tieredEdges = useMemo(() => {
    return routedEdges.flatMap((edge, i) => {
      const toStation = stationById[edge.to];
      const lineObj = lineById[edge.line];
      if (!toStation || !lineObj) return [];

      const isDim = highlightLine !== null && edge.line !== highlightLine;
      const isUpcoming = toStation.status === 'locked';
      const tier = isDim ? 'dim' : isUpcoming ? 'upcoming' : 'normal';

      return [{ edge, color: lineObj.color, tier, index: i, key: `${edge.from}-${edge.to}-${i}` }];
    });
  }, [routedEdges, stationById, lineById, highlightLine]);

  const handleSelect = useCallback((id: string) => {
    dispatch({ type: 'OPEN_DETAIL', id });
  }, [dispatch]);

  const viewBox = `${bounds.vx} ${bounds.vy} ${bounds.vw} ${bounds.vh}`;

  return (
    <div className={`map-canvas${isPanning ? ' is-panning' : ''}`}>
      <svg
        ref={svgRef}
        id="map-svg"
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        className={highlightLine ? 'has-highlight' : ''}
        onPointerDown={onPointerDown}
      >
        <g className="g-viewport" transform={toTransform(transform)}>
        <g className="g-lines">
          {LINE_TIERS.map(({ tier, className }) => (
            <g key={tier} className={className}>
              {tieredEdges
                .filter(t => t.tier === tier)
                .map(t => (
                  <Segment
                    key={t.key}
                    edge={t.edge}
                    stationById={stationById}
                    points={overridePoints.get(t.index)}
                    lineColor={t.color}
                  />
                ))}
            </g>
          ))}
        </g>
        <g className="g-stations">
          {stations.map(station => {
            const primaryLine = lineById[station.lines[0]];
            if (!primaryLine) return null;

            const isDim = highlightLine !== null && !station.lines.includes(highlightLine);

            return (
              <StationNode
                key={station.id}
                station={station}
                primaryLine={primaryLine}
                isSelected={selectedId === station.id}
                isDim={isDim}
                isHovered={hoveredStationId === station.id}
                labelAngle={state.labelAngle}
                onSelect={handleSelect}
              />
            );
          })}
        </g>
        </g>
      </svg>
      <div className="map-controls" role="group" aria-label="Map zoom controls">
        <button type="button" className="map-ctrl" onClick={zoomIn} aria-label="Zoom in" title="Zoom in">+</button>
        <button type="button" className="map-ctrl" onClick={zoomOut} aria-label="Zoom out" title="Zoom out">−</button>
        <button type="button" className="map-ctrl" onClick={reset} aria-label="Reset view" title="Reset view">⤢</button>
      </div>
    </div>
  );
}
