/**
 * Self-contained roadmap-map generator, bundled with the `roadmap-map` skill so
 * any repo can produce a PointPlanner map from its GitHub issues without
 * depending on the host app's source.
 *
 * It fetches issues + milestones + relationships via the `gh` CLI for the repo
 * the current working directory points at, runs the pure transform in `./lib`,
 * and writes the JSON. All network/I/O lives here; everything under `./lib` is
 * pure and vendored.
 *
 * Run it from inside the target repo's checkout (so `gh` resolves the right
 * repo), pointing at this file by path. With tsx:
 *
 *   npx tsx <skill>/scripts/generate-map.ts                  # → ./maps/roadmap.json
 *   npx tsx <skill>/scripts/generate-map.ts --filter v1.0    # → ./maps/<slug>.json
 *   npx tsx <skill>/scripts/generate-map.ts --out roadmaps   # write to ./roadmaps
 *
 * Output dir defaults to `./maps` under the current working directory; override
 * with `--out <dir>` or the `ROADMAP_MAP_DIR` env var. `gh` must be installed
 * and authenticated.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  githubToMapReport,
  scopeInputByFilter,
  slugify,
  type GitHubIssue,
  type GitHubMilestone,
  type GitHubRelationship,
  type GitHubRepoInfo,
  type GithubToMapInput,
  type DroppedEdge,
} from './lib/githubToMap';
import { validateMapData } from './lib/validateMap';

/** Parse `--filter <value>` (also `--filter=<value>`) from argv; null if absent. */
function parseFilter(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--filter') return argv[i + 1] ?? null;
    if (a.startsWith('--filter=')) return a.slice('--filter='.length);
  }
  return null;
}

/** Parse `--out <dir>` (also `--out=<dir>`) from argv; null if absent. */
function parseOut(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') return argv[i + 1] ?? null;
    if (a.startsWith('--out=')) return a.slice('--out='.length);
  }
  return null;
}

function gh(args: string[]): string {
  try {
    // Inherit the current working directory so `gh` infers the target repo from
    // the checkout the skill is being run inside.
    return execFileSync('gh', args, { encoding: 'utf8' });
  } catch (err) {
    throw new Error(
      `\`gh ${args.join(' ')}\` failed. Is the GitHub CLI installed and authenticated?`,
      { cause: err },
    );
  }
}

function fetchIssues(): GitHubIssue[] {
  // --state all → both open and closed; cap high so we get everything. `body`
  // feeds the `Depends on #N` / `Blocked by #N` text-fallback parser.
  const out = gh([
    'issue',
    'list',
    '--state',
    'all',
    '--limit',
    '1000',
    '--json',
    'number,title,state,milestone,body,labels,assignees,url',
  ]);
  return JSON.parse(out) as GitHubIssue[];
}

interface RepoCoords {
  owner: string;
  name: string;
}

function fetchRepoCoords(): RepoCoords {
  const out = gh(['repo', 'view', '--json', 'owner,name']);
  const parsed = JSON.parse(out) as { owner: { login: string }; name: string };
  return { owner: parsed.owner.login, name: parsed.name };
}

// Shape returned by the GraphQL query below.
interface GqlIssueNode {
  number: number;
  // Children (sub-issues) of this issue: each child must finish before parent.
  subIssues: { nodes: { number: number }[] };
  // Issues that block this one (this issue depends on them).
  blockedBy?: { nodes: { number: number }[] } | null;
}

/**
 * Fetch native relationships (sub-issue parent/child + `blocked by`) via the
 * GraphQL API and flatten them into plain `{ prereq, dependent }` pairs.
 *
 * - Sub-issue: child is the prereq, parent is the dependent.
 * - blockedBy: the blocking issue is the prereq, this issue is the dependent.
 *
 * The `timelineItems` BLOCKED_BY traversal is best-effort — if the schema field
 * is unavailable on this host the query falls back to sub-issues only.
 */
