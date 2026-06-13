import { describe, it, expect } from 'vitest';
import { githubToMap, type GitHubIssue, type GitHubMilestone } from './githubToMap';
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
    expect(map.edges).toEqual([]);
    expect(map.stations).toHaveLength(issues.length);
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

  it('maps closed → done and open → available', () => {
    const map = githubToMap({ issues, milestones });
    const closed = map.stations.find(s => s.name === 'Set up design system')!;
    const open = map.stations.find(s => s.name === 'Build component library')!;
    expect(closed.status).toBe('done');
    expect(open.status).toBe('available');
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
});
