import { useState } from 'react';
import { useStore } from '../store/projectStore';
import { useAuth } from '../store/auth';
import { useMapRegistry } from '../store/mapRegistry';
import { LABEL_ANGLES } from '../lib/labelAnglePref';
import { MapSwitcher } from './MapSwitcher';
import { ShareModal } from './ShareModal';
import { useBoardView } from './prototype/boardView';

// Cycle helper for the label-rotation control (angle 0 → 45 → -45 → 0).
function nextInCycle<T>(values: readonly T[], current: T): T {
  const i = values.indexOf(current);
  return values[(i + 1) % values.length];
}

export function Topbar() {
  const { state, dispatch, readOnly, isMirror } = useStore();
  const { signOut } = useAuth();
  const { activeMeta } = useMapRegistry();
  const { boardOpen, toggleBoard } = useBoardView();
  const [shareOpen, setShareOpen] = useState(false);

  const isOwner = activeMeta?.role === 'owner';

  return (
    <header className="topbar">
      <div className="brand">
        <span className="roundel" />
        PointPlanner
      </div>
      <MapSwitcher />
      {readOnly && (
        <span className="pill">{isMirror ? 'Repo mirror (read-only)' : 'Viewer (read-only)'}</span>
      )}
      <div className="spacer" />
      {/* PROTOTYPE (Board View) — the stub button now toggles the throwaway board
          prototype. See src/components/prototype/NOTES.md. */}
      <button
        className={`tb-btn${boardOpen ? ' primary' : ''}`}
        type="button"
        aria-pressed={boardOpen}
        onClick={toggleBoard}
      >
        {boardOpen ? '⬒ Map view' : '▤ Board view'}
      </button>
      <button
        className="tb-btn"
        type="button"
        onClick={() => dispatch({ type: 'SET_THEME', theme: state.theme === 'dark' ? 'light' : 'dark' })}
      >
        {state.theme === 'dark' ? '☀ Light' : '☾ Dark'}
      </button>
      {/* Label rotation is a per-viewer display preference, so it stays available
          even on read-only mirrors / Viewer shares (unlike content edits). The
          button lets you experiment with how station labels are angled. */}
      <button
        className="tb-btn"
        type="button"
        aria-pressed={state.labelAngle !== 0}
        title="Rotate all station labels (0° → 45° → -45°)"
        onClick={() =>
          dispatch({
            type: 'SET_LABEL_ANGLE',
            angle: nextInCycle(LABEL_ANGLES, state.labelAngle as (typeof LABEL_ANGLES)[number]),
          })
        }
      >
        ⤢ Labels {state.labelAngle === 0 ? '0°' : `${state.labelAngle}°`}
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
          className="tb-btn"
          type="button"
          title="Re-layout every station automatically to declutter the map"
          onClick={() => dispatch({ type: 'AUTO_ARRANGE' })}
        >
          Auto-arrange
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
