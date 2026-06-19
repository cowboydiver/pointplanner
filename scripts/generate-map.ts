/**
 * Generator: fetch GitHub issues + milestones via `gh` for the repo this clone
 * points at, run the pure transform, and write `maps/roadmap.json`.
 *
 * All network/I/O lives here; the transform in `src/lib/githubToMap.ts` stays
 * pure and unit-tested. Run with `npm run generate-map`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  githubToMapReport,
  scopeInputByFilter,
  slugify,
  type GithubToMapInput,
  type DroppedEdge,
} from '../src/lib/githubToMap.ts';
import { validateMapData } from '../src/lib/validateMap.ts';
import {
  fetchIssues,
  fetchMilestones,
  fetchRelationships,
  fetchRepoCoords,
  fetchRepoInfo,
} from './githubFetch.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const MAPS_DIR = resolve(repoRoot, 'maps');

/** Parse `--filter <value>` (also `--filter=<value>`) from argv; null if absent. */
function parseFilter(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--filter') return argv[i + 1] ?? null;
    if (a.startsWith('--filter=')) return a.slice('--filter='.length);
  }
  return null;
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
  const filter = parseFilter(process.argv.slice(2));

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

  const outPath = resolve(MAPS_DIR, outFile);
  mkdirSync(MAPS_DIR, { recursive: true });
  writeFileSync(outPath, JSON.stringify(map, null, 2) + '\n', 'utf8');

  console.log(
    `Wrote ${outPath} — ${map.stations.length} stations across ${map.lines.length} lines.`,
  );
}

main();
