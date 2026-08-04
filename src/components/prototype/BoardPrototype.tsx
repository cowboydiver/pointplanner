// PROTOTYPE — throwaway. See NOTES.md in this directory.
//
// Host for the Board View variants. Mounted in place of <TransitMap /> inside
// the real app shell (topbar, legend, detail panel all stay), so each variant is
// judged against real chrome and real data rather than in a vacuum.
//
//   ?view=board&variant=A|B|C

import { useState } from 'react';
import { readVariant } from './urlParams';
import { PrototypeSwitcher, type VariantDef } from './PrototypeSwitcher';
import { VariantA } from './VariantA';
import { VariantB } from './VariantB';
import { VariantC } from './VariantC';
import './board-prototype.css';

const VARIANTS: VariantDef[] = [
  { key: 'A', name: 'Ready queue' },
  { key: 'B', name: 'Weighted columns' },
  { key: 'C', name: 'Departures + swimlanes' },
];

const KEYS = VARIANTS.map(v => v.key);

export function BoardPrototype() {
  const [variant, setVariant] = useState(() => readVariant(KEYS));

  return (
    <>
      {variant === 'A' && <VariantA />}
      {variant === 'B' && <VariantB />}
      {variant === 'C' && <VariantC />}
      <PrototypeSwitcher variants={VARIANTS} current={variant} onChange={setVariant} />
    </>
  );
}
