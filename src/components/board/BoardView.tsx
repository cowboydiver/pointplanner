import { useStore } from '../../store/projectStore';
import { QueueBoard } from './QueueBoard';
import { ColumnBoard } from './ColumnBoard';
import { DeparturesBoard } from './DeparturesBoard';

/**
 * Renders whichever board the current view mode selects. `map` never reaches
 * here — App renders the TransitMap for that. See ADR 0009 for why all three
 * boards exist rather than one.
 */
export function BoardView() {
  const { state } = useStore();

  switch (state.view) {
    case 'queue':
      return <QueueBoard />;
    case 'board':
      return <ColumnBoard />;
    case 'departures':
      return <DeparturesBoard />;
    case 'map':
      return null;
  }
}
