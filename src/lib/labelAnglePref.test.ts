import { describe, it, expect } from 'vitest';
import { loadLabelAngle, saveLabelAngle, LABEL_ANGLES } from './labelAnglePref';

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

  it('only offers horizontal and 45°', () => {
    expect(LABEL_ANGLES).toEqual([0, 45]);
  });
});
