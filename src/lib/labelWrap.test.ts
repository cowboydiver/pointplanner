import { describe, it, expect } from 'vitest';
import { wrapLabel } from './labelWrap';

describe('wrapLabel', () => {
  it('keeps a short name on a single line', () => {
    expect(wrapLabel('Login flow')).toEqual(['Login flow']);
  });

  it('wraps at word boundaries past the width threshold', () => {
    const out = wrapLabel('Connect the payment provider', 18, 2);
    expect(out.length).toBe(2);
    // No word is split across lines.
    expect(out.join(' ')).toBe('Connect the payment provider');
    out.forEach(line => expect(line.length).toBeLessThanOrEqual(18));
  });

  it('caps at maxLines and ellipsizes the overflow', () => {
    const out = wrapLabel('one two three four five six seven eight', 10, 2);
    expect(out.length).toBe(2);
    expect(out[out.length - 1].endsWith('…')).toBe(true);
  });

  it('never splits a single long word', () => {
    const out = wrapLabel('supercalifragilistic word', 10, 2);
    expect(out[0]).toBe('supercalifragilistic');
  });

  it('handles empty / whitespace input', () => {
    expect(wrapLabel('')).toEqual(['']);
    expect(wrapLabel('   ')).toEqual(['']);
  });
});
