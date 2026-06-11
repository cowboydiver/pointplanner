import { useStore } from '../store/projectStore';

const STATUS_LABEL: Record<string, string> = {
  locked: 'Locked',
  available: 'Ready to start',
  active: 'In progress',
  done: 'Completed',
};

export function DetailPanel() {
  const { state, indexes, dispatch } = useStore();
  const { selectedId } = state;
  const { stationById, lineById, prereqs, dependents } = indexes;

  const isOpen = selectedId !== null;
  const station = selectedId ? stationById[selectedId] : null;

  if (!station) {
    return <aside className={`detail${isOpen ? ' open' : ''}`}><div className="p-inner" /></aside>;
  }

  const color = lineById[station.lines[0]]?.color ?? '#888';
  const pr = (prereqs[station.id] || []);
  const nexts = (dependents[station.id] || []);

  function handleAction(act: 'start' | 'done' | 'reopen') {
    dispatch({ type: 'DO_ACTION', id: station!.id, act });
  }

  function gotoStation(id: string) {
    dispatch({ type: 'OPEN_DETAIL', id });
  }

  return (
    <aside className={`detail${isOpen ? ' open' : ''}`}>
      <div className="p-inner">
        <div className="p-accent" style={{ background: color }} />
        <button
          className="p-close"
          aria-label="Close"
          onClick={() => dispatch({ type: 'CLOSE_DETAIL' })}
        >
          ×
        </button>

        <div className="p-head">
          <div className={`p-status st-${station.status}`}>
            <span className="p-status-dot" />
            {STATUS_LABEL[station.status]}
          </div>
          <h2 className="p-title">{station.name}</h2>
          <div className="p-lines">
            {station.lines.map(lid => {
              const l = lineById[lid];
              if (!l) return null;
              return (
                <span
                  key={lid}
                  className="chip"
                  style={{ '--lc': l.color } as React.CSSProperties}
                >
                  {l.name}
                </span>
              );
            })}
            {station.lines.length > 1 && <span className="ix-badge">interchange</span>}
          </div>
        </div>

        <p className="p-desc">{station.desc}</p>

        <div className="p-meta">
          <div className="m-row">
            <span className="m-k">Owner</span>
            <span className="m-v">
              {station.owner}
              {station.role && <span className="role"> · {station.role}</span>}
            </span>
          </div>
          <div className="m-row">
            <span className="m-k">Due</span>
            <span className="m-v">{station.due}</span>
          </div>
          <div className="m-row">
            <span className="m-k">Estimate</span>
            <span className="m-v">{station.est}</span>
          </div>
        </div>

        {station.tags && station.tags.length > 0 && (
          <div className="p-tags">
            {station.tags.map(t => (
              <span key={t} className="tag">{t}</span>
            ))}
          </div>
        )}

        <div className="p-sec">
          <div className="p-sec-h">Depends on</div>
          {pr.length === 0 ? (
            <div className="p-none">Nothing — this is a starting station.</div>
          ) : (
            <ul className="pre-list">
              {pr.map(pid => {
                const ps = stationById[pid];
                if (!ps) return null;
                return (
                  <li
                    key={pid}
                    className={`pre st-${ps.status}`}
                    onClick={() => gotoStation(pid)}
                  >
                    <span className="pre-dot" />
                    <span className="pre-name">{ps.name}</span>
                    <span className="pre-state">{STATUS_LABEL[ps.status]}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {nexts.length > 0 && (
          <div className="p-sec">
            <div className="p-sec-h">Unblocks next</div>
            <ul className="pre-list">
              {nexts.map(did => {
                const ds = stationById[did];
                if (!ds) return null;
                return (
                  <li
                    key={did}
                    className={`pre st-${ds.status}`}
                    onClick={() => gotoStation(did)}
                  >
                    <span className="pre-dot" />
                    <span className="pre-name">{ds.name}</span>
                    <span className="pre-state">{STATUS_LABEL[ds.status]}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="p-actions">
          {station.status === 'available' && (
            <button className="act" type="button" onClick={() => handleAction('start')}>
              Start task
            </button>
          )}
          {station.status === 'active' && (
            <button className="act" type="button" onClick={() => handleAction('done')}>
              Mark complete
            </button>
          )}
          {station.status === 'done' && (
            <button className="act ghost" type="button" onClick={() => handleAction('reopen')}>
              Reopen task
            </button>
          )}
          {station.status === 'locked' && (
            <button className="act disabled" type="button" disabled>
              Blocked — finish prerequisites
            </button>
          )}
          <button
            className="act ghost"
            type="button"
            onClick={() => dispatch({
              type: 'OPEN_MODAL',
              preset: { line: station.lines[0], prereqs: [station.id] },
            })}
          >
            + Add a following task
          </button>
        </div>
      </div>
    </aside>
  );
}
