/**
 * Pure policy logic for the PR issue-closure CI guard.
 *
 * GitHub only auto-closes an issue when the PR *body* names it with a keyword —
 * `Closes/Fixes/Resolves #N` — once per issue. A bare `#N`, an issue named only
 * in the title (the `(#5–#11)` anti-pattern), a comma-list (`Closes #6, #7` only
 * closes #6), or a range (`Closes #5–#11` only closes #5) strands the rest as
 * open-but-done. `analyzeClosure` is I/O-free and dependency-injected (the caller
 * supplies a `classify` that resolves each `#N`); the `gh`-backed runner lives in
 * `scripts/check-pr-closure.ts`. See `docs/agents/issue-tracker.md`.
 */

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
// A closing keyword followed by a comma-list: `Closes #6, #7, #11`. GitHub
// closes only the first id; the trailing ones are stranded.
const COMMA_CHAIN_RE =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#\d+(?:\s*,\s*#\d+)+/gi;

function nums(re: RegExp, text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(re)) out.push(Number(m[1]));
  return out;
}

/** Expand every `#a–#b` range in `text` to the integers it spans (capped). */
function rangeNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(RANGE_RE)) {
    const lo = Number(m[1]);
    const hi = Number(m[2]);
    if (hi < lo || hi - lo > 100) continue; // ignore degenerate / absurd spans
    for (let n = lo; n <= hi; n++) out.push(n);
  }
  return out;
}

/**
 * Numbers that trail a closing keyword in a comma-list (`Closes #6, #7` → {7}).
 * GitHub auto-closes only the first id, so these are stranded despite the keyword.
 */
function commaListStrays(body: string): Set<number> {
  const out = new Set<number>();
  for (const m of body.matchAll(COMMA_CHAIN_RE)) {
    const ids = nums(HASH_RE, m[0]);
    ids.slice(1).forEach((n) => out.add(n));
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

  const strays = commaListStrays(body);
  const bodyRanges = new Set(rangeNumbers(body));

  // Numbers that might be a stranded issue: bare or range-interior in the body
  // (incl. comma-list trailers, which `closes` doesn't cover past the first id),
  // or named only in the title (the `(#5–#11)` anti-pattern).
  const bodyCandidates = [...nums(HASH_RE, body), ...bodyRanges].filter(
    (n) => !covered(n),
  );
  const titleCandidates = [...nums(HASH_RE, title), ...rangeNumbers(title)].filter(
    (n) => !covered(n),
  );

  const bodyReason = (n: number): string => {
    if (strays.has(n))
      return `open issue #${n} trails a closing keyword in a comma-list ("Closes #a, #${n}") — GitHub auto-closes only the first id; give #${n} its own "Closes #${n}" line`;
    if (bodyRanges.has(n))
      return `open issue #${n} falls inside a "#a–#b" range in the body — a range auto-closes nothing past the first id; add "Closes #${n}" (or "Refs #${n}")`;
    return `open issue #${n} is referenced in the body without a Closes/Fixes/Resolves or Refs keyword`;
  };

  const violations: Violation[] = [];
  const seen = new Set<number>();
  const flag = (n: number, reason: string) => {
    if (seen.has(n) || classify(n) !== 'issue-open') return;
    seen.add(n);
    violations.push({ number: n, reason });
  };

  for (const n of bodyCandidates) flag(n, bodyReason(n));
  for (const n of titleCandidates) {
    flag(n, `open issue #${n} is named only in the title — add "Closes #${n}" (or "Refs #${n}") to the body`);
  }

  return {
    closes: [...closes].sort((a, b) => a - b),
    refs: [...refs].sort((a, b) => a - b),
    violations: violations.sort((a, b) => a.number - b.number),
  };
}
