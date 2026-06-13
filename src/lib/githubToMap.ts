import type { Line, Station, Edge } from '../types';
import type { MapData } from './maps';
import { PLACEHOLDER_DESC, PLACEHOLDER_OWNER, PLACEHOLDER_DASH } from './placeholders';

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
}

export interface GitHubRepoInfo {
  name?: string;
  description?: string;
}

export interface GithubToMapInput {
  issues: GitHubIssue[];
  milestones: GitHubMilestone[];
  repo?: GitHubRepoInfo;
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
 * Pure transform: plain GitHub issue/milestone objects → a valid `MapData`.
 *
 * - One issue = one station (name ← title).
 * - Each milestone becomes a line (in milestone order); issues with no
 *   milestone land on a single catch-all `Backlog` line.
 * - Closed issue → `done`; open issue → `available`.
 * - Naive layout: col = index within its line; row = line band index.
 * - No edges yet (empty array); no locked/available cascade yet.
 */
export function githubToMap(input: GithubToMapInput): MapData {
  const { issues, milestones, repo } = input;

  // Build lines in milestone order, then append Backlog only if needed.
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

  const hasBacklog = issues.some(iss => !iss.milestone);
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

  const usedStationIds = new Set<string>();
  const stations: Station[] = issues.map(iss => {
    const lineId =
      (iss.milestone && lineIdByMilestone.get(iss.milestone.title)) || backlogLineId;
    // Defensive: an issue's milestone wasn't in the milestones list — fold it
    // into Backlog so we never produce a dangling line reference.
    const resolvedLineId = lineId ?? ensureBacklog();

    const col = nextColByLineId.get(resolvedLineId) ?? 0;
    nextColByLineId.set(resolvedLineId, col + 1);
    const row = rowByLineId.get(resolvedLineId) ?? 0;

    return {
      id: slugifyId('issue-' + iss.number, usedStationIds),
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

  const edges: Edge[] = [];

  return {
    project: {
      name: repo?.name || 'Roadmap',
      subtitle: repo?.description || 'Generated from GitHub issues',
    },
    lines,
    stations,
    edges,
  };
}
