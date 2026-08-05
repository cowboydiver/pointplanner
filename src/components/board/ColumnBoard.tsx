import type { CSSProperties } from 'react';
import { waitingLabel, type BoardStation } from '../../lib/board';
import { useBoardActions, useBoardModel } from './useBoard';
import { LineBadge, StatusDot } from './stationBits';

/**
 * BOARD — status columns, deliberately unbalanced.
 *
 * Answers "how is the whole map distributed?" in a shape people already know how
 * to read. Ready to start is a double-width column with full cards; Locked and
 * Completed are narrow muted rails. Column width carries the emphasis, so the
 * familiar layout survives without treating all four statuses as equals.
 */
export function ColumnBoard() {
  const model = useBoardModel();
  const { readOnly, select, start, complete } = useBoardActions();

  return (
    <div className="board board-cols">
      <div className="col col-narrow">
        <ColumnHead label="Locked" count={model.locked.length} />
        <ul className="col-stack">
          {model.locked.map(entry => (
            <li
              key={entry.station.id}
              className="col-pill"
              title={`Waiting on ${entry.waitingOn.map(s => s.name).join(', ')}`}
              onClick={() => select(entry.station.id)}
            >
              <span
                className="col-pill-bar"
                style={{ background: entry.line?.color ?? 'var(--locked)' }}
              />
              <span className="col-pill-name">{entry.station.name}</span>
              <span className="col-pill-n">{entry.waitingOn.length}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="col col-hero">
        <ColumnHead label="Ready to start" count={model.available.length} accent />
        {model.available.length === 0 && (
          <p className="board-empty">Nothing is available right now.</p>
        )}
        <ul className="col-grid">
          {model.available.map(entry => (
            <ReadyTile
              key={entry.station.id}
              entry={entry}
              readOnly={readOnly}
              onSelect={() => select(entry.station.id)}
              onStart={() => start(entry.station.id)}
            />
          ))}
        </ul>
      </div>

      <div className="col">
        <ColumnHead label="In progress" count={model.active.length} />
        <ul className="col-stack">
          {model.active.map(entry => (
            <li
              key={entry.station.id}
              className="col-card"
              style={{ '--lc': entry.line?.color ?? 'var(--locked)' } as CSSProperties}
              onClick={() => select(entry.station.id)}
            >
              <div className="col-card-top">
                <StatusDot status="active" color={entry.line?.color ?? 'var(--locked)'} size={13} />
                <span className="col-card-name">{entry.station.name}</span>
              </div>
              <div className="col-card-meta">
                {entry.station.owner} · due {entry.station.due}
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
      </div>

      <div className="col col-narrow">
        <ColumnHead label="Completed" count={model.done.length} />
        <ul className="col-stack">
          {model.done.map(entry => (
            <li
              key={entry.station.id}
              className="col-pill col-pill-done"
              onClick={() => select(entry.station.id)}
            >
              <span className="col-check">✓</span>
              <span className="col-pill-name">{entry.station.name}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ColumnHead({ label, count, accent }: { label: string; count: number; accent?: boolean }) {
  return (
    <div className={`col-head${accent ? ' col-head-accent' : ''}`}>
      <span>{label}</span>
      <span className="col-head-n">{count}</span>
    </div>
  );
}

function ReadyTile({
  entry,
  readOnly,
  onSelect,
  onStart,
}: {
  entry: BoardStation;
  readOnly: boolean;
  onSelect: () => void;
  onStart: () => void;
}) {
  const color = entry.line?.color ?? 'var(--locked)';
  return (
    <li className="col-tile" style={{ '--lc': color } as CSSProperties} onClick={onSelect}>
      <div className="col-tile-top">
        <StatusDot status="available" color={color} size={17} />
        <LineBadge line={entry.line} />
        {entry.station.lines.length > 1 && <span className="ix-badge">Interchange</span>}
      </div>
      <div className="col-tile-name">{entry.station.name}</div>
      <p className="col-tile-desc">{entry.station.desc}</p>
      <div className="col-tile-foot">
        <span>{entry.station.owner} · {entry.station.due}</span>
        <span className="col-tile-impact">{waitingLabel(entry.dependents)}</span>
      </div>
      {!readOnly && (
        <button
          className="btn-primary-sm"
          type="button"
          onClick={e => { e.stopPropagation(); onStart(); }}
        >
          Start
        </button>
      )}
    </li>
  );
}
