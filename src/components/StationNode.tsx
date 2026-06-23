import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Station, Line, LabelPlacement } from '../types';
import type { LabelPivot } from '../lib/labelAnglePref';
import { px, py } from '../lib/routing';
import { wrapLabel } from '../lib/labelWrap';

const LINE_HEIGHT = 15; // px between wrapped label lines (font-size 13)

interface StationNodeProps {
  station: Station;
  primaryLine: Line;
  isSelected: boolean;
  isDim: boolean;
  /** Per-viewer label rotation in degrees (subway style); 0 = horizontal. */
  labelAngle?: number;
  /** Per-viewer point the rotation pivots about; defaults to the station marker. */
  labelPivot?: LabelPivot;
  onSelect: (id: string) => void;
}

type Box = { x: number; y: number; width: number; height: number };

/**
 * The point a rotated label pivots about, in the station's local coordinate
 * system (origin = marker). `center` pivots about the marker itself; the rest
 * pivot about the midpoint of an edge of the measured text box.
 */
function pivotPoint(pivot: LabelPivot, box: Box): [number, number] {
  switch (pivot) {
    case 'left':
      return [box.x, box.y + box.height / 2];
    case 'right':
      return [box.x + box.width, box.y + box.height / 2];
    case 'top':
      return [box.x + box.width / 2, box.y];
    case 'bottom':
      return [box.x + box.width / 2, box.y + box.height];
    case 'center':
    default:
      return [0, 0];
  }
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

export function StationNode({ station, primaryLine, isSelected, isDim, labelAngle = 0, labelPivot = 'center', onSelect }: StationNodeProps) {
  const isInterchange = station.lines.length > 1;
  const cx = px(station.col);
  const cy = py(station.row);
  const labelProps = getLabelProps(station.lp);

  // Wrap long names to <=2 lines. Vertical anchoring depends on placement: a
  // top label grows upward (away from the marker), left/right centers around the
  // anchor, everything else grows downward from the base y.
  const labelLines = wrapLabel(station.name);
  const lineCount = labelLines.length;
  let firstLineY = labelProps.y;
  if (station.lp === 'top') firstLineY = labelProps.y - (lineCount - 1) * LINE_HEIGHT;
  else if (station.lp === 'left' || station.lp === 'right')
    firstLineY = labelProps.y - ((lineCount - 1) * LINE_HEIGHT) / 2;

  // Measure the rendered text box (in local, pre-rotation coordinates) so the
  // rotation can pivot about one of its edges. getBBox ignores ancestor
  // transforms, so the box stays stable as the angle/pivot change — we only
  // re-measure when the text content or placement changes. Edge-pivots fall back
  // to a marker pivot until the first measurement lands.
  const textRef = useRef<SVGTextElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    try {
      const b = el.getBBox();
      setBox({ x: b.x, y: b.y, width: b.width, height: b.height });
    } catch {
      setBox(null);
    }
  }, [station.name, station.lp]);

  let labelTransform: string | undefined;
  if (labelAngle) {
    if (labelPivot === 'center' || !box) {
      labelTransform = `rotate(${labelAngle})`;
    } else {
      const [pxv, pyv] = pivotPoint(labelPivot, box);
      labelTransform = `rotate(${labelAngle} ${pxv} ${pyv})`;
    }
  }

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
      <g transform={labelTransform}>
        <text
          ref={textRef}
          className="label"
          x={labelProps.x}
          y={firstLineY}
          textAnchor={labelProps.textAnchor}
          dominantBaseline={labelProps.dominantBaseline}
        >
          {labelLines.map((line, i) => (
            <tspan key={i} x={labelProps.x} dy={i === 0 ? 0 : LINE_HEIGHT}>
              {line}
            </tspan>
          ))}
        </text>
      </g>
    </g>
  );
}
