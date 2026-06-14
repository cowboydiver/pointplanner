import { useEffect } from 'react';
import { ProjectStoreProvider, useStore } from '../store/projectStore';
import { MapRegistryProvider, useMapRegistry } from '../store/mapRegistry';
import { Topbar } from './Topbar';
import { Legend } from './Legend';
import { TransitMap } from './TransitMap';
import { DetailPanel } from './DetailPanel';
import { CreateModal } from './CreateModal';
import { EmptyState } from './EmptyState';
import { AuthProvider, useAuth } from '../store/auth';
import { SignIn } from './SignIn';

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

function AppRoot() {
  const { index, reloadNonce, loading } = useMapRegistry();

  if (loading) {
    return <div className="auth-loading">Loading…</div>;
  }

  if (index.activeMapId === null) {
    return <EmptyState />;
  }

  return (
    <ProjectStoreProvider key={`${index.activeMapId}:${reloadNonce}`} mapId={index.activeMapId}>
      <AppInner />
    </ProjectStoreProvider>
  );
}

function AuthGate() {
  const { status } = useAuth();

  if (status === 'loading') {
    return <div className="auth-loading">Loading…</div>;
  }

  if (status === 'signed-out') {
    return <SignIn />;
  }

  return (
    <MapRegistryProvider>
      <AppRoot />
    </MapRegistryProvider>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}
