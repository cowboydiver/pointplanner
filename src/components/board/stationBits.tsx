import type { CSSProperties } from 'react';
import type { Line, StationStatus } from '../../types';

/**
 * The map's station marker, re-cut in HTML for the boards. It carries the same
 * `st-*` state classes and the same `pulse-ready` / `ping` animations the SVG
 * markers use, so an `available` station pulses identically in either view.
 */
export function StatusDot({
  status,
  color,
  size = 16,
}: {
  status: StationStatus;
  color: string;
  size?: number;
}) {
  return (
    <span
      className={`st-dot st-${status}`}
      style={{ '--c': color, '--dot': `${size}px` } as CSSProperties}
      aria-hidden
    >
      <span className="st-dot-halo" />
      <span className="st-dot-core" />
    </span>
  );
}

/** A line's short code in its own colour — the map's roundel, shrunk to a chip. */
export function LineBadge({ line }: { line: Line | undefined }) {
  return (
    <span
      className="line-badge"
      style={{ '--lc': line?.color ?? 'var(--locked)' } as CSSProperties}
      title={line?.name}
    >
      {line?.short ?? '··'}
    </span>
  );
}
