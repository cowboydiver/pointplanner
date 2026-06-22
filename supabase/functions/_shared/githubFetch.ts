// GitHub fetch layer for the sync Edge Function: the `fetch()` + REST/GraphQL
// reimplementation of the `gh`-CLI calls in scripts/generate-map.ts, using an
// installation access token instead of the CLI. Produces the same I/O-free
// `GithubToMapInput` the pure transform consumes.
//
// Only Web APIs (fetch, no Deno globals), so the response→input mapping is
// unit-tested under vitest with an injected fetch double. See githubFetch.test.ts.
//
// NOTE on import: this file imports the pure transform's *types* from src/lib via
// a relative path with an explicit .ts extension, so both the Supabase deploy
// bundler and vitest (via vite) resolve it without relying on sloppy-imports.
import type {
  GitHubIssue,
  GitHubMilestone,
  GitHubRelationship,
  GitHubRepoInfo,
  GithubToMapInput,
} from '../../../src/lib/githubToMap.ts';

const GH_API = 'https://api.github.com';

/** A minimal `fetch` shape so callers (and tests) can inject a double. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'pointplanner-mirror',
  };
}

/** Raw REST issue shape (subset) — issues endpoint also returns PRs (filtered). */
interface RestIssue {
  number: number;
  title: string;
  state: string;
  body?: string | null;
  html_url?: string | null;
  pull_request?: unknown;
  milestone?: { title: string; number: number; due_on?: string | null } | null;
  labels?: ({ name: string } | string)[];
  assignees?: { login: string }[];
}

/** Map one raw REST issue to the transform's `GitHubIssue` shape. */
export function mapRestIssue(raw: RestIssue): GitHubIssue {
  const labels = (raw.labels ?? []).map(l => (typeof l === 'string' ? { name: l } : { name: l.name }));
  return {
    number: raw.number,
    title: raw.title,
    state: raw.state,
    body: raw.body ?? null,
    url: raw.html_url ?? null,
    milestone: raw.milestone
      ? { title: raw.milestone.title, number: raw.milestone.number, dueOn: raw.milestone.due_on ?? null }
      : null,
    labels,
    assignees: (raw.assignees ?? []).map(a => ({ login: a.login })),
  };
}

async function ghJson<T>(fetchImpl: FetchLike, token: string, path: string): Promise<T> {
  const res = await fetchImpl(`${GH_API}${path}`, { headers: authHeaders(token) });
  if (!res.ok) {
    throw new Error(`GitHub GET ${path} failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

/** Paginate `GET /repos/{owner}/{repo}/issues?state=all`, dropping PRs. */
async function fetchIssues(fetchImpl: FetchLike, token: string, owner: string, repo: string): Promise<GitHubIssue[]> {
  const issues: GitHubIssue[] = [];
  for (let page = 1; page <= 50; page++) {
    const batch = await ghJson<RestIssue[]>(
      fetchImpl,
      token,
      `/repos/${owner}/${repo}/issues?state=all&per_page=100&page=${page}`,
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const raw of batch) {
      if (raw.pull_request) continue; // the issues endpoint includes PRs — skip them
      issues.push(mapRestIssue(raw));
    }
    if (batch.length < 100) break;
  }
  return issues;
}

async function fetchMilestones(fetchImpl: FetchLike, token: string, owner: string, repo: string): Promise<GitHubMilestone[]> {
  const raw = await ghJson<{ title: string; number: number; due_on?: string | null }[]>(
    fetchImpl,
    token,
    `/repos/${owner}/${repo}/milestones?state=all&per_page=100`,
  );
  return (raw ?? []).map(m => ({ title: m.title, number: m.number, dueOn: m.due_on ?? null }));
}

async function fetchRepoInfo(fetchImpl: FetchLike, token: string, owner: string, repo: string): Promise<GitHubRepoInfo> {
  const raw = await ghJson<{ name?: string; description?: string | null }>(
    fetchImpl,
    token,
    `/repos/${owner}/${repo}`,
  );
  return { name: raw.name, description: raw.description ?? undefined };
}

interface GqlIssueNode {
  number: number;
  subIssues?: { nodes: { number: number }[] } | null;
}

/**
 * Native sub-issue relationships via GraphQL — the `fetchRelationships` query
 * from the generator, ported to `fetch`. Best-effort: a GraphQL error (e.g. the
 * field is unavailable) returns the relationships gathered so far, leaving the
 * transform's `Depends on #N` body-text fallback to fill in.
 */
async function fetchRelationships(fetchImpl: FetchLike, token: string, owner: string, repo: string): Promise<GitHubRelationship[]> {
  const query = `
    query($owner: String!, $name: String!, $cursor: String) {
      repository(owner: $owner, name: $name) {
        issues(first: 100, after: $cursor, states: [OPEN, CLOSED]) {
          pageInfo { hasNextPage endCursor }
          nodes { number subIssues(first: 100) { nodes { number } } }
        }
      }
    }
  `.trim();

  const rels: GitHubRelationship[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 50; guard++) {
    const res = await fetchImpl(`${GH_API}/graphql`, {
      method: 'POST',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { owner, name: repo, cursor } }),
    });
    if (!res.ok) break;
    const parsed = (await res.json()) as {
      data?: { repository?: { issues?: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: GqlIssueNode[] } } };
      errors?: unknown;
    };
    const issues = parsed.data?.repository?.issues;
    if (!issues) break; // GraphQL error or unexpected shape — fall back to body text
    for (const node of issues.nodes) {
      for (const child of node.subIssues?.nodes ?? []) {
        rels.push({ prereq: child.number, dependent: node.number });
      }
    }
    if (!issues.pageInfo.hasNextPage) break;
    cursor = issues.pageInfo.endCursor;
  }
  return rels;
}

/**
 * Fetch everything the transform needs for a repo, as a `GithubToMapInput`. The
 * caller applies `scopeInputByFilter` for a filtered mirror. `fetchImpl` defaults
 * to the global `fetch`; tests inject a double.
 */
export async function fetchRepoInput(
  token: string,
  owner: string,
  repo: string,
  fetchImpl: FetchLike = fetch,
): Promise<GithubToMapInput> {
  const [issues, milestones, repoInfo, relationships] = await Promise.all([
    fetchIssues(fetchImpl, token, owner, repo),
    fetchMilestones(fetchImpl, token, owner, repo),
    fetchRepoInfo(fetchImpl, token, owner, repo),
    fetchRelationships(fetchImpl, token, owner, repo),
  ]);
  return { issues, milestones, repo: repoInfo, relationships };
}
