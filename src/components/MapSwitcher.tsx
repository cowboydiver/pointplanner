import { useState, useEffect, useRef } from 'react';
import { useMapRegistry } from '../store/mapRegistry';
import { ConfirmDialog } from './ConfirmDialog';

export function MapSwitcher() {
  const {
    index,
    activeMeta,
    createMap,
    selectMap,
    renameMapById,
    deleteMapById,
    duplicateMapById,
    reimportSourceFor,
    reimportMapById,
  } = useMapRegistry();

  const [open, setOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ key: string; name: string } | null>(null);
  const [pendingReimport, setPendingReimport] = useState<{ key: string; name: string } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on outside click and Escape
  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function handleSelect(key: string) {
    selectMap(key);
    setOpen(false);
  }

  function handleRename(key: string, currentName: string) {
    const name = window.prompt('Rename map', currentName);
    if (name && name.trim()) {
      renameMapById(key, name.trim());
    }
  }

  function handleDuplicate(key: string) {
    duplicateMapById(key);
    setOpen(false);
  }

  function handleDeleteRequest(key: string, name: string) {
    setPendingDelete({ key, name });
  }

  function handleDeleteConfirm() {
    if (pendingDelete) {
      deleteMapById(pendingDelete.key);
      setPendingDelete(null);
      setOpen(false);
    }
  }

  function handleReimportRequest(key: string, name: string) {
    setPendingReimport({ key, name });
  }

  function handleReimportConfirm() {
    if (pendingReimport) {
      reimportMapById(pendingReimport.key);
      setPendingReimport(null);
      setOpen(false);
    }
  }

  function handleNewMap() {
    const name = window.prompt('New map name', 'Untitled');
    if (name && name.trim()) {
      createMap(name.trim());
      setOpen(false);
    }
  }

  const displayName = activeMeta?.name ?? 'Maps';

  return (
    <div className="map-switcher" ref={wrapperRef}>
      <button
        className="pill map-switcher-btn"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        {displayName}
        <span className="map-switcher-caret" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="map-menu" role="listbox" aria-label="Maps">
          {index.maps.map(m => {
            const isActive = m.key === index.activeKey;
            return (
              <div
                key={m.key}
                className={`map-menu-item${isActive ? ' active' : ''}`}
                role="option"
                aria-selected={isActive}
              >
                <button
                  className="map-menu-item-name"
                  type="button"
                  onClick={() => handleSelect(m.key)}
                >
                  {isActive && <span className="map-menu-check" aria-hidden="true">✓</span>}
                  <span className="map-menu-item-label">{m.name}</span>
                </button>
                <div className="map-menu-item-actions">
                  {reimportSourceFor(m.key) && (
                    <button
                      className="map-menu-icon-btn"
                      type="button"
                      title="Re-import from committed file"
                      aria-label={`Re-import "${m.name}"`}
                      onClick={e => { e.stopPropagation(); handleReimportRequest(m.key, m.name); }}
                    >
                      ⟳
                    </button>
                  )}
                  <button
                    className="map-menu-icon-btn"
                    type="button"
                    title="Rename map"
                    aria-label={`Rename "${m.name}"`}
                    onClick={e => { e.stopPropagation(); handleRename(m.key, m.name); }}
                  >
                    ✎
                  </button>
                  <button
                    className="map-menu-icon-btn"
                    type="button"
                    title="Duplicate map"
                    aria-label={`Duplicate "${m.name}"`}
                    onClick={e => { e.stopPropagation(); handleDuplicate(m.key); }}
                  >
                    ⧉
                  </button>
                  <button
                    className="map-menu-icon-btn map-menu-icon-btn--danger"
                    type="button"
                    title="Delete map"
                    aria-label={`Delete "${m.name}"`}
                    onClick={e => { e.stopPropagation(); handleDeleteRequest(m.key, m.name); }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
          <div className="map-menu-footer">
            <button
              className="map-menu-new"
              type="button"
              onClick={handleNewMap}
            >
              + New map
            </button>
          </div>
        </div>
      )}

      {pendingDelete && (
        <ConfirmDialog
          isOpen
          title={`Delete "${pendingDelete.name}"?`}
          message="This will permanently delete the map and all its tasks. This action cannot be undone."
          confirmLabel="Delete map"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {pendingReimport && (
        <ConfirmDialog
          isOpen
          title={`Re-import "${pendingReimport.name}"?`}
          message={`This will replace your local copy of "${pendingReimport.name}" with the latest committed version. Local edits will be lost.`}
          confirmLabel="Re-import"
          onConfirm={handleReimportConfirm}
          onCancel={() => setPendingReimport(null)}
        />
      )}
    </div>
  );
}
