// PROTOTYPE — throwaway. See NOTES.md in this directory.
//
// VARIANT C — "Departure board + line swimlanes".
// Keeps the transit metaphor instead of borrowing kanban. The top rail is a
// station departure board: every ready task across every line, in leverage
// order, on a dark high-contrast strip. Below it, one swimlane per line shows
// the whole route left-to-right — done stops shrink to ticks, blocked stops to
// grey dots, and ready stops bloom into a card with the map's pulse, so you can
// see *where on the route* the open work sits. The bet: the board should be
// legible as the same product as the map, not a second unrelated tool.

import { useStore } from '../../store/projectStore';
import { stopsOnLine, useBoardData, type BoardTask } from './boardData';
import { LineRoundel, StatusMarker } from './bits';

export function VariantC() {
  const { dispatch, readOnly } = useStore();
  const data = useBoardData();

  const select = (id: string) => dispatch({ type: 'OPEN_DETAIL', id });
  const act = (id: string, a: 'start' | 'done') => dispatch({ type: 'DO_ACTION', id, act: a });

  return (
    <div className="bp bp-c">
      <section className="bp-c-rail">
        <div className="bp-c-rail-head">
          <span className="bp-c-rail-title">Next departures</span>
          <span className="bp-c-rail-sub">{data.ready.length} ready · {data.inProgress.length} running</span>
        </div>
        {data.ready.length === 0 && <div className="bp-c-rail-empty">— no departures — all lines waiting —</div>}
        <ul className="bp-c-rail-list">
          {data.ready.map(t => (
            <li key={t.station.id} className="bp-c-dep" onClick={() => select(t.station.id)}>
              <LineRoundel short={t.line?.short ?? '··'} color={t.line?.color ?? '#888'} />
              <span className="bp-c-dep-name">{t.station.name}</span>
              <span className="bp-c-dep-owner">{t.station.owner}</span>
              <span className="bp-c-dep-due">{t.station.due}</span>
              <span className="bp-c-dep-impact">unblocks {t.unblocks}</span>
              {!readOnly && (
                <button
                  className="bp-btn bp-btn--board"
                  type="button"
                  onClick={e => { e.stopPropagation(); act(t.station.id, 'start'); }}
                >
                  Board
                </button>
              )}
            </li>
          ))}
          {data.inProgress.map(t => (
            <li key={t.station.id} className="bp-c-dep bp-c-dep--running" onClick={() => select(t.station.id)}>
              <LineRoundel short={t.line?.short ?? '··'} color={t.line?.color ?? '#888'} />
              <span className="bp-c-dep-name">{t.station.name}</span>
              <span className="bp-c-dep-owner">{t.station.owner}</span>
              <span className="bp-c-dep-due">{t.station.due}</span>
              <span className="bp-c-dep-impact">in progress</span>
              {!readOnly && (
                <button
                  className="bp-btn bp-btn--board"
                  type="button"
                  onClick={e => { e.stopPropagation(); act(t.station.id, 'done'); }}
                >
                  Arrive
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="bp-c-lanes">
        {data.lines.map(line => {
          const stops = stopsOnLine(data, line.id);
          const readyOnLine = stops.filter(s => s.station.status === 'available').length;
          return (
            <div key={line.id} className="bp-c-lane" style={{ '--lc': line.color } as React.CSSProperties}>
              <div className="bp-c-lane-head">
                <LineRoundel short={line.short} color={line.color} />
                <span className="bp-c-lane-name">{line.name}</span>
                {readyOnLine > 0 && <span className="bp-c-lane-ready">{readyOnLine} ready</span>}
              </div>
              <div className="bp-c-lane-track">
                <div className="bp-c-lane-inner">
                  <span className="bp-c-lane-rail" />
                  {stops.map(t => (
                    <Stop key={t.station.id} task={t} readOnly={readOnly} onSelect={select} onStart={() => act(t.station.id, 'start')} />
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}

function Stop({
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
  const { status } = task.station;
  const color = task.line?.color ?? '#888';

  if (status === 'available') {
    return (
      <div className="bp-c-stop bp-c-stop--ready" onClick={() => onSelect(task.station.id)}>
        <StatusMarker status="available" color={color} size={18} />
        <div className="bp-c-stop-name">{task.station.name}</div>
        <div className="bp-c-stop-meta">{task.station.owner} · unblocks {task.unblocks}</div>
        {!readOnly && (
          <button
            className="bp-btn bp-btn--primary bp-btn--sm"
            type="button"
            onClick={e => { e.stopPropagation(); onStart(); }}
          >
            Start
          </button>
        )}
      </div>
    );
  }

  if (status === 'active') {
    return (
      <div className="bp-c-stop bp-c-stop--active" onClick={() => onSelect(task.station.id)}>
        <StatusMarker status="active" color={color} size={14} />
        <div className="bp-c-stop-name">{task.station.name}</div>
        <div className="bp-c-stop-meta">in progress</div>
      </div>
    );
  }

  return (
    <div
      className={`bp-c-stop bp-c-stop--${status}`}
      title={`${task.station.name} — ${status === 'done' ? 'done' : `waiting on ${task.waitingOn.map(s => s.name).join(', ')}`}`}
      onClick={() => onSelect(task.station.id)}
    >
      <StatusMarker status={status} color={color} size={11} />
      <div className="bp-c-stop-tick">{task.station.name}</div>
    </div>
  );
}
