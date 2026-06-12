import { useMemo, useCallback } from 'react';
import { useStore } from '../store/projectStore';
import { computeBounds } from '../lib/bounds';
import { resolveRouting } from '../lib/routing';
import { Segment } from './Segment';
import { StationNode } from './StationNode';

export function TransitMap() {
  const { state, indexes, dispatch } = useStore();
  const { stations, edges, selectedId, highlightLine } = state;
  const { stationById, lineById } = indexes;

  const bounds = useMemo(() => computeBounds(stations), [stations]);
  const minWidth = Math.max(980, Math.round(bounds.vw * 0.62));

  // Routing (df) is derived from current positions + graph shape so edges stay
  // clean after re-placement or dependency changes, rather than trusting the
  // creation-time flag stored on each edge.
  const routedEdges = useMemo(() => resolveRouting(edges, stationById), [edges, stationById]);

  const handleSelect = useCallback((id: string) => {
    dispatch({ type: 'OPEN_DETAIL', id });
  }, [dispatch]);

  const viewBox = `${bounds.vx} ${bounds.vy} ${bounds.vw} ${bounds.vh}`;

  return (
    <div
      className="map-canvas"
      style={{ minWidth: `${minWidth}px` }}
    >
      <svg
        id="map-svg"
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        className={highlightLine ? 'has-highlight' : ''}
      >
        <g className="g-lines">
          {routedEdges.map((edge, i) => {
            const toStation = stationById[edge.to];
            const lineObj = lineById[edge.line];
            if (!toStation || !lineObj) return null;

            const isUpcoming = toStation.status === 'locked';
            const isDim = highlightLine !== null && edge.line !== highlightLine;

            return (
              <Segment
                key={`${edge.from}-${edge.to}-${i}`}
                edge={edge}
                stationById={stationById}
                lineColor={lineObj.color}
                isUpcoming={isUpcoming}
                isDim={isDim}
              />
            );
          })}
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
                onSelect={handleSelect}
              />
            );
          })}
        </g>
      </svg>
    </div>
  );
}
