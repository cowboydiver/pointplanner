/**
 * Generator: fetch GitHub issues + milestones via `gh` for the repo this clone
 * points at, run the pure transform, and write `maps/roadmap.json`.
 *
 * All network/I/O lives here; the transform in `src/lib/githubToMap.ts` stays
 * pure and unit-tested. Run with `npm run generate-map`.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  githubToMap,
  type GitHubIssue,
  type GitHubMilestone,
  type GitHubRepoInfo,
} from '../src/lib/githubToMap.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const OUT_PATH = resolve(repoRoot, 'maps/roadmap.json');

function gh(args: string[]): string {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', cwd: repoRoot });
  } catch (err) {
    throw new Error(
      `\`gh ${args.join(' ')}\` failed. Is the GitHub CLI installed and authenticated?`,
      { cause: err },
    );
  }
}

function fetchIssues(): GitHubIssue[] {
  // --state all → both open and closed; cap high so we get everything.
  const out = gh([
    'issue',
    'list',
    '--state',
    'all',
    '--limit',
    '1000',
    '--json',
    'number,title,state,milestone',
  ]);
  return JSON.parse(out) as GitHubIssue[];
}

function fetchMilestones(): GitHubMilestone[] {
  // gh has no first-class milestone list command; use the REST API. Milestones
  // are returned in creation order, which gives a deterministic line order.
  const out = gh([
    'api',
    'repos/{owner}/{repo}/milestones?state=all&per_page=100',
    '--jq',
    '[.[] | { title: .title, number: .number }]',
  ]);
  return JSON.parse(out) as GitHubMilestone[];
}

function fetchRepoInfo(): GitHubRepoInfo {
  const out = gh(['repo', 'view', '--json', 'name,description']);
  return JSON.parse(out) as GitHubRepoInfo;
}

function main(): void {
  const issues = fetchIssues();
  const milestones = fetchMilestones();
  const repo = fetchRepoInfo();

  const map = githubToMap({ issues, milestones, repo });

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(map, null, 2) + '\n', 'utf8');

  console.log(
    `Wrote ${OUT_PATH} — ${map.stations.length} stations across ${map.lines.length} lines.`,
  );
}

main();
