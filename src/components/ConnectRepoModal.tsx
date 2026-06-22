import { useState, useEffect, useCallback } from 'react';
import { useMapRegistry } from '../store/mapRegistry';
import {
  listConnectableRepos,
  startGithubAuthorize,
  type ConnectableRepo,
} from '../data/mapsRepo';

interface ConnectRepoModalProps {
  onClose: () => void;
}

/**
 * Connect a GitHub repo as a read-only mirror map. Flow:
 *  1. Ask the github-repos function which repos the user can mirror.
 *  2. If they haven't authorized the GitHub App yet, offer the authorize
 *     redirect (GitHub returns them here with `?github=connected`).
 *  3. Otherwise pick a repo (+ optional label/milestone filter) and connect,
 *     which creates the mirror and runs its first sync server-side.
 * Mirrors the structure of ShareModal/CreateModal.
 */
export function ConnectRepoModal({ onClose }: ConnectRepoModalProps) {
  const { connectRepo } = useMapRegistry();
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [repos, setRepos] = useState<ConnectableRepo[]>([]);
  const [selected, setSelected] = useState('');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch the user's connectable repos. The network call is awaited before any
  // setState, so this is safe to invoke directly from the mount effect (no
  // synchronous state update in the effect body).
  const loadRepos = useCallback(async () => {
    try {
      const result = await listConnectableRepos();
      setConnected(result.connected);
      setRepos(result.repos);
      if (result.repos.length > 0) setSelected(String(result.repos[0].repoId));
      // Connected but the repo fetch failed transiently — surface a retry rather
      // than sending the user back through authorize.
      setError(
        result.error ? 'Could not load your repositories — GitHub may be busy. Try again.' : null,
      );
    } catch (err) {
      console.error('Failed to list repos', err);
      setError('Could not reach GitHub. Check the App configuration and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Wrapped in an async IIFE so the (post-await) setState calls inside
    // loadRepos run in an async callback, not synchronously in the effect body.
    void (async () => {
      await loadRepos();
    })();
  }, [loadRepos]);

  const handleRetry = useCallback(() => {
    setError(null);
    setLoading(true);
    void loadRepos();
  }, [loadRepos]);

  const handleAuthorize = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await startGithubAuthorize(); // navigates away
    } catch (err) {
      console.error('Authorize failed', err);
      setError(err instanceof Error ? err.message : 'Could not start GitHub authorization.');
      setBusy(false);
    }
  }, []);

  const handleConnect = useCallback(async () => {
    const repo = repos.find(r => String(r.repoId) === selected);
    if (!repo) {
      setError('Pick a repository.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await connectRepo({
        installationId: repo.installationId,
        repoId: repo.repoId,
        filter: filter.trim() || null,
      });
      onClose();
    } catch (err) {
      console.error('Connect failed', err);
      setError('Could not connect that repo. Make sure the App can read its issues.');
      setBusy(false);
    }
  }, [repos, selected, filter, connectRepo, onClose]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  return (
    <div className="modal-overlay open" onClick={handleOverlayClick}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Connect a repo">
        <button className="modal-close" aria-label="Close" onClick={onClose} type="button">
          ×
        </button>
        <h2>Connect a repo</h2>
        <p className="modal-sub">
          Mirror a GitHub repo’s issues as a read-only map that stays up to date
          automatically. Everyone with access sees live changes; no one can edit
          the mirror directly.
        </p>

        {loading ? (
          <div className="p-none">Loading your repositories…</div>
        ) : !connected ? (
          <div className="field">
            <p className="modal-sub" style={{ marginTop: 0 }}>
              Authorize the PointPlanner GitHub App to choose a repository. You’ll
              come right back here.
            </p>
            <button
              className="btn-primary"
              type="button"
              disabled={busy}
              onClick={() => void handleAuthorize()}
            >
              Authorize GitHub
            </button>
          </div>
        ) : repos.length === 0 ? (
          error ? (
            <div className="field">
              <button
                className="btn-primary"
                type="button"
                disabled={busy}
                onClick={handleRetry}
              >
                Try again
              </button>
            </div>
          ) : (
            <div className="p-none">
              No repositories available. Install the GitHub App on a repo, then try again.
            </div>
          )
        ) : (
          <>
            <label>
              Repository
              <select value={selected} onChange={e => setSelected(e.target.value)}>
                {repos.map(r => (
                  <option key={r.repoId} value={r.repoId}>
                    {r.fullName}
                    {r.private ? ' (private)' : ''}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Filter <span className="hint">— optional label or milestone to scope the map</span>
              <input
                type="text"
                placeholder="e.g. ready-for-agent"
                autoComplete="off"
                value={filter}
                onChange={e => setFilter(e.target.value)}
              />
            </label>
          </>
        )}

        {error && (
          <div className="field-error" style={{ marginTop: 4, marginBottom: 8 }}>
            {error}
          </div>
        )}

        <div className="modal-actions">
          <button className="btn-ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          {connected && repos.length > 0 && (
            <button className="btn-primary" type="button" disabled={busy} onClick={() => void handleConnect()}>
              {busy ? 'Connecting…' : 'Connect'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
