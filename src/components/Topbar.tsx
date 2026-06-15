import { useState } from 'react';
import { useStore } from '../store/projectStore';
import { useAuth } from '../store/auth';
import { useMapRegistry } from '../store/mapRegistry';
import { MapSwitcher } from './MapSwitcher';
import { ShareModal } from './ShareModal';

export function Topbar() {
  const { state, dispatch, readOnly } = useStore();
  const { signOut } = useAuth();
  const { activeMeta } = useMapRegistry();
  const [shareOpen, setShareOpen] = useState(false);

  const isOwner = activeMeta?.role === 'owner';

  return (
    <header className="topbar">
      <div className="brand">
        <span className="roundel" />
        PointPlanner
      </div>
      <MapSwitcher />
      {readOnly && <span className="pill">Viewer (read-only)</span>}
      <div className="spacer" />
      <button className="tb-btn" type="button">
        Board view
      </button>
      <button
        className="tb-btn"
        type="button"
        onClick={() => dispatch({ type: 'SET_THEME', theme: state.theme === 'dark' ? 'light' : 'dark' })}
      >
        {state.theme === 'dark' ? '☀ Light' : '☾ Dark'}
      </button>
      {isOwner && (
        <button
          className="tb-btn"
          type="button"
          onClick={() => setShareOpen(true)}
        >
          Share
        </button>
      )}
      {!readOnly && (
        <button
          className="tb-btn primary"
          type="button"
          onClick={() => dispatch({ type: 'OPEN_MODAL' })}
        >
          + Add task
        </button>
      )}
      <button className="tb-btn" type="button" onClick={() => void signOut()}>
        Sign out
      </button>

      {shareOpen && activeMeta && (
        <ShareModal
          mapId={activeMeta.id}
          mapName={activeMeta.name}
          onClose={() => setShareOpen(false)}
        />
      )}
    </header>
  );
}
