/**
 * LegacyImportPrompt — shown once when legacy localStorage maps are detected
 * after the user signs in. Offers to import them into the cloud account or
 * dismiss without touching local data.
 */

interface LegacyImportPromptProps {
  count: number;
  onImport: () => void;
  onDismiss: () => void;
}

export function LegacyImportPrompt({ count, onImport, onDismiss }: LegacyImportPromptProps) {
  const mapWord = count === 1 ? 'map' : 'maps';

  return (
    <div className="modal-overlay open" onClick={onDismiss}>
      <div className="modal confirm-modal" onClick={e => e.stopPropagation()}>
        <h2>Import local {mapWord}?</h2>
        <div className="modal-sub">
          Found {count} local {mapWord} from a previous version of PointPlanner.
          Import {count === 1 ? 'it' : 'them'} to your cloud account so{' '}
          {count === 1 ? 'it' : 'they'} appear on all your devices.
          Your local data will not be deleted.
        </div>
        <div className="modal-actions">
          <button className="btn-ghost" type="button" onClick={onDismiss}>
            Not now
          </button>
          <button className="btn-danger" type="button" onClick={onImport}>
            Import {count} {mapWord}
          </button>
        </div>
      </div>
    </div>
  );
}
