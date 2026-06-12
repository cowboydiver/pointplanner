import { useState } from 'react';
import { useStore } from '../store/projectStore';
import { useMapRegistry } from '../store/mapRegistry';
import { ConfirmDialog } from './ConfirmDialog';

export function Legend() {
  const { state, dispatch } = useStore();
  const { activeMeta } = useMapRegistry();
  const { stations, lines, project, highlightLine } = state;
  // Use registry name as the canonical display name; fall back to store name if missing
  const displayName = activeMeta?.name ?? project.name;
  const [pendingDeleteLine, setPendingDeleteLine] = useState<string | null>(null);

  const total = stations.length;
  const done = stations.filter(s => s.status === 'done').length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  function toggleHighlight(lineId: string) {
    dispatch({
      type: 'SET_HIGHLIGHT_LINE',
      lineId: highlightLine === lineId ? null : lineId,
    });
  }

  return (
    <aside className="legend">
      <div className="prj">
        <div className="prj-name">{displayName}</div>
        <div className="prj-sub">{project.subtitle}</div>
      </div>

      <div className="overall">
        <div className="overall-top">
          <span>Overall progress</span>
          <span className="overall-pct">{pct}%</span>
        </div>
        <div className="overall-bar">
          <span style={{ width: `${pct}%` }} />
        </div>
        <div className="overall-sub">{done} of {total} stations complete</div>
      </div>

      <div className="sec-h">
        Lines
        {highlightLine && (
          <button
            className="clear-hl"
            onClick={() => dispatch({ type: 'SET_HIGHLIGHT_LINE', lineId: null })}
          >
            show all
          </button>
        )}
      </div>

      <div className="lines-list">
        {lines.map(l => {
          const lineStations = stations.filter(s => s.lines.includes(l.id));
          const lineDone = lineStations.filter(s => s.status === 'done').length;
          const linePct = lineStations.length > 0 ? Math.round((lineDone / lineStations.length) * 100) : 0;
          const isOn = highlightLine === l.id;

          return (
            <div
              key={l.id}
              className={`line-row${isOn ? ' on' : ''}`}
              style={{ '--lc': l.color } as React.CSSProperties}
            >
              <button
                className="line-row-btn"
                type="button"
                onClick={() => toggleHighlight(l.id)}
              >
                <span className="line-swatch" />
                <span className="line-meta">
                  <span className="line-name">{l.name}</span>
                  <span className="line-sub">{lineStations.length} stops · {lineDone} done</span>
                </span>
                <span className="line-prog">
                  <span className="line-prog-fill" style={{ width: `${linePct}%` }} />
                </span>
              </button>
              <button
                className="line-delete"
                type="button"
                aria-label={`Delete ${l.name}`}
                onClick={() => setPendingDeleteLine(l.id)}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      {pendingDeleteLine && (() => {
        const dl = lines.find(l => l.id === pendingDeleteLine);
        const exclusiveCount = stations.filter(s => s.lines.length === 1 && s.lines[0] === pendingDeleteLine).length;
        const edgeCount = state.edges.filter(e => e.line === pendingDeleteLine).length;
        return (
          <ConfirmDialog
            isOpen
            title={`Delete "${dl?.name}"?`}
            message={
              <>
                This will permanently delete the line
                {exclusiveCount > 0 && <>, <strong>{exclusiveCount} task{exclusiveCount !== 1 ? 's' : ''}</strong> that only belong to it</>}
                {edgeCount > 0 && <>, and <strong>{edgeCount} connection{edgeCount !== 1 ? 's' : ''}</strong></>}.
              </>
            }
            confirmLabel="Delete line"
            onConfirm={() => { dispatch({ type: 'DELETE_LINE', id: pendingDeleteLine }); setPendingDeleteLine(null); }}
            onCancel={() => setPendingDeleteLine(null)}
          />
        );
      })()}

      <div className="sec-h">Key</div>
      <div className="key">
        <div className="key-row">
          <span className="key-dot st-done" />
          <span>Completed</span>
        </div>
        <div className="key-row">
          <span className="key-dot st-active" />
          <span>In progress</span>
        </div>
        <div className="key-row">
          <span className="key-dot st-available" />
          <span>Ready to start</span>
        </div>
        <div className="key-row">
          <span className="key-dot st-locked" />
          <span>Locked (waiting)</span>
        </div>
        <div className="key-row">
          <span className="key-ix" />
          <span>Interchange — task on multiple lines</span>
        </div>
      </div>
    </aside>
  );
}
