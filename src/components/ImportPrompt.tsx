import { useMemo, useState } from 'react';
import { useAuth } from '../store/auth';
import { useMapRegistry } from '../store/mapRegistry';
import { createMap } from '../lib/mapsRepo';
import {
  detectLocalMaps,
  hasImportRun,
  markImportRun,
  type LocalMap,
} from '../lib/localImport';

// One-time prompt (issue #17): when a returning user signs in and the browser
// still holds maps from the old localStorage-only version, offer to bring them
// into their cloud account. Both accepting and declining mark the import as
// resolved (per user id), so the prompt never reappears and re-running can't
// duplicate maps. Local data is never deleted or mutated.
export function ImportPrompt() {
  const { user } = useAuth();
  const { refreshMaps } = useMapRegistry();
  const userId = user?.id ?? null;

  // Computed once on mount (per user). If the import was already resolved, or
  // there is nothing valid to import, we render nothing.
  const detected = useMemo<LocalMap[]>(() => {
    if (!userId) return [];
    if (hasImportRun(localStorage, userId)) return [];
    return detectLocalMaps(localStorage);
  }, [userId]);

  const [dismissed, setDismissed] = useState(false);
  const [importing, setImporting] = useState(false);

  if (!userId || dismissed || detected.length === 0) return null;

  const handleImport = async () => {
    setImporting(true);
    for (const m of detected) {
      try {
        await createMap(m.name, m.data);
      } catch (err) {
        // Skip the bad one but keep going; we still mark done at the end so we
        // don't loop on a persistently-failing map.
        console.error('Failed to import local map', m.name, err);
      }
    }
    markImportRun(localStorage, userId);
    await refreshMaps();
    setImporting(false);
    setDismissed(true);
  };

  const handleDecline = () => {
    markImportRun(localStorage, userId);
    setDismissed(true);
  };

  const n = detected.length;

  return (
    <div className="modal-overlay open">
      <div className="modal confirm-modal" role="dialog" aria-modal="true" aria-label="Import local maps">
        <h2>Import local maps?</h2>
        <div className="modal-sub">
          Found {n} local map{n === 1 ? '' : 's'} from this browser. Import{' '}
          {n === 1 ? 'it' : 'them'} into your account? Your local copy stays untouched.
        </div>
        <div className="modal-actions">
          <button className="btn-ghost" type="button" disabled={importing} onClick={handleDecline}>
            Not now
          </button>
          <button className="btn-primary" type="button" disabled={importing} onClick={() => void handleImport()}>
            {importing ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}
