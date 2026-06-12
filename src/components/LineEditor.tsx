import { useRef, useState, useEffect, useCallback } from 'react';
import type { LineData } from '../store/projectStore';

interface LineEditorProps {
  initial?: LineData;
  submitLabel: string;
  onSave: (data: LineData) => void;
  onCancel: () => void;
}

const DEFAULT_COLOR = '#2563C9';

export function LineEditor({ initial, submitLabel, onSave, onCancel }: LineEditorProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [color, setColor] = useState(initial?.color ?? DEFAULT_COLOR);
  const [short, setShort] = useState(initial?.short ?? '');
  const [err, setErr] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => nameRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, []);

  const save = useCallback(() => {
    const n = name.trim();
    if (!n) {
      setErr(true);
      nameRef.current?.focus();
      return;
    }
    onSave({ name: n, color, short });
  }, [name, color, short, onSave]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
  }, [save, onCancel]);

  return (
    <div className="line-editor" style={{ '--lc': color } as React.CSSProperties}>
      <div className="line-editor-fields">
        <input
          className="line-editor-color"
          type="color"
          value={color}
          onChange={e => setColor(e.target.value)}
          aria-label="Line color"
        />
        <input
          ref={nameRef}
          className={`line-editor-name${err ? ' err' : ''}`}
          type="text"
          placeholder="Line name"
          value={name}
          autoComplete="off"
          onChange={e => { setName(e.target.value); if (err) setErr(false); }}
          onKeyDown={onKeyDown}
        />
        <input
          className="line-editor-short"
          type="text"
          placeholder="ID"
          maxLength={3}
          value={short}
          autoComplete="off"
          aria-label="Short code"
          onChange={e => setShort(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="line-editor-actions">
        <button className="btn-ghost-sm" type="button" onClick={onCancel}>Cancel</button>
        <button className="btn-primary-sm" type="button" onClick={save}>{submitLabel}</button>
      </div>
    </div>
  );
}
