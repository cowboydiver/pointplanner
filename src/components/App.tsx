import { useEffect } from 'react';
import { ProjectStoreProvider, useStore } from '../store/projectStore';
import { Topbar } from './Topbar';
import { Legend } from './Legend';
import { TransitMap } from './TransitMap';
import { DetailPanel } from './DetailPanel';
import { CreateModal } from './CreateModal';

function AppInner() {
  const { state, dispatch } = useStore();

  // Global Escape handler
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (state.modalOpen) {
          dispatch({ type: 'CLOSE_MODAL' });
        } else if (state.selectedId !== null) {
          dispatch({ type: 'CLOSE_DETAIL' });
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [state.modalOpen, state.selectedId, dispatch]);

  return (
    <div className="app">
      <Topbar />
      <div className="body">
        <Legend />
        <main className="map-wrap">
          <TransitMap />
        </main>
        <DetailPanel />
      </div>
      <CreateModal />
    </div>
  );
}

export function App() {
  return (
    <ProjectStoreProvider>
      <AppInner />
    </ProjectStoreProvider>
  );
}
