import { useStore } from '../store/projectStore';
import { useAuth } from '../auth/AuthProvider';
import { MapSwitcher } from './MapSwitcher';

export function Topbar() {
  const { state, dispatch } = useStore();
  const { session, signOut } = useAuth();

  return (
    <header className="topbar">
      <div className="brand">
        <span className="roundel" />
        PointPlanner
      </div>
      <MapSwitcher />
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
      {session?.user.email && (
        <span className="topbar-user-email">{session.user.email}</span>
      )}
      <button className="tb-btn" type="button" onClick={() => void signOut()}>
        Sign out
      </button>
    </header>
  );
}
