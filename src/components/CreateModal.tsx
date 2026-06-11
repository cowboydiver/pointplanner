import { useRef, useState, useEffect, useCallback } from 'react';
import { useStore } from '../store/projectStore';
import type { Line, Station } from '../types';

interface FormProps {
  defaultLine: string;
  defaultPrereqs: string[];
  onClose: () => void;
  onSubmit: (data: {
    name: string; line: string; desc: string;
    owner: string; role: string; due: string; est: string;
    prereqs: string[];
  }) => void;
  stations: Station[];
  lines: Line[];
  lineById: Record<string, Line>;
}

function ModalForm({ defaultLine, defaultPrereqs, onClose, onSubmit, stations, lines, lineById }: FormProps) {
  const [nameErr, setNameErr] = useState(false);
  const [selectedLine, setSelectedLine] = useState(defaultLine);
  const [selectedPrereqs, setSelectedPrereqs] = useState<string[]>(defaultPrereqs);

  const nameRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const ownerRef = useRef<HTMLInputElement>(null);
  const roleRef = useRef<HTMLInputElement>(null);
  const dueRef = useRef<HTMLInputElement>(null);
  const estRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => nameRef.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, []);

  const togglePrereq = useCallback((id: string) => {
    setSelectedPrereqs(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  }, []);

  const handleSubmit = useCallback(() => {
    const name = nameRef.current?.value.trim() ?? '';
    if (!name) {
      setNameErr(true);
      nameRef.current?.focus();
      return;
    }
    setNameErr(false);
    onSubmit({
      name,
      line: selectedLine,
      desc: descRef.current?.value.trim() || '',
      owner: ownerRef.current?.value.trim() || '',
      role: roleRef.current?.value.trim() || '',
      due: dueRef.current?.value.trim() || '',
      est: estRef.current?.value.trim() || '',
      prereqs: selectedPrereqs,
    });
  }, [selectedLine, selectedPrereqs, onSubmit]);

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
      <h2>New task</h2>
      <p className="modal-sub">
        Add a station to the map. Pick its line and the tasks that must finish before it can start.
      </p>

      <label>
        Task name
        <input
          ref={nameRef}
          type="text"
          className={nameErr ? 'err' : ''}
          placeholder="e.g. Accessibility audit"
          autoComplete="off"
          onKeyDown={handleNameKeyDown}
          onChange={() => nameErr && setNameErr(false)}
        />
      </label>

      <label>
        Line
        <select value={selectedLine} onChange={e => setSelectedLine(e.target.value)}>
          {lines.map(l => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
      </label>

      <label>
        Description
        <textarea ref={descRef} placeholder="What needs to happen here?" />
      </label>

      <div className="field-row">
        <label>
          Owner
          <input ref={ownerRef} type="text" placeholder="Name" autoComplete="off" />
        </label>
        <label>
          Role
          <input ref={roleRef} type="text" placeholder="Title" autoComplete="off" />
        </label>
      </div>

      <div className="field-row">
        <label>
          Due
          <input ref={dueRef} type="text" placeholder="e.g. Jul 2" autoComplete="off" />
        </label>
        <label>
          Estimate
          <input ref={estRef} type="text" placeholder="e.g. 3 days" autoComplete="off" />
        </label>
      </div>

      <div className="field">
        <div className="field-label">
          Depends on{' '}
          <span className="hint">— prerequisites that must be completed first</span>
        </div>
        <div className="prereq-grid">
          {stations.map(s => {
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
          Create task
        </button>
      </div>
    </>
  );
}

export function CreateModal() {
  const { state, indexes, dispatch } = useStore();
  const { modalOpen, modalOpenCount, modalPreset, stations, lines } = state;
  const { lineById } = indexes;

  const defaultLine = modalPreset?.line ?? lines[0]?.id ?? '';
  const defaultPrereqs = modalPreset?.prereqs ?? [];

  const close = useCallback(() => {
    dispatch({ type: 'CLOSE_MODAL' });
  }, [dispatch]);

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) close();
  }, [close]);

  const handleSubmit = useCallback((data: {
    name: string; line: string; desc: string;
    owner: string; role: string; due: string; est: string;
    prereqs: string[];
  }) => {
    dispatch({ type: 'CREATE_TASK', data });
  }, [dispatch]);

  return (
    <div
      className={`modal-overlay${modalOpen ? ' open' : ''}`}
      onClick={handleOverlayClick}
    >
      <div className="modal" role="dialog" aria-modal="true">
        {modalOpen && (
          <ModalForm
            key={modalOpenCount}
            defaultLine={defaultLine}
            defaultPrereqs={defaultPrereqs}
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
