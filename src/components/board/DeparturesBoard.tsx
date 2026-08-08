import type { CSSProperties } from 'react';
import { stopsOnLine, waitingLabel, type BoardStation } from '../../lib/board';
import { useBoardActions, useBoardModel, useLineFilter } from './useBoard';
import { LineBadge, StatusDot } from './stationBits';

/**
 * DEPARTURES — a station departure board over line swimlanes.
 *
 * Answers "what is open, and where does it sit on the route?" without leaving
 * the transit metaphor. The rail lists every available station across every
 * line; underneath, one lane per line shows the whole route with completed and
 * locked stops shrunk to ticks so the open ones stand out in context.
 */
export function DeparturesBoard() {
  const model = useBoardModel();
  const { readOnly, select, start, complete } = useBoardActions();
  const { lineId } = useLineFilter();

  return (
    <div className="board board-dep">
      <section className="dep-rail">
        <div className="dep-rail-head">
          <span className="dep-rail-title">Next departures</span>
          <span className="dep-rail-sub">
            {model.available.length} ready · {model.active.length} in progress
          </span>
        </div>
        {model.available.length === 0 && model.active.length === 0 && (
          <p className="dep-rail-empty">
            {/* A `hide` filter leaves one lane on the board, so "every line" would
                overstate what the reader is looking at. */}
            — no departures — {model.lines.length === 1 ? 'this line is' : 'every line is'} waiting —
          </p>
        )}
        <ul className="dep-list">
          {model.available.map(entry => (
            <DepartureRow
              key={entry.station.id}
              entry={entry}
              note={waitingLabel(entry.dependents)}
              action={readOnly ? null : { label: 'Start', run: () => start(entry.station.id) }}
              onSelect={() => select(entry.station.id)}
            />
          ))}
          {model.active.map(entry => (
            <DepartureRow
              key={entry.station.id}
              entry={entry}
              note="in progress"
              running
              action={readOnly ? null : { label: 'Arrive', run: () => complete(entry.station.id) }}
              onSelect={() => select(entry.station.id)}
            />
          ))}
        </ul>
      </section>

      <section className="dep-lanes">
        {model.lines.map(line => {
          const stops = stopsOnLine(model, line.id);
          const readyHere = stops.filter(s => s.station.status === 'available').length;
          // A whole lane fades when the filter excludes its line — its own stops
          // are already dim, but the head and rail have to follow or the lane
          // reads as still selected. In `hide` mode only the filtered lane is
          // in `model.lines` at all.
          const laneDim = lineId !== null && line.id !== lineId;
          return (
            <div
              key={line.id}
              className={`lane${laneDim ? ' dim' : ''}`}
              style={{ '--lc': line.color } as CSSProperties}
            >
              <div className="lane-head">
                <LineBadge line={line} />
                <span className="lane-name">{line.name}</span>
                {readyHere > 0 && <span className="lane-ready">{readyHere} ready</span>}
              </div>
              <div className="lane-track">
                <div className="lane-inner">
                  <span className="lane-rail" />
                  {stops.map(entry => (
                    <Stop
                      key={entry.station.id}
                      entry={entry}
                      readOnly={readOnly}
                      onSelect={() => select(entry.station.id)}
                      onStart={() => start(entry.station.id)}
                    />
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

function DepartureRow({
  entry,
  note,
  running,
  action,
  onSelect,
}: {
  entry: BoardStation;
  note: string;
  running?: boolean;
  action: { label: string; run: () => void } | null;
  onSelect: () => void;
}) {
  return (
    <li
      className={`dep-row${running ? ' dep-row-running' : ''}${entry.dim ? ' dim' : ''}`}
      onClick={onSelect}
    >
      <LineBadge line={entry.line} />
      <span className="dep-name">{entry.station.name}</span>
      <span className="dep-owner">{entry.station.owner}</span>
      <span className="dep-due">{entry.station.due}</span>
      <span className="dep-note">{note}</span>
      {action && (
        <button
          className="dep-btn"
          type="button"
          onClick={e => { e.stopPropagation(); action.run(); }}
        >
          {action.label}
        </button>
      )}
    </li>
  );
}

function Stop({
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
  const { station } = entry;
  const color = entry.line?.color ?? 'var(--locked)';
  const dim = entry.dim ? ' dim' : '';

  if (station.status === 'available') {
    return (
      <div className={`stop stop-ready${dim}`} onClick={onSelect}>
        <StatusDot status="available" color={color} size={18} />
        <div className="stop-name">{station.name}</div>
        <div className="stop-meta">
          {station.owner} · {waitingLabel(entry.dependents)}
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
      </div>
    );
  }

  if (station.status === 'active') {
    return (
      <div className={`stop stop-active${dim}`} onClick={onSelect}>
        <StatusDot status="active" color={color} size={14} />
        <div className="stop-name">{station.name}</div>
        <div className="stop-meta">in progress</div>
      </div>
    );
  }

  const hint =
    station.status === 'done'
      ? `${station.name} — completed`
      : `${station.name} — waiting on ${entry.waitingOn.map(s => s.name).join(', ')}`;

  return (
    <div className={`stop stop-tick stop-${station.status}${dim}`} title={hint} onClick={onSelect}>
      <StatusDot status={station.status} color={color} size={11} />
      <span className="stop-tick-name">{station.name}</span>
    </div>
  );
}
