import type { Line, Station, Edge } from '../types';
import type { MapData } from './maps';
import { PLACEHOLDER_DESC, PLACEHOLDER_OWNER, PLACEHOLDER_DASH } from './placeholders';
import { buildIndexes } from './indexes';
import { recompute } from './dependencies';

// Plain-object shapes matching what `gh` returns (subset we rely on). The
// generator script feeds these straight through; keep this module I/O-free so
// it stays unit-testable.
export interface GitHubMilestone {
  title: string;
  number?: number;
}

export interface GitHubIssue {
  number: number;
  title: string;
  state: string; // 'open' | 'closed' | 'OPEN' | 'CLOSED'
  milestone?: GitHubMilestone | null;
  body?: string | null;
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

const BACKLOG_LINE_ID = 'backlog';

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
 * - Naive layout: col = index within its line; row = line band index.
 */
export function githubToMap(input: GithubToMapInput): MapData {
  const { issues, milestones, repo, relationships = [] } = input;

  const issueByNumber = new Map<number, GitHubIssue>();
  issues.forEach(iss => issueByNumber.set(iss.number, iss));

  // ---- 1. Resolve all dependency pairs (native + body-text fallback). ----
  // Deduped set of "prereq → dependent" pairs, both numbers referencing real
  // issues we actually have.
  const depPairs = new Set<string>(); // key: `${prereq}->${dependent}`
  const addPair = (prereq: number, dependent: number) => {
    if (prereq === dependent) return;
    if (!issueByNumber.has(prereq) || !issueByNumber.has(dependent)) return;
    depPairs.add(`${prereq}->${dependent}`);
  };

  relationships.forEach(r => addPair(r.prereq, r.dependent));
  issues.forEach(iss => {
    for (const prereq of parseBodyDeps(iss.body)) addPair(prereq, iss.number);
  });

  // ---- 2. Decide which issues become stations. ----
  // Every open issue is a station. A closed issue is included only if some open
  // issue depends on it.
  const dependentsOfClosed = new Set<number>(); // closed issue numbers referenced by an open dependent
  for (const key of depPairs) {
    const [prereqStr, dependentStr] = key.split('->');
    const prereq = Number(prereqStr);
    const dependent = Number(dependentStr);
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

  const hasBacklog = includedIssues.some(iss => !iss.milestone);
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

  // Row band per line id; track next free column within each band.
  const rowByLineId = new Map<string, number>();
  lines.forEach((l, i) => rowByLineId.set(l.id, i));
  const nextColByLineId = new Map<string, number>();

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
    rowByLineId.set(backlogLineId, lines.length - 1);
    return backlogLineId;
  }

  // ---- 4. Build stations, recording the issue-number → station mapping. ----
  const usedStationIds = new Set<string>();
  const stationIdByNumber = new Map<number, string>();
  const lineIdByNumber = new Map<number, string>();

  const stations: Station[] = includedIssues.map(iss => {
    const lineId =
      (iss.milestone && lineIdByMilestone.get(iss.milestone.title)) || backlogLineId;
    // Defensive: an issue's milestone wasn't in the milestones list — fold it
    // into Backlog so we never produce a dangling line reference.
    const resolvedLineId = lineId ?? ensureBacklog();

    const col = nextColByLineId.get(resolvedLineId) ?? 0;
    nextColByLineId.set(resolvedLineId, col + 1);
    const row = rowByLineId.get(resolvedLineId) ?? 0;

    const stationId = slugifyId('issue-' + iss.number, usedStationIds);
    stationIdByNumber.set(iss.number, stationId);
    lineIdByNumber.set(iss.number, resolvedLineId);

    return {
      id: stationId,
      name: iss.title,
      lines: [resolvedLineId],
      col,
      row,
      lp: 'top',
      status: isClosed(iss.state) ? 'done' : 'available',
      desc: PLACEHOLDER_DESC,
      owner: PLACEHOLDER_OWNER,
      role: PLACEHOLDER_DASH,
      due: PLACEHOLDER_DASH,
      est: PLACEHOLDER_DASH,
      tags: [],
    };
  });

  // ---- 5. Build edges. Colored by the downstream (`to`) station's line. ----
  const edges: Edge[] = [];
  const seenEdge = new Set<string>();
  for (const key of depPairs) {
    const [prereqStr, dependentStr] = key.split('->');
    const prereq = Number(prereqStr);
    const dependent = Number(dependentStr);
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

  // ---- 6. Settle open-station statuses via the existing cascade. ----
  const { prereqs } = buildIndexes(stations, lines, edges);
  const settledStations = recompute(stations, prereqs);

  return {
    project: {
      name: repo?.name || 'Roadmap',
      subtitle: repo?.description || 'Generated from GitHub issues',
    },
    lines,
    stations: settledStations,
    edges,
  };
}
