import { describe, it, expect } from 'vitest';
import { analyzeClosure, type RefKind } from './prClosure.ts';

/** Build a `classify` stub from a number→kind map (defaults to a missing ref). */
function classifier(map: Record<number, RefKind>) {
  return (n: number): RefKind => map[n] ?? 'missing';
}

describe('analyzeClosure', () => {
  it('accepts a body that closes each issue with its own keyword', () => {
    const { closes, violations } = analyzeClosure(
      'Add sharing',
      'Implements sharing.\n\nCloses #6\nCloses #7\n',
      classifier({ 6: 'issue-open', 7: 'issue-open' }),
    );
    expect(closes).toEqual([6, 7]);
    expect(violations).toEqual([]);
  });

  it('flags the title-range anti-pattern (#5–#11 with an empty body)', () => {
    // The real PR #12 case: issues named only in the title close nothing.
    const open: Record<number, RefKind> = {};
    for (let n = 5; n <= 11; n++) open[n] = 'issue-open';
    const { violations } = analyzeClosure(
      'feat: roadmap map generator from GitHub issues (#5–#11)',
      'No closing keywords here.',
      classifier(open),
    );
    expect(violations.map((v) => v.number)).toEqual([5, 6, 7, 8, 9, 10, 11]);
  });

  it('flags a comma-list — GitHub closes only the first id (Closes #6, #7, #11)', () => {
    // PR #33's audit row rendered this form; the real PR used one Closes line per
    // issue. Strict is correct: a comma-list strands every id past the first.
    const { closes, violations } = analyzeClosure(
      'Add label rotation',
      'Closes #6, #7, #11',
      classifier({ 6: 'issue-open', 7: 'issue-open', 11: 'issue-open' }),
    );
    expect(closes).toEqual([6]);
    expect(violations.map((v) => v.number)).toEqual([7, 11]);
    // The message names the comma-list cause, not a generic "no keyword".
    expect(violations[0].reason).toMatch(/comma-list/);
  });

  it('flags interior numbers of a range in the body (Closes #5–#11)', () => {
    const open: Record<number, RefKind> = {};
    for (let n = 5; n <= 11; n++) open[n] = 'issue-open';
    const { closes, violations } = analyzeClosure(
      'Bulk work',
      'Closes #5–#11',
      classifier(open),
    );
    expect(closes).toEqual([5]); // only the first id is registered as closed
    expect(violations.map((v) => v.number)).toEqual([6, 7, 8, 9, 10, 11]);
    expect(violations[0].reason).toMatch(/range/);
  });

  it('flags a bare body reference to an open issue', () => {
    const { violations } = analyzeClosure(
      'Tweak layout',
      'Related to #39 but not finished.',
      classifier({ 39: 'issue-open' }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].number).toBe(39);
  });

  it('treats Refs #N as a satisfied partial relationship', () => {
    const { refs, violations } = analyzeClosure(
      'Partial work',
      'Groundwork only. Refs #39',
      classifier({ 39: 'issue-open' }),
    );
    expect(refs).toEqual([39]);
    expect(violations).toEqual([]);
  });

  it('ignores cross-references to PRs and to already-closed issues', () => {
    const { violations } = analyzeClosure(
      'Follow-up to #34',
      'Builds on #34 and supersedes #21.',
      classifier({ 34: 'pr', 21: 'issue-closed' }),
    );
    expect(violations).toEqual([]);
  });

  it('does not treat HTML entities like &#39; as issue references', () => {
    const { violations } = analyzeClosure(
      "Don't break entities",
      'The user&#39;s map renders fine.',
      classifier({ 39: 'issue-open' }),
    );
    expect(violations).toEqual([]);
  });

  it('passes a PR that references no issues at all', () => {
    const { closes, refs, violations } = analyzeClosure(
      'Chore: bump deps',
      'Routine dependency bump.',
      classifier({}),
    );
    expect(closes).toEqual([]);
    expect(refs).toEqual([]);
    expect(violations).toEqual([]);
  });

  it('reports each open issue at most once even if named twice', () => {
    const { violations } = analyzeClosure(
      'Touches #8 (#8)',
      'See #8 for context.',
      classifier({ 8: 'issue-open' }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].number).toBe(8);
  });
});
