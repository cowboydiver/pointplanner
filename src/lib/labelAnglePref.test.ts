import { describe, it, expect } from 'vitest';
import {
  loadLabelAngle,
  saveLabelAngle,
  loadLabelPivot,
  saveLabelPivot,
  LABEL_ANGLES,
  LABEL_PIVOTS,
} from './labelAnglePref';

/** Minimal in-memory Storage double. */
function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => map.delete(k),
    setItem: (k: string, v: string) => map.set(k, v),
  } as Storage;
}

describe('labelAnglePref', () => {
  it('returns 0 when nothing is stored', () => {
    expect(loadLabelAngle(fakeStorage(), 'map1')).toBe(0);
  });

  it('round-trips a valid preset per map id', () => {
    const s = fakeStorage();
    saveLabelAngle(s, 'map1', 45);
    expect(loadLabelAngle(s, 'map1')).toBe(45);
    // Keyed by map: another map is unaffected.
    expect(loadLabelAngle(s, 'map2')).toBe(0);
  });

  it('round-trips the negative preset', () => {
    const s = fakeStorage();
    saveLabelAngle(s, 'map1', -45);
    expect(loadLabelAngle(s, 'map1')).toBe(-45);
  });

  it('clears the key when set back to 0 (leaves no trace)', () => {
    const s = fakeStorage();
    saveLabelAngle(s, 'map1', 45);
    saveLabelAngle(s, 'map1', 0);
    expect(s.getItem('pointplanner.labelAngle.map1')).toBeNull();
    expect(loadLabelAngle(s, 'map1')).toBe(0);
  });

  it('falls back to 0 for malformed or unsupported values', () => {
    expect(loadLabelAngle(fakeStorage({ 'pointplanner.labelAngle.map1': 'abc' }), 'map1')).toBe(0);
    // 90 is not an offered preset.
    expect(loadLabelAngle(fakeStorage({ 'pointplanner.labelAngle.map1': '90' }), 'map1')).toBe(0);
  });

  it('survives storage that throws (private mode / quota)', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(loadLabelAngle(throwing, 'map1')).toBe(0);
    expect(() => saveLabelAngle(throwing, 'map1', 45)).not.toThrow();
  });

  it('offers horizontal and ±45°', () => {
    expect(LABEL_ANGLES).toEqual([0, 45, -45]);
  });
});

describe('labelPivot', () => {
  it('defaults to center when nothing is stored', () => {
    expect(loadLabelPivot(fakeStorage(), 'map1')).toBe('center');
  });

  it('round-trips a valid pivot per map id', () => {
    const s = fakeStorage();
    saveLabelPivot(s, 'map1', 'left');
    expect(loadLabelPivot(s, 'map1')).toBe('left');
    // Keyed by map: another map is unaffected.
    expect(loadLabelPivot(s, 'map2')).toBe('center');
  });

  it('clears the key when set back to center (leaves no trace)', () => {
    const s = fakeStorage();
    saveLabelPivot(s, 'map1', 'top');
    saveLabelPivot(s, 'map1', 'center');
    expect(s.getItem('pointplanner.labelPivot.map1')).toBeNull();
    expect(loadLabelPivot(s, 'map1')).toBe('center');
  });

  it('falls back to center for unsupported values', () => {
    expect(loadLabelPivot(fakeStorage({ 'pointplanner.labelPivot.map1': 'sideways' }), 'map1')).toBe('center');
  });

  it('survives storage that throws (private mode / quota)', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(loadLabelPivot(throwing, 'map1')).toBe('center');
    expect(() => saveLabelPivot(throwing, 'map1', 'left')).not.toThrow();
  });

  it('offers center plus the four text-box edges', () => {
    expect(LABEL_PIVOTS).toEqual(['center', 'left', 'top', 'bottom', 'right']);
  });
});
