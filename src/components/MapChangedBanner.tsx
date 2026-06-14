import { useMapRegistry } from '../store/mapRegistry';

/**
 * Non-dismissable banner shown when the store detects a stale-write conflict:
 * another Editor saved a newer version of this Map while the current Editor had
 * it open. The only recovery path is to reload (which discards local edits).
 */
export function MapChangedBanner() {
  const { reloadActiveMap } = useMapRegistry();

  return (
    <div className="map-changed-banner" role="alert" aria-live="assertive">
      <span className="map-changed-banner-msg">
        Someone changed this map — reload to continue
      </span>
      <button
        className="map-changed-banner-btn"
        type="button"
        onClick={reloadActiveMap}
      >
        Reload
      </button>
    </div>
  );
}
