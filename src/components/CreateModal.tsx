import { useRef, useState, useEffect, useCallback } from 'react';
import { useStore } from '../store/projectStore';
import type { CreateTaskData, EditTaskData } from '../store/projectStore';
import type { Line, Station } from '../types';

const NEW_LINE = '__new__';
const DEFAULT_NEW_LINE_COLOR = '#7A4DD0';

// Default placeholders the store substitutes for empty fields. Strip them back
// out when pre-filling the edit form so the user sees clean placeholders.
const PLACEHOLDER_DESC = 'No description yet.';
const PLACEHOLDER_OWNER = 'Unassigned';
const PLACEHOLDER_DASH = '—';

function unplaceholder(value: string, placeholder: string): string {
  return value === placeholder ? '' : value;
}

function parseTags(raw: string): string[] {
  return Array.from(new Set(raw.split(',').map(t => t.trim()).filter(Boolean)));
}

interface FormProps {
  mode: 'create' | 'edit';
  station?: Station;
  defaultLine: string;
  defaultPrereqs: string[];
  excludeIds: Set<string>;
  onClose: () => void;
  onSubmit: (data: CreateTaskData | EditTaskData) => void;
  stations: Station[];
  lines: Line[];
  lineById: Record<string, Line>;
}

function ModalForm({
  mode, station, defaultLine, defaultPrereqs, excludeIds,
  onClose, onSubmit, stations, lines, lineById,
}: FormProps) {
  const isEdit = mode === 'edit';

  const [nameErr, setNameErr] = useState(false);
  const [selectedLine, setSelectedLine] = useState(defaultLine);
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>(station?.lines ?? []);
  const [addingNewLine, setAddingNewLine] = useState(false);
  const [lineErr, setLineErr] = useState(false);
  const [selectedPrereqs, setSelectedPrereqs] = useState<string[]>(defaultPrereqs);
  const [newLineName, setNewLineName] = useState('');
  const [newLineColor, setNewLineColor] = useState(DEFAULT_NEW_LINE_COLOR);
  const [newLineErr, setNewLineErr] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const ownerRef = useRef<HTMLInputElement>(null);
  const roleRef = useRef<HTMLInputElement>(null);
  const dueRef = useRef<HTMLInputElement>(null);
  const estRef = useRef<HTMLInputElement>(null);
  const tagsRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => nameRef.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, []);

  const togglePrereq = useCallback((id: string) => {
    setSelectedPrereqs(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  }, []);

  const toggleLine = useCallback((id: string) => {
    setLineErr(false);
    setSelectedLineIds(prev =>
      prev.includes(id) ? prev.filter(l => l !== id) : [...prev, id]
    );
  }, []);

  // In create mode the dropdown drives new-line creation; in edit mode the toggle does.
  const creatingNewLine = isEdit
    ? (addingNewLine && newLineName.trim().length > 0)
    : selectedLine === NEW_LINE;

  const handleSubmit = useCallback(() => {
    const name = nameRef.current?.value.trim() ?? '';
    if (!name) {
      setNameErr(true);
      nameRef.current?.focus();
      return;
    }

    const newLineRequested = isEdit ? addingNewLine : selectedLine === NEW_LINE;
    if (newLineRequested && !newLineName.trim()) {
      setNewLineErr(true);
      return;
    }

    if (isEdit && selectedLineIds.length === 0 && !creatingNewLine) {
      setLineErr(true);
      return;
    }

    setNameErr(false);
    setNewLineErr(false);
    setLineErr(false);

    const newLine = creatingNewLine
      ? { name: newLineName.trim(), color: newLineColor, short: '' }
      : undefined;
    const shared = {
      name,
      desc: descRef.current?.value.trim() || '',
      owner: ownerRef.current?.value.trim() || '',
      role: roleRef.current?.value.trim() || '',
      due: dueRef.current?.value.trim() || '',
      est: estRef.current?.value.trim() || '',
      tags: parseTags(tagsRef.current?.value ?? ''),
      prereqs: selectedPrereqs,
    };

    if (isEdit) {
      onSubmit({ ...shared, lines: selectedLineIds, newLine });
    } else {
      onSubmit({ ...shared, line: creatingNewLine ? '' : selectedLine, newLine });
    }
  }, [isEdit, selectedLine, selectedLineIds, selectedPrereqs, creatingNewLine,
      addingNewLine, newLineName, newLineColor, onSubmit]);

  const handleNameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  return (
    <>
      <button className="modal-close" aria-label="Close" onClick={onClose} type="button">
        ×
      </button>
      <h2>{isEdit ? 'Edit task' : 'New task'}</h2>
      <p className="modal-sub">
        {isEdit
          ? 'Update this station — its lines, prerequisites and details. Changing prerequisites re-routes it on the map.'
          : 'Add a station to the map. Pick its line and the tasks that must finish before it can start.'}
      </p>

      <label>
        Task name
        <input
          ref={nameRef}
          type="text"
          className={nameErr ? 'err' : ''}
          placeholder="e.g. Accessibility audit"
          autoComplete="off"
          defaultValue={station?.name ?? ''}
          onKeyDown={handleNameKeyDown}
          onChange={() => nameErr && setNameErr(false)}
        />
      </label>

      {isEdit ? (
        <div className="field">
          <div className="field-label">
            Lines{' '}
            <span className="hint">— pick one, or several for an interchange</span>
          </div>
          <div className="prereq-grid">
            {lines.map(l => (
              <label
                key={l.id}
                className="pq"
                style={{ '--pc': l.color } as React.CSSProperties}
              >
                <input
                  type="checkbox"
                  value={l.id}
                  checked={selectedLineIds.includes(l.id)}
                  onChange={() => toggleLine(l.id)}
                />
                <span className="pq-dot" />
                <span>{l.name}</span>
                <span className="pq-line">{l.short}</span>
              </label>
            ))}
          </div>
          {lineErr && <div className="field-error">Pick at least one line.</div>}
          <button
            type="button"
            className="btn-ghost add-line-toggle"
            onClick={() => { setAddingNewLine(a => !a); setNewLineErr(false); }}
          >
            {addingNewLine ? 'Cancel new line' : '+ New line…'}
          </button>
          {addingNewLine && (
            <div className="field-row new-line-fields">
              <label className="new-line-name">
                New line name
                <input
                  type="text"
                  className={newLineErr ? 'err' : ''}
                  placeholder="e.g. Marketing Line"
                  autoComplete="off"
                  value={newLineName}
                  onChange={e => { setNewLineName(e.target.value); if (newLineErr) setNewLineErr(false); }}
                />
              </label>
              <label className="new-line-color">
                Color
                <input
                  type="color"
                  value={newLineColor}
                  onChange={e => setNewLineColor(e.target.value)}
                />
              </label>
            </div>
          )}
        </div>
      ) : (
        <>
          <label>
            Line
            <select value={selectedLine} onChange={e => setSelectedLine(e.target.value)}>
              {lines.map(l => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
              <option value={NEW_LINE}>+ New line…</option>
            </select>
          </label>

          {creatingNewLine && (
            <div className="field-row new-line-fields">
              <label className="new-line-name">
                New line name
                <input
                  type="text"
                  className={newLineErr ? 'err' : ''}
                  placeholder="e.g. Marketing Line"
                  autoComplete="off"
                  value={newLineName}
                  onChange={e => { setNewLineName(e.target.value); if (newLineErr) setNewLineErr(false); }}
                />
              </label>
              <label className="new-line-color">
                Color
                <input
                  type="color"
                  value={newLineColor}
                  onChange={e => setNewLineColor(e.target.value)}
                />
              </label>
            </div>
          )}
        </>
      )}

      <label>
        Description
        <textarea
          ref={descRef}
          placeholder="What needs to happen here?"
          defaultValue={station ? unplaceholder(station.desc, PLACEHOLDER_DESC) : ''}
        />
      </label>

      <div className="field-row">
        <label>
          Owner
          <input
            ref={ownerRef}
            type="text"
            placeholder="Name"
            autoComplete="off"
            defaultValue={station ? unplaceholder(station.owner, PLACEHOLDER_OWNER) : ''}
          />
        </label>
        <label>
          Role
          <input
            ref={roleRef}
            type="text"
            placeholder="Title"
            autoComplete="off"
            defaultValue={station?.role ?? ''}
          />
        </label>
      </div>

      <div className="field-row">
        <label>
          Due
          <input
            ref={dueRef}
            type="text"
            placeholder="e.g. Jul 2"
            autoComplete="off"
            defaultValue={station ? unplaceholder(station.due, PLACEHOLDER_DASH) : ''}
          />
        </label>
        <label>
          Estimate
          <input
            ref={estRef}
            type="text"
            placeholder="e.g. 3 days"
            autoComplete="off"
            defaultValue={station ? unplaceholder(station.est, PLACEHOLDER_DASH) : ''}
          />
        </label>
      </div>

      <label>
        Tags
        <input
          ref={tagsRef}
          type="text"
          placeholder="comma separated, e.g. design, ui"
          autoComplete="off"
          defaultValue={station?.tags.join(', ') ?? ''}
        />
      </label>

      <div className="field">
        <div className="field-label">
          Depends on{' '}
          <span className="hint">— prerequisites that must be completed first</span>
        </div>
        <div className="prereq-grid">
          {stations.filter(s => !excludeIds.has(s.id)).map(s => {
            const primaryLine = lineById[s.lines[0]];
            const color = primaryLine?.color ?? '#888';
            const lineNames = s.lines.map(lid => lineById[lid]?.short ?? lid).join(' · ');
            const checked = selectedPrereqs.includes(s.id);

            return (
              <label
                key={s.id}
                className="pq"
                style={{ '--pc': color } as React.CSSProperties}
              >
                <input
                  type="checkbox"
                  value={s.id}
                  checked={checked}
                  onChange={() => togglePrereq(s.id)}
                />
                <span className="pq-dot" />
                <span>{s.name}</span>
                <span className="pq-line">{lineNames}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="modal-actions">
        <button className="btn-ghost" type="button" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" type="button" onClick={handleSubmit}>
          {isEdit ? 'Save changes' : 'Create task'}
        </button>
      </div>
    </>
  );
}

// Collect a task plus every task transitively downstream of it, so they can be
// excluded from its own prerequisite list (prevents dependency cycles).
function collectSelfAndDescendants(
  id: string,
  dependents: Record<string, string[]>
): Set<string> {
  const out = new Set<string>([id]);
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const next of dependents[cur] || []) {
      if (!out.has(next)) {
        out.add(next);
        stack.push(next);
      }
    }
  }
  return out;
}

export function CreateModal() {
  const { state, indexes, dispatch } = useStore();
  const { modalOpen, modalOpenCount, modalMode, editId, modalPreset, stations, lines } = state;
  const { lineById, stationById, dependents } = indexes;

  const isEdit = modalMode === 'edit';
  const editStation = isEdit && editId ? stationById[editId] : undefined;

  const defaultLine = modalPreset?.line ?? lines[0]?.id ?? '';
  const defaultPrereqs = isEdit && editId
    ? (indexes.prereqs[editId] ?? [])
    : (modalPreset?.prereqs ?? []);
  const excludeIds = isEdit && editId
    ? collectSelfAndDescendants(editId, dependents)
    : new Set<string>();

  const close = useCallback(() => {
    dispatch({ type: 'CLOSE_MODAL' });
  }, [dispatch]);

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) close();
  }, [close]);

  const handleSubmit = useCallback((data: CreateTaskData | EditTaskData) => {
    if (isEdit && editId) {
      dispatch({ type: 'UPDATE_TASK', id: editId, data: data as EditTaskData });
    } else {
      dispatch({ type: 'CREATE_TASK', data: data as CreateTaskData });
    }
  }, [dispatch, isEdit, editId]);

  // In edit mode, only render once we have the target station.
  const ready = modalOpen && (!isEdit || !!editStation);

  return (
    <div
      className={`modal-overlay${modalOpen ? ' open' : ''}`}
      onClick={handleOverlayClick}
    >
      <div className="modal" role="dialog" aria-modal="true">
        {ready && (
          <ModalForm
            key={modalOpenCount}
            mode={modalMode}
            station={editStation}
            defaultLine={defaultLine}
            defaultPrereqs={defaultPrereqs}
            excludeIds={excludeIds}
            onClose={close}
            onSubmit={handleSubmit}
            stations={stations}
            lines={lines}
            lineById={lineById as Record<string, Line>}
          />
        )}
      </div>
    </div>
  );
}
