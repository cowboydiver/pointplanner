import { describe, it, expect } from 'vitest';
import { lineIdFromName, deriveShort, normalizeShort } from './lines';

describe('lineIdFromName', () => {
  it('slugifies a name', () => {
    expect(lineIdFromName('Marketing Line', [])).toBe('marketing-line');
  });

  it('dedupes against existing ids', () => {
    expect(lineIdFromName('Design', ['design'])).toBe('design-2');
    expect(lineIdFromName('Design', ['design', 'design-2'])).toBe('design-3');
  });

  it('falls back to "line" for empty/symbol-only names', () => {
    expect(lineIdFromName('   ', [])).toBe('line');
    expect(lineIdFromName('!!!', [])).toBe('line');
  });
});

describe('deriveShort', () => {
  it('uses first letters of the first two words', () => {
    expect(deriveShort('Design Line')).toBe('DL');
    expect(deriveShort('go to market')).toBe('GT');
  });

  it('uses first two letters of a single word', () => {
    expect(deriveShort('Marketing')).toBe('MA');
  });

  it('falls back to LN when empty', () => {
    expect(deriveShort('   ')).toBe('LN');
  });
});

describe('normalizeShort', () => {
  it('uppercases and caps at 3 chars', () => {
    expect(normalizeShort('abcd', 'Whatever')).toBe('ABC');
  });

  it('derives from the name when blank', () => {
    expect(normalizeShort('', 'Design Line')).toBe('DL');
  });
});
