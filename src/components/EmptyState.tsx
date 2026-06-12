import { useMapRegistry } from '../store/mapRegistry';

export function EmptyState() {
  const { createMap } = useMapRegistry();

  function handleCreate() {
    const name = window.prompt('New map name', 'Untitled');
    if (name && name.trim()) {
      createMap(name.trim());
    }
  }

  return (
    <div className="empty-state-root">
      <header className="topbar empty-state-topbar">
        <div className="brand">
          <span className="roundel" />
          PointPlanner
        </div>
      </header>
      <div className="empty-state-body">
        <div className="empty-state-card">
          <div className="empty-state-title">No maps yet</div>
          <div className="empty-state-sub">Create a map to start planning your project as a transit map.</div>
          <button
            className="empty-state-cta"
            type="button"
            onClick={handleCreate}
          >
            Create a map
          </button>
        </div>
      </div>
    </div>
  );
}
