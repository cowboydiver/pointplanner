import type { MapSource } from '../data/mapsRepo';

/** Compact "x ago" for the last-sync time; falls back to an absolute date. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Read-only info strip shown atop a GitHub-mirror map: where it mirrors from and
 * when it last synced. Replaces the editable map's stale-write banner for
 * mirrors — a mirror is never stale, it just updates live. `source` is null
 * until the owner's status row loads (and always null for a Viewer of a mirror,
 * who can't read `map_sources`), so the strip degrades to a plain label.
 */
export function MirrorBanner({ source }: { source: MapSource | null }) {
  const repo = source ? `${source.repoOwner}/${source.repoName}` : null;
  const failed = source?.lastSyncStatus === 'error';
  const synced = source?.lastSyncedAt ? relativeTime(source.lastSyncedAt) : null;

  return (
    <div className={`mirror-banner${failed ? ' mirror-banner--error' : ''}`} role="status">
      <span className="mirror-banner-icon" aria-hidden="true">↗</span>
      <span className="mirror-banner-msg">
        {repo ? (
          <>
            Mirrored from <strong>{repo}</strong>
            {source?.filter ? <> · {source.filter}</> : null}
            {failed
              ? <> · last sync failed{source?.lastSyncError ? `: ${source.lastSyncError}` : ''}</>
              : synced
                ? <> · synced {synced}</>
                : null}
          </>
        ) : (
          <>Read-only mirror of a GitHub repo</>
        )}
      </span>
    </div>
  );
}
