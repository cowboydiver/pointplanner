import type { Line, Station, Edge } from '../types.ts';
import type { MapData } from './maps.ts';
import { PLACEHOLDER_DESC, PLACEHOLDER_OWNER, PLACEHOLDER_DASH } from './placeholders.ts';
import { buildIndexes } from './indexes.ts';
import { recompute } from './dependencies.ts';
import { layoutStations, type LayoutNode } from './layout.ts';

// Plain-object shapes matching what `gh` returns (subset we rely on). The
// generator script feeds these straight through; keep this module I/O-free so
// it stays unit-testable.
export interface GitHubMilestone {
  title: string;
  number?: number;
  /** ISO date string (`gh` exposes this as `dueOn`); used for a station's `due`. */
  dueOn?: string | null;
}

export interface GitHubLabel {
  name: string;
}

export interface GitHubUser {
  login: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  state: string; // 'open' | 'closed' | 'OPEN' | 'CLOSED'
  milestone?: GitHubMilestone | null;
  body?: string | null;
  labels?: GitHubLabel[];
  assignees?: GitHubUser[];
  /** Permalink to the issue (`gh` exposes this as `url`). */
  url?: string | null;
}

export interface GitHubRepoInfo {
  name?: string;
  description?: string;
}

/**
 * Native GitHub relationships, resolved to plain issue-number pairs by the
 * generator script (all `gh api graphql` I/O lives there). Each entry says
 * "issue `dependent` depends on / is blocked by issue `prereq`" — i.e. `prereq`
 * must complete first. Sub-issue parent/child links are expressed the same way:
 * the child is the `prereq`, the parent the `dependent`.
 */
export interface GitHubRelationship {
  dependent: number; // downstream issue (`to`)
  prereq: number; // upstream issue that must finish first (`from`)
}

export interface GithubToMapInput {
  issues: GitHubIssue[];
  milestones: GitHubMilestone[];
  repo?: GitHubRepoInfo;
  /** Native relationships resolved by the script (sub-issues + blocked-by). */
  relationships?: GitHubRelationship[];
}

/** Why a dependency edge was dropped during the transform. */
export type DroppedReason = 'self' | 'duplicate' | 'cycle';

/** A dependency edge the transform discarded, with a human-readable reason. */
export interface DroppedEdge {
  prereq: number; // upstream issue (`from`)
  dependent: number; // downstream issue (`to`)
  reason: DroppedReason;
}

/** Result of the transform plus the list of edges it had to drop. */
export interface GithubToMapResult {
  map: MapData;
  dropped: DroppedEdge[];
}

const BACKLOG_LINE_ID = 'backlog';

/**
 * Lowercase, hyphenated slug for filenames / ids (e.g. `"Build Phase"` →
 * `"build-phase"`). Empty / symbol-only input falls back to `'map'`.
 */
export function slugify(raw: string): string {
  return (
    raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'map'
  );
}

/**
 * Delimiters that separate a shared title prefix (the would-be line name) from
 * the issue-specific remainder. The spaced hyphen ` - ` is intentional — a bare
 * `-` would split hyphenated words like "Cloud-backed". Tried in order; the
 * earliest match in the title wins.
 */
const PREFIX_DELIMITERS = [':', '—', '–', ' - '];

/**
 * Split a title on its first prefix delimiter into `{ prefix, rest }`, both
 * trimmed and verbatim (original casing). Returns null when no delimiter is
 * present (the title can't contribute to a shared-prefix line). An empty prefix
 * or empty remainder also yields null — neither side is usable.
 */
export function splitTitlePrefix(
  title: string,
): { prefix: string; rest: string } | null {
  let best: { index: number; len: number } | null = null;
  for (const delim of PREFIX_DELIMITERS) {
    const idx = title.indexOf(delim);
    if (idx >= 0 && (best === null || idx < best.index)) {
      best = { index: idx, len: delim.length };
    }
  }
  if (best === null) return null;
  const prefix = title.slice(0, best.index).trim();
  const rest = title.slice(best.index + best.len).trim();
  if (!prefix || !rest) return null;
  return { prefix, rest };
}

