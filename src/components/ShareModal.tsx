import { useState, useEffect, useCallback, useRef } from 'react';
import { listShares, addShare, removeShare, type ShareEntry } from '../lib/mapsRepo';

interface ShareModalProps {
  mapId: string;
  mapName: string;
  onClose: () => void;
}

// Owner-only dialog: grant/revoke read-only (Viewer) access to a map by email.
// Sharing is email-keyed with no accept step — the share resolves the moment the
// recipient signs in with that email (see migration 0002 / adr/0001).
export function ShareModal({ mapId, mapName, onClose }: ShareModalProps) {
  const [shares, setShares] = useState<ShareEntry[]>([]);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setShares(await listShares(mapId));
    } catch (err) {
      console.error('Failed to load shares', err);
      setError('Could not load shares.');
    }
  }, [mapId]);

  // Load the current shares on mount / map change. Mirrors the async-IIFE pattern
  // used elsewhere (projectStore) so the setState happens after an await, not
  // synchronously in the effect body.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const rows = await listShares(mapId);
        if (active) setShares(rows);
      } catch (err) {
        if (!active) return;
        console.error('Failed to load shares', err);
        setError('Could not load shares.');
      }
    })();
    return () => {
      active = false;
    };
  }, [mapId]);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);

  const handleAdd = useCallback(async () => {
    const value = email.trim();
    if (!value) {
      setError('Enter an email address.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addShare(mapId, value, 'viewer');
      setEmail('');
      await refresh();
    } catch (err) {
      console.error('Failed to add share', err);
      setError('Could not add viewer.');
    } finally {
      setBusy(false);
    }
  }, [email, mapId, refresh]);

  const handleRemove = useCallback(async (target: string) => {
    setBusy(true);
    setError(null);
    try {
      await removeShare(mapId, target);
      await refresh();
    } catch (err) {
      console.error('Failed to remove share', err);
      setError('Could not revoke access.');
    } finally {
      setBusy(false);
    }
  }, [mapId, refresh]);

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  return (
    <div className="modal-overlay open" onClick={handleOverlayClick}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Share map">
        <button className="modal-close" aria-label="Close" onClick={onClose} type="button">
          ×
        </button>
        <h2>Share map</h2>
        <p className="modal-sub">
          Give someone read-only access to “{mapName}” by email. They’ll see it in
          their list as soon as they sign in with that email — there’s no accept step.
        </p>

        <div className="field-row" style={{ alignItems: 'flex-end' }}>
          <label style={{ flex: 1 }}>
            Email
            <input
              ref={inputRef}
              type="email"
              placeholder="person@example.com"
              autoComplete="off"
              value={email}
              onChange={e => { setEmail(e.target.value); if (error) setError(null); }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handleAdd(); } }}
            />
          </label>
          <button
            className="btn-primary"
            type="button"
            disabled={busy}
            onClick={() => void handleAdd()}
            style={{ marginBottom: 14, padding: '9px 16px', borderRadius: 10, fontWeight: 700, border: 'none', cursor: 'pointer' }}
          >
            Add viewer
          </button>
        </div>

        {error && <div className="field-error" style={{ marginTop: -6, marginBottom: 12 }}>{error}</div>}

        <div className="field">
          <div className="field-label">People with access</div>
          {shares.length === 0 ? (
            <div className="p-none">No one yet — add a viewer above.</div>
          ) : (
            <div className="prereq-grid">
              {shares.map(s => (
                <div key={s.email} className="pq" style={{ cursor: 'default' }}>
                  <span>{s.email}</span>
                  <span className="pq-line">{s.role}</span>
                  <button
                    className="map-menu-icon-btn map-menu-icon-btn--danger"
                    type="button"
                    title="Revoke access"
                    aria-label={`Revoke access for ${s.email}`}
                    disabled={busy}
                    onClick={() => void handleRemove(s.email)}
                    style={{ marginLeft: 8 }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn-ghost" type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
