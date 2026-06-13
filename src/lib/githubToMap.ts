import type { Line, Station, Edge } from '../types';
import type { MapData } from './maps';
import { PLACEHOLDER_DESC, PLACEHOLDER_OWNER, PLACEHOLDER_DASH } from './placeholders';
import { buildIndexes } from './indexes';
import { recompute } from './dependencies';
import { layoutStations, type LayoutNode } from './layout';

// Plain-object shapes matching what `gh` returns (subset we rely on). The
// generator script feeds these straight through; keep this module I/O-free so
// it stays unit-testable.
export interface GitHubMilestone {
  title: string;
  number?: number;
}

export interface GitHubLabel {
  name: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  state: string; // 'open' | 'closed' | 'OPEN' | 'CLOSED'
  milestone?: GitHubMilestone | null;
  body?: string | null;
  labels?: GitHubLabel[];
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

/**
 * Parse `Depends on #N` / `Blocked by #N` text from an issue body. Returns the
 * referenced issue numbers (the prereqs this issue depends on). Case-insensitive;
 * tolerates comma/space separated lists like "Depends on #1, #2".
 */
function parseBodyDeps(body: string | null | undefined): number[] {
  if (!body) return [];
  const out: number[] = [];
  const re = /(?:depends on|blocked by)\s*((?:#\d+[\s,]*)+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const nums = m[1].match(/#(\d+)/g) || [];
    for (const n of nums) out.push(parseInt(n.slice(1), 10));
  }
  return out;
}

/**
 * Pure transform: plain GitHub issue/milestone objects → a valid `MapData`.
 *
 * - One open issue = one station (name ← title). A *closed* issue surfaces as a
 *   station only when an open issue depends on it (rendered as a `done` prereq);
 *   closed issues with no open dependent are excluded.
 * - Each milestone becomes a line (in milestone order); issues with no
 *   milestone land on a single catch-all `Backlog` line.
 * - Issue relationships (native sub-issue / blocked-by links, plus a
 *   `Depends on #N` / `Blocked by #N` body-text fallback) become edges. Each
 *   edge is colored by the downstream (`to`) station's line; `df` is left off
 *   and derived at render time.
 * - Closed issue → `done`; open issues are settled to `locked` / `available` by
 *   `recompute` over the dependency graph.
 * - Layout (`col`/`row`/`lp`) comes from the deterministic topological helper
 *   `layoutStations`: col by dependency depth, row packed per line band.
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
  });

  // ---- 1b. Break cycles deterministically so the map always renders. ----
  // Walk pairs in a stable order, adding each to an acyclic accumulator. An edge
  // that would close a cycle (its `dependent` can already reach its `prereq`) is
  // dropped. Pairs are sorted so the edge whose `to`/`dependent` has the smaller
  // issue number is the one dropped — a deterministic, documented choice.
  const acyclicPairs = breakCycles(depPairs, dropped);

  // ---- 2. Decide which issues become stations. ----
  // Every open issue is a station. A closed issue is included only if some open
  // issue depends on it.
  const dependentsOfClosed = new Set<number>(); // closed issue numbers referenced by an open dependent
  for (const { prereq, dependent } of acyclicPairs) {
    const prereqIssue = issueByNumber.get(prereq);
    const dependentIssue = issueByNumber.get(dependent);
    if (!prereqIssue || !dependentIssue) continue;
    if (isClosed(prereqIssue.state) && !isClosed(dependentIssue.state)) {
      dependentsOfClosed.add(prereq);
    }
  }

  const includedIssues = issues.filter(iss => {
    if (!isClosed(iss.state)) return true;
    return dependentsOfClosed.has(iss.number);
  });

  // ---- 3. Build lines in milestone order, then append Backlog only if needed. ----
  const usedLineIds = new Set<string>();
  const usedShorts = new Set<string>();
  const lines: Line[] = [];
  const lineIdByMilestone = new Map<string, string>();

  milestones.forEach((m, i) => {
    const id = slugifyId(m.title, usedLineIds);
    lineIdByMilestone.set(m.title, id);
    lines.push({
      id,
      name: m.title,
      color: LINE_COLORS[i % LINE_COLORS.length],
      short: shortCode(m.title, usedShorts),
    });
  });

  // A Backlog line is needed when an issue has no milestone, OR when there are
  // no lines at all yet (empty repo / no milestones) — every valid map must have
  // at least one line, and the app's EmptyState renders the zero-station case.
  const hasBacklog = includedIssues.some(iss => !iss.milestone) || lines.length === 0;
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
      (iss.milestone && lineIdByMilestone.get(iss.milestone.title)) || backlogLineId;
    // Defensive: an issue's milestone wasn't in the milestones list — fold it
    // into Backlog so we never produce a dangling line reference.
    const resolvedLineId = lineId ?? ensureBacklog();

    const stationId = slugifyId('issue-' + iss.number, usedStationIds);
    stationIdByNumber.set(iss.number, stationId);
    lineIdByNumber.set(iss.number, resolvedLineId);

    return { id: stationId, lineId: resolvedLineId };
  });

  // ---- 5. Build edges. Colored by the downstream (`to`) station's line. ----
  const edges: Edge[] = [];
  const seenEdge = new Set<string>();
  for (const { prereq, dependent } of acyclicPairs) {
    const from = stationIdByNumber.get(prereq);
    const to = stationIdByNumber.get(dependent);
    // Both endpoints must be stations (e.g. a closed prereq with no open
    // dependent was excluded, so it has no station).
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

  const stations: Station[] = includedIssues.map(iss => {
    const stationId = stationIdByNumber.get(iss.number)!;
    const lineId = lineIdByNumber.get(iss.number)!;
    const { col, row, lp } = layout[stationId];
    return {
      id: stationId,
      name: iss.title,
      lines: [lineId],
      col,
      row,
      lp,
      status: isClosed(iss.state) ? 'done' : 'available',
      desc: PLACEHOLDER_DESC,
      owner: PLACEHOLDER_OWNER,
      role: PLACEHOLDER_DASH,
      due: PLACEHOLDER_DASH,
      est: PLACEHOLDER_DASH,
      tags: [],
    };
  });

  // ---- 7. Settle open-station statuses via the existing cascade. ----
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
