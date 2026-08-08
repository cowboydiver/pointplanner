import { useStore } from '../../store/projectStore';
import { QueueBoard } from './QueueBoard';
import { ColumnBoard } from './ColumnBoard';
import { DeparturesBoard } from './DeparturesBoard';
import { LineFilterBar } from './LineFilterBar';

function board(view: 'queue' | 'board' | 'departures') {
  switch (view) {
    case 'queue':
      return <QueueBoard />;
    case 'board':
      return <ColumnBoard />;
    case 'departures':
      return <DeparturesBoard />;
  }
}

/**
 * Renders whichever board the current view mode selects, under the line filter
 * bar the three boards share. `map` never reaches here — App renders the
 * TransitMap for that. See ADR 0009 for why all three boards exist rather than
 * one, and ADR 0010 for the filter.
 */
export function BoardView() {
  const { state } = useStore();
  if (state.view === 'map') return null;

  return (
    <div className="board-shell">
      <LineFilterBar />
      {board(state.view)}
    </div>
  );
}
