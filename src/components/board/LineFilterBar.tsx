import type { CSSProperties } from 'react';
import { useStore } from '../../store/projectStore';
import { countOnLine, type LineFilterMode } from '../../lib/board';
import { useLineFilter } from './useBoard';

const MODES: { mode: LineFilterMode; label: string; hint: string }[] = [
  { mode: 'fade', label: 'Fade', hint: 'Keep the rest of the map, faded — as the map itself dims it' },
  { mode: 'hide', label: 'Hide', hint: 'Drop the rest of the map, so counts and ranks describe this line alone' },
];

/**
 * The board's read-out of the legend's line selection: which line is filtering
 * the board, how much of the map that leaves, and whether the remainder is
 * faded or hidden.
 *
 * The map needs no such bar — dimmed lines stay visible on it, so the filter
 * explains itself. A board that hides its exclusions would otherwise look like
 * a map that had lost stations, so the filter has to say so. ADR 0010.
 */
export function LineFilterBar() {
  const { state } = useStore();
  const { lineId, mode, setMode, clear } = useLineFilter();
  if (lineId === null) return null;

  const line = state.lines.find(l => l.id === lineId);
  if (!line) return null;

  const shown = countOnLine(state.stations, lineId);

  return (
    <div className="filter-bar" style={{ '--lc': line.color } as CSSProperties}>
      <span className="filter-swatch" />
      <span className="filter-line">{line.name}</span>
      <span className="filter-count">
        {shown} of {state.stations.length} stations
      </span>

      <div className="filter-modes" role="group" aria-label="Filtered-out stations">
        {MODES.map(m => (
          <button
            key={m.mode}
            type="button"
            className={`filter-seg${mode === m.mode ? ' on' : ''}`}
            aria-pressed={mode === m.mode}
            title={m.hint}
            onClick={() => setMode(m.mode)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <button className="filter-clear" type="button" onClick={clear}>
        Show all
      </button>
    </div>
  );
}
