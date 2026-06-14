import { describe, it, expect } from 'vitest';
import { committedSourceId } from './committedReimport';

describe('committedSourceId', () => {
  it('returns the committed file id for a committed-backed map id', () => {
    expect(committedSourceId('committed-roadmap')).toBe('roadmap');
  });

  it('returns null for a non-committed map id', () => {
    expect(committedSourceId('seed-roadmap')).toBeNull();
    expect(committedSourceId('blank-123')).toBeNull();
  });
});
