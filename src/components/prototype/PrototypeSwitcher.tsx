// PROTOTYPE — throwaway. See NOTES.md in this directory.
//
// Floating bottom bar for flipping between UI variants. Dev-only: gated on
// import.meta.env.DEV so a stray merge can never ship it.

import { useEffect } from 'react';
import { writeParam } from './urlParams';

export interface VariantDef {
  key: string;
  name: string;
}

export function PrototypeSwitcher({
  variants,
  current,
  onChange,
}: {
  variants: VariantDef[];
  current: string;
  onChange: (key: string) => void;
}) {
  const index = Math.max(0, variants.findIndex(v => v.key === current));

  function go(delta: number) {
    const next = variants[(index + delta + variants.length) % variants.length];
    writeParam('variant', next.key);
    onChange(next.key);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  if (!import.meta.env.DEV) return null;

  return (
    <div className="proto-switcher" role="group" aria-label="Prototype variant switcher">
      <button type="button" className="proto-switcher-arrow" onClick={() => go(-1)} aria-label="Previous variant">
        ‹
      </button>
      <span className="proto-switcher-label">
        <span className="proto-switcher-key">{variants[index].key}</span>
        {variants[index].name}
      </span>
      <button type="button" className="proto-switcher-arrow" onClick={() => go(1)} aria-label="Next variant">
        ›
      </button>
    </div>
  );
}
