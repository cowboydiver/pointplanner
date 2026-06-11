import { useStore } from '../store/projectStore';

export function Topbar() {
  const { state, dispatch } = useStore();

  return (
    <header className="topbar">
      <div className="brand">
        <span className="roundel" />
        PointPlanner
      </div>
      <span className="pill">{state.project.name}</span>
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
      <button
        className="tb-btn primary"
        type="button"
        onClick={() => dispatch({ type: 'OPEN_MODAL' })}
      >
        + Add task
      </button>
    </header>
  );
}
