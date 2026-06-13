import { describe, it, expect } from 'vitest';
import {
  githubToMap,
  githubToMapReport,
  scopeInputByFilter,
  slugify,
  type GitHubIssue,
  type GitHubMilestone,
  type GitHubRelationship,
} from './githubToMap';
import { validateMapData } from './validateMap';
import issuesFixture from './__fixtures__/issues.json';
import milestonesFixture from './__fixtures__/milestones.json';

const issues = issuesFixture as GitHubIssue[];
const milestones = milestonesFixture as GitHubMilestone[];

describe('githubToMap', () => {
  it('produces a structurally valid MapData', () => {
    const map = githubToMap({ issues, milestones });
    expect(map).toHaveProperty('project');
    expect(map).toHaveProperty('lines');
    expect(map).toHaveProperty('stations');
    expect(map).toHaveProperty('edges');
    expect(Array.isArray(map.edges)).toBe(true);
  });

  it('turns each milestone into a line, in order, with deterministic color + short', () => {
    const map = githubToMap({ issues, milestones });
    const milestoneLines = map.lines.filter(l => l.name !== 'Backlog');
    expect(milestoneLines.map(l => l.name)).toEqual(['Design Phase', 'Build Phase']);
    // Deterministic: stable colors and 2-letter short codes.
    expect(milestoneLines[0]).toMatchObject({ name: 'Design Phase', color: '#D8392F', short: 'DP' });
    expect(milestoneLines[1]).toMatchObject({ name: 'Build Phase', color: '#2563C9', short: 'BP' });
    // Short codes are unique.
    const shorts = map.lines.map(l => l.short);
    expect(new Set(shorts).size).toBe(shorts.length);
  });

  it('places milestone issues on their milestone line', () => {
    const map = githubToMap({ issues, milestones });
    const designLine = map.lines.find(l => l.name === 'Design Phase')!;
    const issue1 = map.stations.find(s => s.name === 'Set up design system')!;
    const issue2 = map.stations.find(s => s.name === 'Build component library')!;
    expect(issue1.lines).toEqual([designLine.id]);
    expect(issue2.lines).toEqual([designLine.id]);
  });

  it('falls back to a Backlog line for issues with no milestone', () => {
    const map = githubToMap({ issues, milestones });
    const backlog = map.lines.find(l => l.name === 'Backlog');
    expect(backlog).toBeDefined();
    const orphan = map.stations.find(s => s.name === 'Investigate flaky test')!;
    expect(orphan.lines).toEqual([backlog!.id]);
  });

  it('does not create a Backlog line when every issue has a milestone', () => {
    const map = githubToMap({
      issues: issues.filter(i => i.milestone),
      milestones,
    });
    expect(map.lines.find(l => l.name === 'Backlog')).toBeUndefined();
  });

  it('maps a referenced closed issue → done', () => {
    const map = githubToMap({ issues, milestones });
    // #1 is closed but #2 (open) depends on it, so it surfaces as a done prereq.
    const closed = map.stations.find(s => s.name === 'Set up design system')!;
    expect(closed.status).toBe('done');
  });

  it('lays out col by index within line, row by line band', () => {
    const map = githubToMap({ issues, milestones });
    const designLine = map.lines.find(l => l.name === 'Design Phase')!;
    const buildLine = map.lines.find(l => l.name === 'Build Phase')!;
    const designStations = map.stations.filter(s => s.lines[0] === designLine.id);
    // Two design issues sit on the same row band, columns 0 and 1.
    expect(designStations.map(s => s.col).sort()).toEqual([0, 1]);
    expect(new Set(designStations.map(s => s.row)).size).toBe(1);
    // Different lines occupy different row bands.
    const buildStation = map.stations.find(s => s.lines[0] === buildLine.id)!;
    expect(buildStation.row).not.toBe(designStations[0].row);
  });

  it('fills required Station fields with placeholders', () => {
    const map = githubToMap({ issues, milestones });
    const s = map.stations[0];
    expect(s.desc).toBeTruthy();
    expect(s.owner).toBeTruthy();
    expect(s.tags).toEqual([]);
    expect(s.lp).toBe('top');
  });

  // ---- Issue #6: dependencies → edges + status cascade ----

  it('parses `Depends on #N` / `Blocked by #N` body text into edges', () => {
    const map = githubToMap({ issues, milestones });
    // #2 "Depends on #1", #3 "Blocked by #2".
    expect(map.edges).toContainEqual(
      expect.objectContaining({ from: 'issue-1', to: 'issue-2' }),
    );
    expect(map.edges).toContainEqual(
      expect.objectContaining({ from: 'issue-2', to: 'issue-3' }),
    );
  });

  it('colors each edge by the downstream (to) station line; df is omitted', () => {
    const map = githubToMap({ issues, milestones });
    const designLine = map.lines.find(l => l.name === 'Design Phase')!;
    const buildLine = map.lines.find(l => l.name === 'Build Phase')!;
    // #1→#2 both Design Phase → design line color.
    const e12 = map.edges.find(e => e.from === 'issue-1' && e.to === 'issue-2')!;
    expect(e12.line).toBe(designLine.id);
    expect(e12.df).toBeUndefined();
    // #2 (Design) → #3 (Build): colored by the downstream Build line.
    const e23 = map.edges.find(e => e.from === 'issue-2' && e.to === 'issue-3')!;
    expect(e23.line).toBe(buildLine.id);
    expect(e23.df).toBeUndefined();
  });

  it('builds edges from native relationships (sub-issue / blocked-by)', () => {
    // No body-text deps; supply the same links natively instead.
    const bodiless = issues.map(i => ({ ...i, body: '' }));
    const relationships: GitHubRelationship[] = [
      { prereq: 1, dependent: 2 },
      { prereq: 2, dependent: 3 },
    ];
    const map = githubToMap({ issues: bodiless, milestones, relationships });
    expect(map.edges).toContainEqual(
      expect.objectContaining({ from: 'issue-1', to: 'issue-2' }),
    );
    expect(map.edges).toContainEqual(
      expect.objectContaining({ from: 'issue-2', to: 'issue-3' }),
    );
  });

  it('dedupes a relationship that also appears as body text', () => {
    // #2 "Depends on #1" in body AND a native link for the same pair.
    const relationships: GitHubRelationship[] = [{ prereq: 1, dependent: 2 }];
    const map = githubToMap({ issues, milestones, relationships });
    const matches = map.edges.filter(e => e.from === 'issue-1' && e.to === 'issue-2');
    expect(matches).toHaveLength(1);
  });

  it('includes a closed issue only when an open issue depends on it', () => {
    const map = githubToMap({ issues, milestones });
    // #1 closed, depended on by open #2 → present.
    expect(map.stations.find(s => s.id === 'issue-1')).toBeDefined();
    // #5 closed, nobody depends on it → excluded.
    expect(map.stations.find(s => s.id === 'issue-5')).toBeUndefined();
  });

  it('runs recompute so open stations settle to locked / available', () => {
    const map = githubToMap({ issues, milestones });
    // #1 done → #2 (its only prereq is done) is available.
    const s2 = map.stations.find(s => s.id === 'issue-2')!;
    expect(s2.status).toBe('available');
    // #3 depends on still-open #2 → locked.
    const s3 = map.stations.find(s => s.id === 'issue-3')!;
    expect(s3.status).toBe('locked');
    // #4 has no prereqs → available.
    const s4 = map.stations.find(s => s.id === 'issue-4')!;
    expect(s4.status).toBe('available');
  });

  // ---- Issue #9: robustness — cycles, self/dup edges, validity ----

  const open = (number: number, title: string): GitHubIssue => ({
    number,
    title,
    state: 'open',
    milestone: null,
    body: '',
  });

  it('breaks a dependency cycle deterministically and reports the dropped edge', () => {
    const issues = [open(1, 'A'), open(2, 'B')];
    const relationships: GitHubRelationship[] = [
      { prereq: 1, dependent: 2 },
      { prereq: 2, dependent: 1 },
    ];
    const { map, dropped } = githubToMapReport({ issues, milestones: [], relationships });
    // Exactly one cycle-closing edge dropped; the surviving graph is acyclic.
    const cycleDrops = dropped.filter(d => d.reason === 'cycle');
    expect(cycleDrops).toEqual([{ prereq: 1, dependent: 2, reason: 'cycle' }]);
    expect(map.edges).toEqual([
      expect.objectContaining({ from: 'issue-2', to: 'issue-1' }),
    ]);
    expect(validateMapData(map)).toEqual([]);
  });

  it('is deterministic across input orderings of a cycle', () => {
    const issues = [open(1, 'A'), open(2, 'B')];
    const a = githubToMapReport({
      issues,
      milestones: [],
      relationships: [
        { prereq: 1, dependent: 2 },
        { prereq: 2, dependent: 1 },
      ],
    });
    const b = githubToMapReport({
      issues,
      milestones: [],
      relationships: [
        { prereq: 2, dependent: 1 },
        { prereq: 1, dependent: 2 },
      ],
    });
    expect(a.dropped).toEqual(b.dropped);
    expect(a.map.edges).toEqual(b.map.edges);
  });

  it('drops a self-edge and reports it', () => {
    const issues = [open(1, 'A')];
    const { map, dropped } = githubToMapReport({
      issues,
      milestones: [],
      relationships: [{ prereq: 1, dependent: 1 }],
    });
    expect(dropped).toContainEqual({ prereq: 1, dependent: 1, reason: 'self' });
    expect(map.edges).toEqual([]);
  });

  it('drops a duplicate edge (native + body) and reports one drop', () => {
    const issues = [open(1, 'A'), { ...open(2, 'B'), body: 'Depends on #1' }];
    const { map, dropped } = githubToMapReport({
      issues,
      milestones: [],
      relationships: [{ prereq: 1, dependent: 2 }],
    });
    expect(map.edges.filter(e => e.from === 'issue-1' && e.to === 'issue-2')).toHaveLength(1);
    expect(dropped).toContainEqual({ prereq: 1, dependent: 2, reason: 'duplicate' });
  });

  it('emits a valid Backlog-only map for empty input', () => {
    const map = githubToMap({ issues: [], milestones: [] });
    expect(map.lines).toEqual([expect.objectContaining({ name: 'Backlog' })]);
    expect(map.stations).toEqual([]);
    expect(map.edges).toEqual([]);
    expect(validateMapData(map)).toEqual([]);
  });

  // ---- Issue #9: scoping via --filter ----

  it('slugify lowercases and hyphenates, falling back to "map"', () => {
    expect(slugify('Build Phase')).toBe('build-phase');
    expect(slugify('  Q3 / 2026!! ')).toBe('q3-2026');
    expect(slugify('!!!')).toBe('map');
  });

  it('scopes input to issues matching a milestone title (by slug)', () => {
    const scoped = scopeInputByFilter({ issues, milestones }, 'Design Phase');
    const map = githubToMap(scoped);
    // Only Design Phase issues survive; Build Phase line is gone.
    expect(map.lines.map(l => l.name)).toEqual(['Design Phase']);
    expect(map.stations.every(s => s.lines[0] === map.lines[0].id)).toBe(true);
    expect(validateMapData(map)).toEqual([]);
  });

  it('scopes input to issues matching a label (by slug)', () => {
    const labelled: GitHubIssue[] = [
      { ...open(1, 'Has it'), labels: [{ name: 'High Priority' }] },
      { ...open(2, 'Lacks it'), labels: [{ name: 'chore' }] },
    ];
    const scoped = scopeInputByFilter({ issues: labelled, milestones: [] }, 'high-priority');
    expect(scoped.issues.map(i => i.number)).toEqual([1]);
  });
});
