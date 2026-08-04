// PROTOTYPE — throwaway. See NOTES.md in this directory.
//
// The only markup shared between variants: the "pulsing ready" marker lifted
// from the map's station treatment, and the line roundel. Everything about
// layout stays inside each variant so they are free to disagree.

import type { CSSProperties, ReactNode } from 'react';
import type { StationStatus } from '../../types';

/** The map's station marker, re-cut for a card. `pulse` drives the halo. */
export function StatusMarker({
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
      className={`bp-marker bp-marker--${status}`}
      style={{ '--c': color, '--sz': `${size}px` } as CSSProperties}
      aria-hidden
    >
      <span className="bp-marker-halo" />
      <span className="bp-marker-dot" />
    </span>
  );
}

export function LineRoundel({ short, color }: { short: string; color: string }) {
  return (
    <span className="bp-roundel" style={{ '--lc': color } as CSSProperties}>
      {short}
    </span>
  );
}

export function Meta({ children }: { children: ReactNode }) {
  return <span className="bp-meta">{children}</span>;
}
