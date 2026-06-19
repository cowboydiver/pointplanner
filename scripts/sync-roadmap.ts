/**
 * Sync the repo's GitHub issues into the canonical, public-read roadmap row in
 * Supabase. Triggered by .github/workflows/sync-roadmap.yml on issue activity and
 * nightly. Reuses the same fetch + pure transform + validation as the
 * `generate-map` script, then overwrites the cloud row via the service role
 * (GitHub wins). Run with `npm run sync-roadmap`.
 */
import { createClient } from '@supabase/supabase-js';
import {
  githubToMapReport,
  scopeInputByFilter,
  type GithubToMapInput,
  type DroppedEdge,
} from '../src/lib/githubToMap.ts';
import { validateMapData } from '../src/lib/validateMap.ts';
import { buildGithubSource, upsertSyncedMap } from '../src/data/roadmapSync.ts';
import {
  fetchIssues,
  fetchMilestones,
  fetchRelationships,
  fetchRepoCoords,
  fetchRepoInfo,
} from './githubFetch.ts';

/** Parse `--filter <value>` (also `--filter=<value>`) from argv; null if absent. */
function parseFilter(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--filter') return argv[i + 1] ?? null;
    if (a.startsWith('--filter=')) return a.slice('--filter='.length);
  }
  return null;
}

function describeDropped(d: DroppedEdge): string {
  const reason =
    d.reason === 'self'
      ? 'self-reference'
      : d.reason === 'duplicate'
        ? 'duplicate edge'
        : 'cycle-breaking';
  return `  - #${d.prereq} → #${d.dependent} (${reason})`;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var ${name}. Set it in the workflow secrets.`);
    process.exit(1);
  }
  return v;
}

async function main(): Promise<void> {
  const filter = parseFilter(process.argv.slice(2));

  const supabaseUrl = requireEnv('SUPABASE_URL');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  const coords = fetchRepoCoords();
  const issues = fetchIssues();
  const milestones = fetchMilestones();
  const repo = fetchRepoInfo();
  const relationships = fetchRelationships(coords);

  let input: GithubToMapInput = { issues, milestones, repo, relationships };
  let name = repo.name ?? 'Roadmap';
  if (filter) {
    input = scopeInputByFilter(input, filter);
    name = `${repo.name ?? 'Roadmap'} — ${filter}`;
    input = { ...input, repo: { ...repo, name } };
  }

  const { map, dropped } = githubToMapReport(input);

  if (dropped.length) {
    console.log(`Dropped ${dropped.length} edge(s):`);
    for (const d of dropped) console.log(describeDropped(d));
  }

  // Refuse to push a malformed map — same gate as generate-map.
  const errors = validateMapData(map);
  if (errors.length) {
    console.error('Refusing to push malformed map:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  // Service-role client: bypasses RLS so it can write the owner-less public row.
  const client = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const source = buildGithubSource(coords.owner, coords.name, filter);
  const result = await upsertSyncedMap(client, source, name, map);

  console.log(
    `${result.inserted ? 'Inserted' : 'Updated'} synced map ${result.id} ` +
      `(v${result.version}) — ${map.stations.length} stations across ${map.lines.length} lines.`,
  );
}

main().catch(err => {
  console.error('Roadmap sync failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
