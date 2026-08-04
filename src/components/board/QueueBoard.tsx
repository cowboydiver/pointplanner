import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { BoardStation } from '../../lib/board';
import { useBoardActions, useBoardModel } from './useBoard';
import { LineBadge, StatusDot } from './stationBits';

/**
 * QUEUE — one ranked list, no columns.
 *
 * Answers "what should I pick up next?". Everything `available` gets a
 * full-width card ordered by how much of the map is waiting behind it; active
 * work gets a band underneath; locked and done collapse to one-line rows.
 */
export function QueueBoard() {
  const model = useBoardModel();
  const { readOnly, select, start, complete } = useBoardActions();
  const [showDone, setShowDone] = useState(false);

  const open = model.available.length + model.active.length;

  return (
    <div className="board board-queue">
      <header className="q-head">
        <div className="q-count">{model.available.length}</div>
        <div>
          <h1 className="q-title">ready to start</h1>
          <p className="q-sub">
            {open} open of {model.total} stations · {model.locked.length} locked
          </p>
        </div>
      </header>

      {model.available.length === 0 && (
        <p className="board-empty">
          Nothing is available right now — finish something in progress to open the next stop.
        </p>
      )}

      <ul className="q-list">
        {model.available.map((entry, i) => (
          <ReadyCard
            key={entry.station.id}
            entry={entry}
            rank={i + 1}
            readOnly={readOnly}
            onSelect={() => select(entry.station.id)}
            onStart={() => start(entry.station.id)}
          />
        ))}
      </ul>

      {model.active.length > 0 && (
        <section className="q-sec">
          <h2 className="sec-h">In progress</h2>
          <ul className="q-list q-list-tight">
            {model.active.map(entry => (
              <li
                key={entry.station.id}
                className="q-card q-card-active"
                style={{ '--lc': entry.line?.color ?? 'var(--locked)' } as CSSProperties}
                onClick={() => select(entry.station.id)}
              >
                <StatusDot status="active" color={entry.line?.color ?? 'var(--locked)'} />
                <div className="q-body">
                  <div className="q-name">{entry.station.name}</div>
                  <div className="q-metaline">
                    {entry.station.owner} · due {entry.station.due} · {entry.station.est}
                  </div>
                </div>
                {!readOnly && (
                  <button
                    className="btn-ghost-sm"
                    type="button"
                    onClick={e => { e.stopPropagation(); complete(entry.station.id); }}
                  >
                    Mark complete
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="q-sec">
        <h2 className="sec-h">Locked · {model.locked.length}</h2>
        <ul className="q-rows">
          {model.locked.map(entry => (
            <li key={entry.station.id} className="q-row" onClick={() => select(entry.station.id)}>
              <LineBadge line={entry.line} />
              <span className="q-row-name">{entry.station.name}</span>
              <span className="q-row-wait">
                waiting on {entry.waitingOn.map(s => s.name).join(', ')}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="q-sec">
        <button
          className="sec-h q-toggle"
          type="button"
          aria-expanded={showDone}
          onClick={() => setShowDone(v => !v)}
        >
          Completed · {model.done.length} {showDone ? '▾' : '▸'}
        </button>
        {showDone && (
          <ul className="q-rows">
            {model.done.map(entry => (
              <li
                key={entry.station.id}
                className="q-row q-row-done"
                onClick={() => select(entry.station.id)}
              >
                <LineBadge line={entry.line} />
                <span className="q-row-name">{entry.station.name}</span>
                <span className="q-row-wait">{entry.station.owner}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ReadyCard({
  entry,
  rank,
  readOnly,
  onSelect,
  onStart,
}: {
  entry: BoardStation;
  rank: number;
  readOnly: boolean;
  onSelect: () => void;
  onStart: () => void;
}) {
  const color = entry.line?.color ?? 'var(--locked)';
  return (
    <li
      className="q-card q-card-ready"
      style={{ '--lc': color } as CSSProperties}
      onClick={onSelect}
    >
      <span className="q-rank">{rank}</span>
      <StatusDot status="available" color={color} size={20} />
      <div className="q-body">
        <div className="q-name q-name-big">{entry.station.name}</div>
        <p className="q-desc">{entry.station.desc}</p>
        <div className="q-metaline">
          {entry.station.lines.length > 1 && <span className="ix-badge">Interchange</span>}
          {entry.station.owner} · due {entry.station.due} · {entry.station.est}
        </div>
      </div>
      <div className="q-right">
        <div className="q-impact">
          <strong>{entry.dependents}</strong> waiting on this
          <span>{entry.downstream} downstream</span>
        </div>
        {!readOnly && (
          <button
            className="btn-primary-sm q-start"
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
