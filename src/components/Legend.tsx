import { useStore } from '../store/projectStore';

export function Legend() {
  const { state, dispatch } = useStore();
  const { stations, lines, project, highlightLine } = state;

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
        <div className="prj-name">{project.name}</div>
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
            <button
              key={l.id}
              className={`line-row${isOn ? ' on' : ''}`}
              style={{ '--lc': l.color } as React.CSSProperties}
              onClick={() => toggleHighlight(l.id)}
              type="button"
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
          );
        })}
      </div>

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