/** Uppercase the first character, leaving the rest of the string untouched. */
function capitalizeFirst(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Result of {@link stripSharedPrefixes} for one name. */
export interface PrefixStripResult {
  /** The name with its shared leading words removed (capitalized). */
  name: string;
  /** The stripped leading words, to surface as a tag — or null if nothing shared. */
  tag: string | null;
}

/**
 * Collapse leading whole words shared by 2+ names into a tag, shortening labels
 * that all start the same way (e.g. "Map generation — routing" /
 * "Map generation — labels" → name "routing"/"labels", tag "Map generation —").
 *
 * For each name, picks the LONGEST leading whole-word prefix (always leaving ≥1
 * remainder word) that is shared, case-insensitively, by at least one other name.
 * Words are never split mid-word. Pure and order-stable; the returned array is
 * aligned with the input.
 */
export function stripSharedPrefixes(names: string[]): PrefixStripResult[] {
  const tokens = names.map(n => n.trim().split(/\s+/).filter(Boolean));

  // Count how many names share each leading-word prefix (lowercased key), for
  // prefix lengths 1..len-1 — never the whole name, so a remainder always exists.
  const counts = new Map<string, number>();
  for (const words of tokens) {
    for (let len = 1; len < words.length; len++) {
      const key = words.slice(0, len).join(' ').toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  return tokens.map(words => {
    let chosen = 0;
    for (let len = 1; len < words.length; len++) {
      const key = words.slice(0, len).join(' ').toLowerCase();
      if ((counts.get(key) ?? 0) >= 2) chosen = len;
    }
    if (chosen === 0) return { name: words.join(' '), tag: null };
    return {
      name: capitalizeFirst(words.slice(chosen).join(' ')),
      tag: words.slice(0, chosen).join(' '),
    };
  });
}

/**
 * Scope a transform input to issues matching `filter` (a label name or a
 * milestone title, matched case-insensitively by slug). Returns a new input with
 * only the matching issues and only the milestones those issues reference, so a
 * filtered map carries no empty lines. Pure — the script slugifies the filter
 * for the output filename and decorates `project.name`.
 *
 * Relationships are kept as-is; the transform already drops edges whose
 * endpoints aren't stations, so cross-scope links fall away cleanly.
 */
export function scopeInputByFilter(
  input: GithubToMapInput,
  filter: string,
): GithubToMapInput {
  const target = slugify(filter);
  const matches = (iss: GitHubIssue): boolean => {
    if (iss.milestone && slugify(iss.milestone.title) === target) return true;
    return (iss.labels ?? []).some(l => slugify(l.name) === target);
  };

  const issues = input.issues.filter(matches);
  const keptMilestones = new Set(
    issues.map(iss => iss.milestone?.title).filter((t): t is string => !!t),
  );
  const milestones = input.milestones.filter(m => keptMilestones.has(m.title));

  return { ...input, issues, milestones };
}

// Deterministic palette, cycled by line order. Mirrors the seed line colors so
// generated maps look at home next to hand-authored ones.
const LINE_COLORS = [
  '#D8392F',
  '#2563C9',
  '#1E9C55',
  '#E0962A',
  '#7A4DD0',
  '#0E9AA7',
  '#C2477E',
  '#5B7A1E',
];

function slugifyId(raw: string, used: Set<string>): string {
  const base =
    raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'line';
  let id = base;
  let n = 2;
  while (used.has(id)) {
    id = base + '-' + n;
    n++;
  }
  used.add(id);
  return id;
}

// Deterministic 2-letter short code derived from the title's word initials,
// falling back to the first two letters. Disambiguated against codes already
// taken so legend badges stay unique.
function shortCode(title: string, used: Set<string>): string {
  const words = title.replace(/[^a-zA-Z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  let base: string;
  if (words.length >= 2) {
    base = (words[0][0] + words[1][0]).toUpperCase();
  } else if (words.length === 1 && words[0].length >= 2) {
    base = words[0].slice(0, 2).toUpperCase();
  } else if (words.length === 1) {
    base = (words[0][0] + 'X').toUpperCase();
  } else {
    base = 'LN';
  }

  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  // Disambiguate: keep first letter, cycle second through A-Z then digits.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  for (const ch of alphabet) {
    const candidate = base[0] + ch;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  used.add(base);
  return base;
}

function isClosed(state: string): boolean {
  return state.toLowerCase() === 'closed';
}

/** Pull every `#123` reference out of a captured run into issue numbers. */
function refsToNumbers(run: string): number[] {
  const nums = run.match(/#(\d+)/g) || [];
  return nums.map(n => parseInt(n.slice(1), 10));
}

/**
 * After a relationship keyword, the run of issue references that belongs to it.
 * Tolerates an optional `:` then any mix of whitespace, blank lines, commas and
 * markdown bullet markers (`-` / `*`) interleaved with `#N` refs — so a keyword
 * used as a markdown heading over a bulleted list is captured, e.g.
 *
 *   ## Blocked by
 *
 *   - #52
 *   - #30
 *
 * The run ends at the first character that is none of those (a letter, `:`,
 * `[`, …), so the next paragraph or section doesn't bleed in. The alternatives
 * never overlap on their first character, so there is no catastrophic backtracking.
 */
const REF_RUN = '\\s*:?((?:[\\s,]|[-*]|#\\d+)+)';

/**
 * Parse `Depends on #N` / `Blocked by #N` text from an issue body. Returns the
 * referenced issue numbers (the prereqs this issue depends on). Case-insensitive;
 * tolerates same-line lists ("Depends on #1, #2") and the markdown heading +
 * bulleted list form (see {@link REF_RUN}).
 */
function parseBodyDeps(body: string | null | undefined): number[] {
  if (!body) return [];
  const out: number[] = [];
  const re = new RegExp(`(?:depends on|blocked by)${REF_RUN}`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    for (const n of refsToNumbers(m[1])) out.push(n);
  }
  return out;
}

/**
 * Parse `Parent: #N` / `Epic: #N` / `Tracked by #N` text from an issue body.
 * Returns the referenced issue numbers — the parent/epic(s) this issue is a child
 * of. GitHub surfaces native sub-issue links in a dedicated section, but many
 * repos express the same parent relationship only as body text; this picks those
 * up so an epic's children connect to it the same way native sub-issues do (the
 * child is the prereq, the parent the dependent). Case-insensitive; the colon is
 * optional ("Parent #5"); tolerates the same bulleted-list form as
 * {@link parseBodyDeps}. "Parent epic: #51" matches via the `epic` keyword.
 */
function parseBodyParents(body: string | null | undefined): number[] {
  if (!body) return [];
  const out: number[] = [];
  const re = new RegExp(`\\b(?:parent|epic|tracked by)\\b${REF_RUN}`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    for (const n of refsToNumbers(m[1])) out.push(n);
  }
  return out;
}

/** Max characters for a station description derived from an issue body. */
const DESC_MAX_LEN = 280;

/**
 * Turn an issue body into a station `desc`: take the first non-empty paragraph,
 * collapse internal whitespace, and truncate to ~280 chars (on a word boundary
 * where possible, with an ellipsis). Empty/missing body → the placeholder.
 */
function bodyToDesc(body: string | null | undefined): string {
  if (!body) return PLACEHOLDER_DESC;
  // First paragraph = text up to the first blank line.
  const firstPara = body.split(/\r?\n\s*\r?\n/)[0] ?? '';
  const collapsed = firstPara.replace(/\s+/g, ' ').trim();
  if (!collapsed) return PLACEHOLDER_DESC;
  if (collapsed.length <= DESC_MAX_LEN) return collapsed;
  const slice = collapsed.slice(0, DESC_MAX_LEN);
  const lastSpace = slice.lastIndexOf(' ');
  const trimmed = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return trimmed.replace(/[\s.,;:]+$/, '') + '…';
}

/** True when a label marks an issue as in-progress (case-insensitive). */
function isInProgressLabel(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n === 'in-progress' || n === 'in progress' || n === 'wip';
}

/**
 * Parse an estimate label like `est:3d` or `size:M` into its value (`'3d'`,
 * `'M'`). Returns null for non-estimate labels. Case-insensitive on the prefix;
 * the value is returned verbatim (trimmed).
 */
function parseEstimateLabel(name: string): string | null {
  const m = name.trim().match(/^(?:est|size)\s*:\s*(.+)$/i);
  return m ? m[1].trim() : null;
}

/** True when a label is consumed as a signal and so excluded from `tags`. */
function isSignalLabel(name: string): boolean {
  return isInProgressLabel(name) || parseEstimateLabel(name) !== null;
}

/**
 * Pure transform: plain GitHub issue/milestone objects → a valid `MapData`.
 *
 * - One open issue = one station (name ← `#<number> <title>`). A *closed* issue
 *   surfaces as a `done` station only when it is connected (directly or
 *   transitively, in either direction) to an open issue through the dependency
 *   graph; a fully-completed component with no open issue is excluded.
 * - Lines are derived in three tiers, in order: each milestone becomes a line
 *   (in milestone order); then milestone-less issues sharing a delimited title
 *   prefix (2+ members) form a line named by that prefix, with the prefix
 *   stripped from each member's station name; everything else lands on a single
 *   catch-all `Backlog` line.
 * - Issue relationships become edges: native sub-issue / blocked-by links, plus
 *   a body-text fallback for both kinds — `Depends on #N` / `Blocked by #N`
 *   (this issue depends on N) and `Parent: #N` / `Epic: #N` / `Tracked by #N`
 *   (this issue is a child of N). Each edge is colored by the downstream (`to`)
 *   station's line; `df` is left off and derived at render time.
 * - Closed issue → `done`; open issues are settled to `locked` / `available` by
 *   `recompute` over the dependency graph.
 * - Layout (`col`/`row`/`lp`) comes from the deterministic helper
 *   `layoutStations`: col by dependency depth, rows from crossing-reduction and
 *   strand packing (ADR 0006).
 */
export function githubToMap(input: GithubToMapInput): MapData {
  return githubToMapReport(input).map;
}

/**
 * Like {@link githubToMap}, but also returns the list of dependency edges the
 * transform had to drop (self-references, duplicates, and edges broken to make
 * the graph acyclic). The generator script prints these so the user can fix the
 * underlying issues; this layer stays I/O-free and just reports.
 */
export function githubToMapReport(input: GithubToMapInput): GithubToMapResult {
  const { issues, milestones, repo, relationships = [] } = input;
  const dropped: DroppedEdge[] = [];

  const issueByNumber = new Map<number, GitHubIssue>();
  issues.forEach(iss => issueByNumber.set(iss.number, iss));

  // ---- 1. Resolve all dependency pairs (native + body-text fallback). ----
  // Deduped, ordered list of "prereq → dependent" pairs, both numbers
  // referencing real issues. Self-edges and duplicates are dropped here (and
  // reported); pairs referencing unknown issues are skipped silently (a closed
  // prereq with no station, say, is expected — not worth a warning).
  const depPairs: { prereq: number; dependent: number }[] = [];
  const seenPair = new Set<string>(); // key: `${prereq}->${dependent}`
  const addPair = (prereq: number, dependent: number) => {
    if (prereq === dependent) {
      dropped.push({ prereq, dependent, reason: 'self' });
      return;
    }
    if (!issueByNumber.has(prereq) || !issueByNumber.has(dependent)) return;
    const key = `${prereq}->${dependent}`;
    if (seenPair.has(key)) {
      dropped.push({ prereq, dependent, reason: 'duplicate' });
      return;
    }
    seenPair.add(key);
    depPairs.push({ prereq, dependent });
  };

  relationships.forEach(r => addPair(r.prereq, r.dependent));
  issues.forEach(iss => {
    for (const prereq of parseBodyDeps(iss.body)) addPair(prereq, iss.number);
    // A parent/epic reference makes THIS issue the child (prereq) of that parent
    // (dependent) — the same direction native sub-issue links use.
    for (const parent of parseBodyParents(iss.body)) addPair(iss.number, parent);
  });

  // ---- 1b. Break cycles deterministically so the map always renders. ----
  // Walk pairs in a stable order, adding each to an acyclic accumulator. An edge
  // that would close a cycle (its `dependent` can already reach its `prereq`) is
  // dropped. Pairs are sorted so the edge whose `to`/`dependent` has the smaller
  // issue number is the one dropped — a deterministic, documented choice.
  const acyclicPairs = breakCycles(depPairs, dropped);

  // ---- 2. Decide which issues become stations. ----
  // Every open issue is a station. A closed issue is included only when it is
  // connected — directly or transitively, in either direction — to an open issue
  // through the dependency graph. This keeps a closed common blocker (and the
  // closed chains between it and the open work) on the map as `done` stations, so
  // open stations don't end up isolated when their blocker has been closed. A
  // fully-completed component with no open issue is left out, so the map isn't
  // flooded with disconnected done work.
  const adjacency = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    const list = adjacency.get(a);
    if (list) list.push(b);
    else adjacency.set(a, [b]);
  };
  for (const { prereq, dependent } of acyclicPairs) {
    link(prereq, dependent);
    link(dependent, prereq);
  }
  const connectedToOpen = new Set<number>();
  const frontier: number[] = [];
  for (const iss of issues) {
    if (!isClosed(iss.state)) {
      connectedToOpen.add(iss.number);
      frontier.push(iss.number);
    }
  }
  while (frontier.length) {
    const cur = frontier.pop()!;
    for (const next of adjacency.get(cur) ?? []) {
      if (!connectedToOpen.has(next)) {
        connectedToOpen.add(next);
        frontier.push(next);
      }
    }
  }

  const includedIssues = issues.filter(
    iss => !isClosed(iss.state) || connectedToOpen.has(iss.number),
  );

  // ---- 2b. Group milestone-less issues by a shared, delimiter-based prefix. ----
  // A prefix shared by 2+ such issues becomes its own line (named verbatim from
  // the prefix); the prefix is later stripped from each member's station name.
  // Milestoned issues are excluded — their milestone already names their line.
  interface PrefixGroup {
    key: string; // slug, the grouping identity (case-insensitive)
    name: string; // verbatim prefix from the first member (display name)
    minNumber: number; // lowest member issue number, for deterministic ordering
    members: number[];
  }
  const groupByKey = new Map<string, PrefixGroup>();
  const groupKeyByNumber = new Map<number, string>();
  const restByNumber = new Map<number, string>(); // stripped remainder per member
  for (const iss of includedIssues) {
    if (iss.milestone) continue;
    const split = splitTitlePrefix(iss.title);
    if (!split) continue;
    const key = slugify(split.prefix);
    groupKeyByNumber.set(iss.number, key);
    restByNumber.set(iss.number, split.rest);
    const existing = groupByKey.get(key);
    if (existing) {
      existing.members.push(iss.number);
      // Name uses the lowest-numbered member's casing, so the displayed name is
      // deterministic (independent of input order) and consistent with the
      // lowest-issue-number rule that orders the lines.
      if (iss.number < existing.minNumber) {
        existing.minNumber = iss.number;
        existing.name = split.prefix;
      }
    } else {
      groupByKey.set(key, {
        key,
        name: split.prefix,
        minNumber: iss.number,
        members: [iss.number],
      });
    }
  }
  // Keep only groups of 2+; order them by lowest member issue number.
  const keptGroups = [...groupByKey.values()]
    .filter(g => g.members.length >= 2)
    .sort((a, b) => a.minNumber - b.minNumber);
  const keptGroupKeys = new Set(keptGroups.map(g => g.key));
  // Is this issue a member of a line-forming (kept) prefix group?
  const inKeptGroup = (n: number): boolean =>
    keptGroupKeys.has(groupKeyByNumber.get(n) ?? '');

  // ---- 3. Build lines: milestones, then prefix groups, then Backlog. ----
  // Each line's color is taken from the palette at its push position, so all
  // three kinds of line cycle the colors distinctly.
  const usedLineIds = new Set<string>();
  const usedShorts = new Set<string>();
  const lines: Line[] = [];
  const lineIdByMilestone = new Map<string, string>();
  // Milestone due dates keyed by title, so a station can inherit its `due`.
  const dueByMilestone = new Map<string, string | null | undefined>();
  milestones.forEach(m => dueByMilestone.set(m.title, m.dueOn));

  milestones.forEach(m => {
    const id = slugifyId(m.title, usedLineIds);
    lineIdByMilestone.set(m.title, id);
    lines.push({
      id,
      name: m.title,
      color: LINE_COLORS[lines.length % LINE_COLORS.length],
      short: shortCode(m.title, usedShorts),
    });
  });

  const lineIdByGroupKey = new Map<string, string>();
  keptGroups.forEach(g => {
    const id = slugifyId(g.name, usedLineIds);
    lineIdByGroupKey.set(g.key, id);
    lines.push({
      id,
      name: g.name,
      color: LINE_COLORS[lines.length % LINE_COLORS.length],
      short: shortCode(g.name, usedShorts),
    });
  });

  // A Backlog line is needed when a milestone-less issue belongs to no kept
  // prefix group, OR when there are no lines at all yet (empty repo / no
  // milestones) — every valid map must have at least one line, and the app's
  // EmptyState renders the zero-station case.
  const hasBacklog =
    includedIssues.some(iss => !iss.milestone && !inKeptGroup(iss.number)) ||
    lines.length === 0;
  let backlogLineId: string | null = null;
  if (hasBacklog) {
    backlogLineId = slugifyId(BACKLOG_LINE_ID, usedLineIds);
    lines.push({
      id: backlogLineId,
      name: 'Backlog',
      color: LINE_COLORS[lines.length % LINE_COLORS.length],
      short: shortCode('Backlog', usedShorts),
    });
  }

  // Lazily materialize a Backlog line if an issue references an unknown
  // milestone and no Backlog line was created up front.
  function ensureBacklog(): string {
    if (backlogLineId) return backlogLineId;
    backlogLineId = slugifyId(BACKLOG_LINE_ID, usedLineIds);
    lines.push({
      id: backlogLineId,
      name: 'Backlog',
      color: LINE_COLORS[lines.length % LINE_COLORS.length],
      short: shortCode('Backlog', usedShorts),
    });
    return backlogLineId;
  }

  // ---- 4. Resolve each issue's station id + line (no coordinates yet). ----
  const usedStationIds = new Set<string>();
  const stationIdByNumber = new Map<number, string>();
  const lineIdByNumber = new Map<number, string>();

  // Stable node order (issue order) feeds the deterministic layout.
  const layoutNodes: LayoutNode[] = includedIssues.map(iss => {
    const lineId =
      (iss.milestone && lineIdByMilestone.get(iss.milestone.title)) ||
      (!iss.milestone && inKeptGroup(iss.number)
        ? lineIdByGroupKey.get(groupKeyByNumber.get(iss.number)!)
        : undefined) ||
      backlogLineId;
    // Defensive: an issue's milestone wasn't in the milestones list — fold it
    // into Backlog so we never produce a dangling line reference.
    const resolvedLineId = lineId ?? ensureBacklog();

    const stationId = slugifyId('issue-' + iss.number, usedStationIds);
    stationIdByNumber.set(iss.number, stationId);
    lineIdByNumber.set(iss.number, resolvedLineId);

    return { id: stationId };
  });

  // ---- 5. Build edges. Colored by the downstream (`to`) station's line. ----
  const edges: Edge[] = [];
  const seenEdge = new Set<string>();
  for (const { prereq, dependent } of acyclicPairs) {
    const from = stationIdByNumber.get(prereq);
    const to = stationIdByNumber.get(dependent);
    // Both endpoints must be stations (e.g. a closed issue in a fully-completed
    // component was excluded, so it has no station).
    if (!from || !to) continue;
    const edgeKey = `${from}->${to}`;
    if (seenEdge.has(edgeKey)) continue;
    seenEdge.add(edgeKey);
    const line = lineIdByNumber.get(dependent)!;
    edges.push({ from, to, line });
  }

  // ---- 6. Deterministic topological layout from the dependency graph. ----
  // prereqs adjacency (`to -> [from...]`) straight from the edges we just built.
  const layoutPrereqs: Record<string, string[]> = {};
  for (const e of edges) {
    (layoutPrereqs[e.to] = layoutPrereqs[e.to] || []).push(e.from);
  }
  const layout = layoutStations(layoutNodes, layoutPrereqs);

  // Base name per issue (after any prefix→line stripping), then collapse leading
  // words shared across issues into a tag so labels stay short (#4).
  const baseNames = includedIssues.map(iss =>
    inKeptGroup(iss.number)
      ? capitalizeFirst(restByNumber.get(iss.number)!)
      : iss.title,
  );
  const strippedNames = stripSharedPrefixes(baseNames);

  const stations: Station[] = includedIssues.map((iss, i) => {
    const stationId = stationIdByNumber.get(iss.number)!;
    const lineId = lineIdByNumber.get(iss.number)!;
    const { col, row, lp } = layout[stationId];

    const labels = iss.labels ?? [];
    const closed = isClosed(iss.state);
    // An OPEN issue carrying an in-progress signal label starts active; closed
    // issues are `done`; everything else settles via the cascade below.
    const inProgress = !closed && labels.some(l => isInProgressLabel(l.name));

    // First estimate label (est:/size:) wins; otherwise the placeholder dash.
    let est = PLACEHOLDER_DASH;
    for (const l of labels) {
      const parsed = parseEstimateLabel(l.name);
      if (parsed) {
        est = parsed;
        break;
      }
    }

    // Tags = labels minus those consumed as signals (status/estimate). A shared
    // leading-word prefix collapsed off the name (#4) is surfaced as a tag too.
    const labelTags = labels.map(l => l.name).filter(name => !isSignalLabel(name));
    const { name, tag: prefixTag } = strippedNames[i];
    const tags = prefixTag ? [prefixTag, ...labelTags] : labelTags;

    const due = iss.milestone ? dueByMilestone.get(iss.milestone.title) : null;

    return {
      id: stationId,
      // Prefix the displayed name with the issue number (e.g. "#42 Title"). Done
      // last, after prefix→line and shared-word stripping, so those derivations
      // still see the clean title.
      name: `#${iss.number} ${name}`,
      lines: [lineId],
      col,
      row,
      lp,
      status: closed ? 'done' : inProgress ? 'active' : 'available',
      desc: bodyToDesc(iss.body),
      owner: iss.assignees?.[0]?.login || PLACEHOLDER_OWNER,
      role: '',
      due: due || PLACEHOLDER_DASH,
      est,
      tags,
      ...(iss.url ? { sourceUrl: iss.url } : {}),
    };
  });

  // ---- 7. Settle open-station statuses via the existing cascade. ----
  // `recompute` leaves `done` and `active` stations untouched, so issues marked
  // active above survive the cascade; only locked/available stations move.
  const { prereqs } = buildIndexes(stations, lines, edges);
  const settledStations = recompute(stations, prereqs);

  return {
    map: {
      project: {
        name: repo?.name || 'Roadmap',
        subtitle: repo?.description || 'Generated from GitHub issues',
      },
      lines,
      stations: settledStations,
      edges,
    },
    dropped,
  };
}

/**
 * Break cycles in a dependency-pair graph deterministically.
 *
 * Pairs are processed in a stable order and added to an acyclic accumulator one
 * at a time; any pair whose `dependent` can already reach its `prereq` (i.e.
 * adding it would close a cycle) is dropped and recorded. Pairs are sorted by
 * the dependent (`to`) then prereq (`from`) issue number, so the edge kept for a
 * simple 2-cycle is the one whose `to` is the smaller number and the dropped
 * (cycle-closing) edge is its mirror — a documented, reproducible choice.
 *
 * @param pairs   deduped prereq→dependent pairs (no self-edges)
 * @param dropped mutated: each broken edge is pushed with reason `'cycle'`
 * @returns the subset of `pairs` that forms an acyclic graph
 */
function breakCycles(
  pairs: { prereq: number; dependent: number }[],
  dropped: DroppedEdge[],
): { prereq: number; dependent: number }[] {
  // Sort by dependent (`to`) then prereq (`from`) so the edge dropped to break a
  // cycle is deterministically the one whose `to` has the smaller issue number.
  const ordered = [...pairs].sort(
    (a, b) => a.dependent - b.dependent || a.prereq - b.prereq,
  );

  // Adjacency over accepted edges: prereq -> [dependents...]. Reachability is
  // "can `dependent` reach `prereq` by following accepted edges?"; if so, adding
  // prereq→dependent would close a cycle.
  const adj = new Map<number, number[]>();
  const canReach = (start: number, target: number): boolean => {
    const stack = [start];
    const seen = new Set<number>();
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === target) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const next of adj.get(cur) ?? []) stack.push(next);
    }
    return false;
  };

  const kept: { prereq: number; dependent: number }[] = [];
  for (const pair of ordered) {
    if (canReach(pair.dependent, pair.prereq)) {
      dropped.push({ ...pair, reason: 'cycle' });
      continue;
    }
    const out = adj.get(pair.prereq);
    if (out) out.push(pair.dependent);
    else adj.set(pair.prereq, [pair.dependent]);
    kept.push(pair);
  }
  return kept;
}
