import { useStore } from '../store/projectStore';
import type { ViewMode } from '../store/reducer';

/**
 * The four readings of a map, as one segmented control. They are alternative
 * renderings of the same graph rather than separate features, so they share a
 * single control instead of competing as loose topbar buttons — the topbar is
 * already dense, and four more would bury them. ADR 0009.
 */
const VIEWS: { mode: ViewMode; label: string; hint: string }[] = [
  { mode: 'map', label: 'Map', hint: 'The transit map — where every station sits' },
  { mode: 'queue', label: 'Queue', hint: 'Ready work, ranked by how much waits behind it' },
  { mode: 'board', label: 'Board', hint: 'Every station by status, weighted towards what is ready' },
  { mode: 'departures', label: 'Departures', hint: 'Ready work per line, in route order' },
];

export function ViewSwitcher() {
  const { state, dispatch } = useStore();

  return (
    <div className="view-switcher" role="group" aria-label="View">
      {VIEWS.map(({ mode, label, hint }) => {
        const active = state.view === mode;
        return (
          <button
            key={mode}
            type="button"
            className={`view-seg${active ? ' on' : ''}`}
            aria-pressed={active}
            title={hint}
            onClick={() => dispatch({ type: 'SET_VIEW', view: mode })}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