function fetchRelationships(coords: RepoCoords): GitHubRelationship[] {
  const query = `
    query($owner: String!, $name: String!, $cursor: String) {
      repository(owner: $owner, name: $name) {
        issues(first: 100, after: $cursor, states: [OPEN, CLOSED]) {
          pageInfo { hasNextPage endCursor }
          nodes {
            number
            subIssues(first: 100) { nodes { number } }
          }
        }
      }
    }
  `.trim();

  const rels: GitHubRelationship[] = [];
  let cursor: string | null = null;
  // Paginate defensively in case the repo grows past 100 issues.
  for (let guard = 0; guard < 100; guard++) {
    const args = [
      'api',
      'graphql',
      '-f',
      `query=${query}`,
      '-F',
      `owner=${coords.owner}`,
      '-F',
      `name=${coords.name}`,
    ];
    if (cursor) args.push('-F', `cursor=${cursor}`);

    let out: string;
    try {
      out = gh(args);
    } catch (err) {
      // Native relationship querying is best-effort; the body-text fallback in
      // the transform still supplies edges. Warn and bail out of native links.
      console.warn(
        'Native relationship query failed; relying on body-text fallback.',
        err instanceof Error ? err.message : err,
      );
      return rels;
    }

    const parsed = JSON.parse(out) as {
      data: {
        repository: {
          issues: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: GqlIssueNode[];
          };
        };
      };
    };
    const page = parsed.data.repository.issues;
    for (const node of page.nodes) {
      for (const child of node.subIssues?.nodes ?? []) {
        rels.push({ prereq: child.number, dependent: node.number });
      }
      for (const blocker of node.blockedBy?.nodes ?? []) {
        rels.push({ prereq: blocker.number, dependent: node.number });
      }
    }
    if (!page.pageInfo.hasNextPage) break;
    cursor = page.pageInfo.endCursor;
  }
  return rels;
}

function fetchMilestones(): GitHubMilestone[] {
  // gh has no first-class milestone list command; use the REST API. Milestones
  // are returned in creation order, which gives a deterministic line order.
  const out = gh([
    'api',
    'repos/{owner}/{repo}/milestones?state=all&per_page=100',
    '--jq',
    '[.[] | { title: .title, number: .number, dueOn: .due_on }]',
  ]);
  return JSON.parse(out) as GitHubMilestone[];
}

function fetchRepoInfo(): GitHubRepoInfo {
  const out = gh(['repo', 'view', '--json', 'name,description']);
  return JSON.parse(out) as GitHubRepoInfo;
}

/** Human-readable one-liner per dropped edge, for stdout reporting. */
function describeDropped(d: DroppedEdge): string {
  const reason =
    d.reason === 'self'
      ? 'self-reference'
      : d.reason === 'duplicate'
        ? 'duplicate edge'
        : 'cycle-breaking';
  return `  - #${d.prereq} → #${d.dependent} (${reason})`;
}

function main(): void {
  const argv = process.argv.slice(2);
  const filter = parseFilter(argv);
  // Output dir is resolved against the current working directory (the target
  // repo's checkout), not this script's location — the skill lives elsewhere.
  const mapsDir = resolve(
    process.cwd(),
    parseOut(argv) ?? process.env.ROADMAP_MAP_DIR ?? 'maps',
  );

  const issues = fetchIssues();
  const milestones = fetchMilestones();
  const repo = fetchRepoInfo();
  const relationships = fetchRelationships(fetchRepoCoords());

  let input: GithubToMapInput = { issues, milestones, repo, relationships };
  // For a filtered map, name = `<repo> — <filter>`; subtitle stays the repo
  // description. Bare run keeps the repo name/subtitle the transform derives.
  let outFile = 'roadmap.json';
  if (filter) {
    input = scopeInputByFilter(input, filter);
    input = {
      ...input,
      repo: {
        ...repo,
        name: `${repo.name ?? 'Roadmap'} — ${filter}`,
      },
    };
    outFile = `${slugify(filter)}.json`;
  }

  const { map, dropped } = githubToMapReport(input);

  // Report dropped edges so the user can fix the underlying issues.
  if (dropped.length) {
    console.log(`Dropped ${dropped.length} edge(s):`);
    for (const d of dropped) console.log(describeDropped(d));
  }

  // Refuse to write a malformed map.
  const errors = validateMapData(map);
  if (errors.length) {
    console.error('Refusing to write malformed map:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const outPath = resolve(mapsDir, outFile);
  mkdirSync(mapsDir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(map, null, 2) + '\n', 'utf8');

  console.log(
    `Wrote ${outPath} — ${map.stations.length} stations across ${map.lines.length} lines.`,
  );
}

main();
