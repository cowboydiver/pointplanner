import { useState } from 'react';
import { useStore } from '../store/projectStore';
import { useAuth } from '../store/auth';
import { useMapRegistry } from '../store/mapRegistry';
import { LABEL_ANGLES, LABEL_PIVOTS } from '../lib/labelAnglePref';
import { MapSwitcher } from './MapSwitcher';
import { ShareModal } from './ShareModal';

// Cycle helpers for the label-orientation controls (angle 0 → 45 → -45 → 0,
// pivot center → left → top → bottom → right → center).
function nextInCycle<T>(values: readonly T[], current: T): T {
  const i = values.indexOf(current);
  return values[(i + 1) % values.length];
}

function pivotLabel(pivot: string): string {
  return pivot.charAt(0).toUpperCase() + pivot.slice(1);
}

export function Topbar() {
  const { state, dispatch, readOnly, isMirror } = useStore();
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
      {readOnly && (
        <span className="pill">{isMirror ? 'Repo mirror (read-only)' : 'Viewer (read-only)'}</span>
      )}
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
      {/* Label orientation (rotation angle + pivot point) is a per-viewer display
          preference, so it stays available even on read-only mirrors / Viewer
          shares (unlike content edits). The two buttons let you experiment with
          how station labels are angled and anchored. */}
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
      <button
        className="tb-btn"
        type="button"
        disabled={state.labelAngle === 0}
        title="Pivot point for rotated labels"
        onClick={() =>
          dispatch({
            type: 'SET_LABEL_PIVOT',
            pivot: nextInCycle(LABEL_PIVOTS, state.labelPivot),
          })
        }
      >
        ⌖ Pivot: {pivotLabel(state.labelPivot)}
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
