/**
 * CI guard: a PR that references a tracked issue must close it explicitly with a
 * keyword in the PR *body* (`Closes/Fixes/Resolves #N`, once per issue), or mark
 * a partial relationship with `Refs #N`. The pure policy logic lives in
 * `src/lib/prClosure.ts` (unit-tested); this runner is just I/O — it reads the PR
 * event and resolves each `#N` to issue/PR/missing via `gh`. Run in CI with
 * `npm run check-pr-closure`. See `docs/agents/issue-tracker.md`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { analyzeClosure, type RefKind } from '../src/lib/prClosure.ts';

function ghClassifier(repo: string): (n: number) => RefKind {
  const cache = new Map<number, RefKind>();
  return (n: number): RefKind => {
    const hit = cache.get(n);
    if (hit) return hit;
    let kind: RefKind;
    try {
      const raw = execFileSync(
        'gh',
        ['api', `repos/${repo}/issues/${n}`, '--jq', '{pr: (.pull_request != null), state: .state}'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      );
      const { pr, state } = JSON.parse(raw) as { pr: boolean; state: string };
      kind = pr ? 'pr' : state === 'open' ? 'issue-open' : 'issue-closed';
    } catch {
      kind = 'missing'; // 404 or transient error → treat as not-an-open-issue
    }
    cache.set(n, kind);
    return kind;
  };
}

function main(): void {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!eventPath || !repo) {
    console.error('Not running in a GitHub PR event context; skipping.');
    return;
  }
  const event = JSON.parse(readFileSync(eventPath, 'utf8')) as {
    pull_request?: { title?: string; body?: string | null };
  };
  const pr = event.pull_request;
  if (!pr) {
    console.error('Event has no pull_request payload; skipping.');
    return;
  }

  const title = pr.title ?? '';
  const body = pr.body ?? '';
  const { closes, refs, violations } = analyzeClosure(title, body, ghClassifier(repo));

  if (closes.length) console.log(`Closes: ${closes.map((n) => `#${n}`).join(', ')}`);
  if (refs.length) console.log(`Refs: ${refs.map((n) => `#${n}`).join(', ')}`);

  if (violations.length === 0) {
    console.log('✓ Issue-closure policy satisfied.');
    return;
  }

  console.error('\n✗ Issue-closure policy violations:\n');
  for (const v of violations) console.error(`  • ${v.reason}`);
  console.error(
    '\nGitHub only auto-closes issues named with a keyword in the PR *body*,\n' +
      'one keyword per issue (a comma-list or range closes only its first id).\n' +
      'Add a line per issue, e.g.:\n\n' +
      '  Closes #6\n  Closes #7\n\n' +
      'Use "Refs #N" for an issue this PR touches but does not fully resolve.\n' +
      'See .github/pull_request_template.md and docs/agents/issue-tracker.md.',
  );
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
