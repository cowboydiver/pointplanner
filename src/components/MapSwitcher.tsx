import { useState, useEffect, useRef } from 'react';
import { useMapRegistry } from '../store/mapRegistry';
import { parseMapFile } from '../lib/importMap';
import { ConfirmDialog } from './ConfirmDialog';

export function MapSwitcher() {
  const {
    index,
    activeMeta,
    createMap,
    importMap,
    selectMap,
    renameMapById,
    deleteMapById,
    duplicateMapById,
  } = useMapRegistry();

  const [open, setOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  function handleSelect(id: string) {
    selectMap(id);
    setOpen(false);
  }

  function handleRename(id: string, currentName: string) {
    const name = window.prompt('Rename map', currentName);
    if (name && name.trim()) {
      renameMapById(id, name.trim());
    }
  }

  function handleDuplicate(id: string) {
    duplicateMapById(id);
    setOpen(false);
  }

  function handleDeleteRequest(id: string, name: string) {
    setPendingDelete({ id, name });
  }

  function handleDeleteConfirm() {
    if (pendingDelete) {
      deleteMapById(pendingDelete.id);
      setPendingDelete(null);
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

  function handleImportClick() {
    fileInputRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset so picking the same file again still fires a change event.
    e.target.value = '';
    if (!file) return;

    let text: string;
    try {
      text = await file.text();
    } catch {
      window.alert('Could not read the selected file.');
      return;
    }

    const result = parseMapFile(text);
    if (!result.ok) {
      window.alert(`Could not import map: ${result.error}`);
      return;
    }

    importMap(result.name, result.data);
    setOpen(false);
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

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={handleFileChange}
      />

      {open && (
        <div className="map-menu" role="listbox" aria-label="Maps">
          {index.maps.map(m => {
            const isActive = m.id === index.activeMapId;
            const isOwned = m.role === 'owner';
            return (
              <div
                key={m.id}
                className={`map-menu-item${isActive ? ' active' : ''}`}
                role="option"
                aria-selected={isActive}
              >
                <button
                  className="map-menu-item-name"
                  type="button"
                  onClick={() => handleSelect(m.id)}
                >
                  {isActive && <span className="map-menu-check" aria-hidden="true">✓</span>}
                  <span className="map-menu-item-label">{m.name}</span>
                  {!isOwned && <span className="map-menu-shared-badge">Shared</span>}
                </button>
                {isOwned && (
                  <div className="map-menu-item-actions">
                    <button
                      className="map-menu-icon-btn"
                      type="button"
                      title="Rename map"
                      aria-label={`Rename "${m.name}"`}
                      onClick={e => { e.stopPropagation(); handleRename(m.id, m.name); }}
                    >
                      ✎
                    </button>
                    <button
                      className="map-menu-icon-btn"
                      type="button"
                      title="Duplicate map"
                      aria-label={`Duplicate "${m.name}"`}
                      onClick={e => { e.stopPropagation(); handleDuplicate(m.id); }}
                    >
                      ⧉
                    </button>
                    <button
                      className="map-menu-icon-btn map-menu-icon-btn--danger"
                      type="button"
                      title="Delete map"
                      aria-label={`Delete "${m.name}"`}
                      onClick={e => { e.stopPropagation(); handleDeleteRequest(m.id, m.name); }}
                    >
                      ✕
                    </button>
                  </div>
                )}
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
            <button
              className="map-menu-new"
              type="button"
              onClick={handleImportClick}
            >
              ↥ Import map…
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
    </div>
  );
}
