// PROTOTYPE — throwaway. See NOTES.md in this directory.
//
// VARIANT B — "Weighted status columns".
// A familiar four-column board, deliberately unbalanced: Ready is a double-width
// column with full cards and the map's pulse; Blocked and Done are squeezed into
// narrow muted rails; In progress sits in between. The bet: people already know
// how to read a kanban board, so keep the shape and let column *width* carry the
// emphasis instead of inventing a new layout.

import { useStore } from '../../store/projectStore';
import { useBoardData, type BoardTask } from './boardData';
import { LineRoundel, StatusMarker } from './bits';

export function VariantB() {
  const { dispatch, readOnly } = useStore();
  const data = useBoardData();

  const select = (id: string) => dispatch({ type: 'OPEN_DETAIL', id });
  const act = (id: string, a: 'start' | 'done') => dispatch({ type: 'DO_ACTION', id, act: a });

  return (
    <div className="bp bp-b">
      <div className="bp-b-col bp-b-col--narrow">
        <ColHead label="Blocked" count={data.blocked.length} />
        <ul className="bp-b-stack">
          {data.blocked.map(t => (
            <li key={t.station.id} className="bp-b-pill" onClick={() => select(t.station.id)}>
              <span className="bp-b-pill-lock" style={{ background: t.line?.color ?? '#888' }} />
              <span className="bp-b-pill-name">{t.station.name}</span>
              <span className="bp-b-pill-n">{t.waitingOn.length}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="bp-b-col bp-b-col--hero">
        <ColHead label="Ready to start" count={data.ready.length} accent />
        {data.ready.length === 0 && <div className="bp-empty">Nothing unblocked.</div>}
        <ul className="bp-b-grid">
          {data.ready.map(t => (
            <ReadyTile key={t.station.id} task={t} readOnly={readOnly} onSelect={select} onStart={() => act(t.station.id, 'start')} />
          ))}
        </ul>
      </div>

      <div className="bp-b-col">
        <ColHead label="In progress" count={data.inProgress.length} />
        <ul className="bp-b-stack">
          {data.inProgress.map(t => (
            <li
              key={t.station.id}
              className="bp-b-card"
              style={{ '--lc': t.line?.color ?? '#888' } as React.CSSProperties}
              onClick={() => select(t.station.id)}
            >
              <div className="bp-b-card-top">
                <StatusMarker status="active" color={t.line?.color ?? '#888'} size={13} />
                <span className="bp-b-card-name">{t.station.name}</span>
              </div>
              <div className="bp-b-card-meta">{t.station.owner} · due {t.station.due}</div>
              {!readOnly && (
                <button
                  className="bp-btn bp-btn--ghost bp-btn--sm"
                  type="button"
                  onClick={e => { e.stopPropagation(); act(t.station.id, 'done'); }}
                >
                  Complete
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="bp-b-col bp-b-col--narrow">
        <ColHead label="Done" count={data.done.length} />
        <ul className="bp-b-stack">
          {data.done.map(t => (
            <li key={t.station.id} className="bp-b-pill bp-b-pill--done" onClick={() => select(t.station.id)}>
              <span className="bp-b-check">✓</span>
              <span className="bp-b-pill-name">{t.station.name}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ColHead({ label, count, accent }: { label: string; count: number; accent?: boolean }) {
  return (
    <div className={`bp-b-head${accent ? ' bp-b-head--accent' : ''}`}>
      <span>{label}</span>
      <span className="bp-b-head-n">{count}</span>
    </div>
  );
}

function ReadyTile({
  task,
  readOnly,
  onSelect,
  onStart,
}: {
  task: BoardTask;
  readOnly: boolean;
  onSelect: (id: string) => void;
  onStart: () => void;
}) {
  const color = task.line?.color ?? '#888';
  return (
    <li
      className="bp-b-tile"
      style={{ '--lc': color } as React.CSSProperties}
      onClick={() => onSelect(task.station.id)}
    >
      <div className="bp-b-tile-top">
        <StatusMarker status="available" color={color} size={17} />
        <LineRoundel short={task.line?.short ?? '··'} color={color} />
        {task.station.lines.length > 1 && <span className="bp-ix">interchange</span>}
      </div>
      <div className="bp-b-tile-name">{task.station.name}</div>
      <p className="bp-b-tile-desc">{task.station.desc}</p>
      <div className="bp-b-tile-foot">
        <span className="bp-b-tile-meta">{task.station.owner} · {task.station.due}</span>
        <span className="bp-b-tile-impact">unblocks {task.unblocks}</span>
      </div>
      {!readOnly && (
        <button
          className="bp-btn bp-btn--primary"
          type="button"
          onClick={e => { e.stopPropagation(); onStart(); }}
        >
          Start task
        </button>
      )}
    </li>
  );
}
