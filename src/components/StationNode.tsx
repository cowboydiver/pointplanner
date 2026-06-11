import { useCallback, useEffect, useState } from 'react';
import type { Station, Line, LabelPlacement } from '../types';
import { px, py } from '../lib/routing';

interface StationNodeProps {
  station: Station;
  primaryLine: Line;
  isSelected: boolean;
  isDim: boolean;
  onSelect: (id: string) => void;
}

function getLabelProps(lp: LabelPlacement) {
  const off = 22;
  switch (lp) {
    case 'top':
      return { x: 0, y: -off, textAnchor: 'middle' as const, dominantBaseline: undefined };
    case 'bottom':
      return { x: 0, y: off + 6, textAnchor: 'middle' as const, dominantBaseline: 'hanging' as const };
    case 'left':
      return { x: -off, y: 0, textAnchor: 'end' as const, dominantBaseline: 'middle' as const };
    default: // right
      return { x: off, y: 0, textAnchor: 'start' as const, dominantBaseline: 'middle' as const };
  }
}

export function StationNode({ station, primaryLine, isSelected, isDim, onSelect }: StationNodeProps) {
  const isInterchange = station.lines.length > 1;
  const cx = px(station.col);
  const cy = py(station.row);
  const labelProps = getLabelProps(station.lp);

  const [justChanged, setJustChanged] = useState(false);

  // Trigger pulse animation when status changes
  useEffect(() => {
    const t1 = setTimeout(() => setJustChanged(true), 0);
    const t2 = setTimeout(() => setJustChanged(false), 500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [station.status]);

  const handleClick = useCallback(() => {
    onSelect(station.id);
  }, [station.id, onSelect]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(station.id);
    }
  }, [station.id, onSelect]);

  const lineClasses = station.lines.map(l => `on-${l}`).join(' ');
  const classes = [
    'station',
    `st-${station.status}`,
    isInterchange ? 'interchange' : '',
    lineClasses,
    isSelected ? 'selected' : '',
    isDim ? 'dim' : '',
    justChanged ? 'just-changed' : '',
  ].filter(Boolean).join(' ');

  return (
    <g
      className={classes}
      data-id={station.id}
      transform={`translate(${cx},${cy})`}
      style={{ '--c': primaryLine.color } as React.CSSProperties}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <circle className="hit" r={26} cx={0} cy={0} fill="transparent" />
      <circle className="halo" r={16} cx={0} cy={0} />
      <circle className="marker" r={isInterchange ? 13 : 11} cx={0} cy={0} />
      <path className="check" d="M -4.2 0.4 L -1.2 3.4 L 4.6 -3.2" />
      <circle className="active-dot" r={4.4} cx={0} cy={0} />
      <text
        className="label"
        x={labelProps.x}
        y={labelProps.y}
        textAnchor={labelProps.textAnchor}
        dominantBaseline={labelProps.dominantBaseline}
      >
        {station.name}
      </text>
    </g>
  );
}
