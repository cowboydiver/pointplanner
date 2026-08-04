// PROTOTYPE — throwaway. See NOTES.md in this directory.
//
// VARIANT A — "Ready queue".
// Rejects columns entirely. One vertical priority stack: everything ready to
// start gets a full-width hero card ordered by leverage (how much of the map is
// waiting behind it); in-progress work gets a smaller band underneath; blocked
// and done collapse into dense one-line rows. The bet: a board's job is to
// answer "what do I pick up next", so ready work should get 90% of the pixels.

import { useState } from 'react';
import { useStore } from '../../store/projectStore';
import { useBoardData, type BoardTask } from './boardData';
import { LineRoundel, StatusMarker } from './bits';

export function VariantA() {
  const { dispatch, readOnly } = useStore();
  const data = useBoardData();
  const [showDone, setShowDone] = useState(false);

  const open = data.ready.length + data.inProgress.length;

  function select(id: string) {
    dispatch({ type: 'OPEN_DETAIL', id });
  }

  function act(id: string, a: 'start' | 'done') {
    dispatch({ type: 'DO_ACTION', id, act: a });
  }

  return (
    <div className="bp bp-a">
      <header className="bp-a-head">
        <div className="bp-a-count">{data.ready.length}</div>
        <div>
          <h1 className="bp-a-title">ready to start</h1>
          <p className="bp-a-sub">
            {open} open of {data.total} tasks · {data.blocked.length} still blocked
          </p>
        </div>
      </header>

      {data.ready.length === 0 && (
        <div className="bp-empty">Nothing is unblocked right now — finish something in progress.</div>
      )}

      <ul className="bp-a-list">
        {data.ready.map((t, i) => (
          <ReadyCard key={t.station.id} task={t} rank={i + 1} readOnly={readOnly} onSelect={select} onStart={() => act(t.station.id, 'start')} />
        ))}
      </ul>

      {data.inProgress.length > 0 && (
        <section className="bp-a-sec">
          <h2 className="bp-a-sec-h">In progress</h2>
          <ul className="bp-a-list bp-a-list--tight">
            {data.inProgress.map(t => (
              <li
                key={t.station.id}
                className="bp-a-card bp-a-card--active"
                style={{ '--lc': t.line?.color ?? '#888' } as React.CSSProperties}
                onClick={() => select(t.station.id)}
              >
                <StatusMarker status="active" color={t.line?.color ?? '#888'} />
                <div className="bp-a-body">
                  <div className="bp-a-name">{t.station.name}</div>
                  <div className="bp-a-metaline">
                    {t.station.owner} · due {t.station.due} · {t.station.est}
                  </div>
                </div>
                {!readOnly && (
                  <button
                    className="bp-btn bp-btn--ghost"
                    type="button"
                    onClick={e => { e.stopPropagation(); act(t.station.id, 'done'); }}
                  >
                    Mark complete
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="bp-a-sec">
        <h2 className="bp-a-sec-h">Waiting · {data.blocked.length}</h2>
        <ul className="bp-a-rows">
          {data.blocked.map(t => (
            <li key={t.station.id} className="bp-a-row" onClick={() => select(t.station.id)}>
              <LineRoundel short={t.line?.short ?? '··'} color={t.line?.color ?? '#888'} />
              <span className="bp-a-row-name">{t.station.name}</span>
              <span className="bp-a-row-block">
                waiting on {t.waitingOn.map(s => s.name).join(', ') || '—'}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="bp-a-sec">
        <button className="bp-a-sec-h bp-a-toggle" type="button" onClick={() => setShowDone(v => !v)}>
          Done · {data.done.length} {showDone ? '▾' : '▸'}
        </button>
        {showDone && (
          <ul className="bp-a-rows">
            {data.done.map(t => (
              <li key={t.station.id} className="bp-a-row bp-a-row--done" onClick={() => select(t.station.id)}>
                <LineRoundel short={t.line?.short ?? '··'} color={t.line?.color ?? '#888'} />
                <span className="bp-a-row-name">{t.station.name}</span>
                <span className="bp-a-row-block">{t.station.owner}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ReadyCard({
  task,
  rank,
  readOnly,
  onSelect,
  onStart,
}: {
  task: BoardTask;
  rank: number;
  readOnly: boolean;
  onSelect: (id: string) => void;
  onStart: () => void;
}) {
  const color = task.line?.color ?? '#888';
  return (
    <li
      className="bp-a-card bp-a-card--ready"
      style={{ '--lc': color } as React.CSSProperties}
      onClick={() => onSelect(task.station.id)}
    >
      <span className="bp-a-rank">{rank}</span>
      <StatusMarker status="available" color={color} size={20} />
      <div className="bp-a-body">
        <div className="bp-a-name bp-a-name--big">{task.station.name}</div>
        <p className="bp-a-desc">{task.station.desc}</p>
        <div className="bp-a-metaline">
          {task.station.lines.map(id => id).length > 1 && <span className="bp-ix">interchange</span>}
          {task.station.owner} · due {task.station.due} · {task.station.est}
        </div>
      </div>
      <div className="bp-a-right">
        <div className="bp-a-impact">
          <strong>{task.unblocks}</strong> unblocked next
          <span>{task.downstream} downstream</span>
        </div>
        {!readOnly && (
          <button
            className="bp-btn bp-btn--primary"
            type="button"
            onClick={e => { e.stopPropagation(); onStart(); }}
          >
            Start
          </button>
        )}
      </div>
    </li>
  );
}
