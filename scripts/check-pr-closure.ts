/**
 * CI guard: a PR that references a tracked issue must close it explicitly with a
 * keyword in the PR *body* (`Closes/Fixes/Resolves #N`), or mark a partial
 * relationship with `Refs #N`. GitHub only auto-closes issues named with a
 * keyword in the body — a bare `(#5–#11)` in the title closes nothing and
 * strands issues as open-but-done (see `.github/pull_request_template.md` and
 * `docs/agents/issue-tracker.md`).
 *
 * The text analysis (`analyzeClosure`) is pure and unit-tested; all I/O (reading
 * the PR event, resolving each `#N` to issue/PR/missing via `gh`) lives in the
 * runner at the bottom. Run in CI with `npx tsx scripts/check-pr-closure.ts`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** What a `#N` reference resolves to in the repo. */
export type RefKind = 'issue-open' | 'issue-closed' | 'pr' | 'missing';

export interface Violation {
  number: number;
  reason: string;
}

export interface ClosureResult {
  /** Issue numbers closed via a keyword in the body. */
  closes: number[];
  /** Issue numbers marked as partial via `Refs #N` in the body. */
  refs: number[];
  /** Open issues referenced without a closing/refs keyword — policy breaches. */
  violations: Violation[];
}

const CLOSING_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)/gi;
const REFS_RE = /\bref(?:s)?\s*:?\s+#(\d+)/gi;
// A bare `#N` not part of an HTML entity (`&#39;`). Lookbehind excludes `&`.
const HASH_RE = /(?<!&)#(\d+)/g;
// `#5–#11`, `#5-#11`, `#5 — 11` (en/em dash or hyphen, optional second `#`).
const RANGE_RE = /#(\d+)\s*[–—-]\s*#?(\d+)/g;

function nums(re: RegExp, text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(re)) out.push(Number(m[1]));
  return out;
}

/** Expand `#a–#b` ranges in the title to every integer they span (capped). */
function titleRangeNumbers(title: string): number[] {
  const out: number[] = [];
  for (const m of title.matchAll(RANGE_RE)) {
    const lo = Number(m[1]);
    const hi = Number(m[2]);
    if (hi < lo || hi - lo > 100) continue; // ignore degenerate / absurd spans
    for (let n = lo; n <= hi; n++) out.push(n);
  }
  return out;
}

/**
 * Pure policy check. `classify` resolves a `#N` to its kind; inject it so this
 * stays I/O-free and testable. Only *open* issues can be stranded, so they are
 * the only references that produce violations — closed issues and PR cross-refs
 * are ignored.
 */
export function analyzeClosure(
  title: string,
  body: string,
  classify: (n: number) => RefKind,
): ClosureResult {
  const closes = new Set(nums(CLOSING_RE, body));
  const refs = new Set(nums(REFS_RE, body));
  const covered = (n: number) => closes.has(n) || refs.has(n);

  // Numbers referenced anywhere that might be a stranded issue: bare in the body,
  // or named only in the title (the `(#5–#11)` anti-pattern).
  const bareBody = nums(HASH_RE, body).filter((n) => !covered(n));
  const titleOnly = [...nums(HASH_RE, title), ...titleRangeNumbers(title)].filter(
    (n) => !covered(n),
  );

  const violations: Violation[] = [];
  const seen = new Set<number>();
  const flag = (n: number, reason: string) => {
    if (seen.has(n) || classify(n) !== 'issue-open') return;
    seen.add(n);
    violations.push({ number: n, reason });
  };

  for (const n of bareBody) {
    flag(n, `open issue #${n} is referenced in the body without a Closes/Fixes/Resolves or Refs keyword`);
  }
  for (const n of titleOnly) {
    flag(n, `open issue #${n} is named only in the title — add "Closes #${n}" (or "Refs #${n}") to the body`);
  }

  return {
    closes: [...closes].sort((a, b) => a - b),
    refs: [...refs].sort((a, b) => a - b),
    violations: violations.sort((a, b) => a.number - b.number),
  };
}

// ---------------------------------------------------------------------------
// Runner (I/O): wire `analyzeClosure` to the PR event + `gh` issue lookups.
// ---------------------------------------------------------------------------

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
    '\nGitHub only auto-closes issues named with a keyword in the PR *body*.\n' +
      'Add a line per issue (each with its own keyword), e.g.:\n\n' +
      '  Closes #6\n  Closes #7\n\n' +
      'Use "Refs #N" for an issue this PR touches but does not fully resolve.\n' +
      'See .github/pull_request_template.md and docs/agents/issue-tracker.md.',
  );
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
