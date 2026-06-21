import { describe, it, expect, vi } from 'vitest';
import { mapRestIssue, fetchRepoInput, type FetchLike } from './githubFetch';

describe('mapRestIssue', () => {
  it('maps REST fields to the transform GitHubIssue shape', () => {
    const mapped = mapRestIssue({
      number: 7,
      title: 'Do the thing',
      state: 'open',
      body: 'Depends on #3',
      html_url: 'https://github.com/o/r/issues/7',
      milestone: { title: 'M1', number: 1, due_on: '2026-07-01T00:00:00Z' },
      labels: [{ name: 'bug' }, 'plain-string-label'],
      assignees: [{ login: 'maya' }],
    });
    expect(mapped).toEqual({
      number: 7,
      title: 'Do the thing',
      state: 'open',
      body: 'Depends on #3',
      url: 'https://github.com/o/r/issues/7',
      milestone: { title: 'M1', number: 1, dueOn: '2026-07-01T00:00:00Z' },
      labels: [{ name: 'bug' }, { name: 'plain-string-label' }],
      assignees: [{ login: 'maya' }],
    });
  });

  it('nulls out an absent milestone/body/url', () => {
    const mapped = mapRestIssue({ number: 1, title: 'X', state: 'closed' });
    expect(mapped.milestone).toBeNull();
    expect(mapped.body).toBeNull();
    expect(mapped.url).toBeNull();
    expect(mapped.labels).toEqual([]);
    expect(mapped.assignees).toEqual([]);
  });
});

/** A fetch double routing by URL/method to canned JSON responses. */
function makeFetch(): FetchLike {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
    if (url.includes('/graphql')) {
      return json({
        data: {
          repository: {
            issues: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [{ number: 2, subIssues: { nodes: [{ number: 1 }] } }],
            },
          },
        },
      });
    }
    if (url.includes('/milestones')) {
      return json([{ title: 'M1', number: 1, due_on: '2026-07-01T00:00:00Z' }]);
    }
    if (/\/repos\/[^/]+\/[^/]+\/issues/.test(url)) {
      // Page 1: one real issue + one PR (must be dropped). Page 2+: empty.
      if (url.includes('page=1')) {
        return json([
          { number: 2, title: 'Real issue', state: 'open' },
          { number: 99, title: 'A PR', state: 'open', pull_request: { url: 'x' } },
        ]);
      }
      return json([]);
    }
    if (/\/repos\/[^/]+\/[^/]+$/.test(url)) {
      return json({ name: 'r', description: 'desc' });
    }
    expect.unreachable(`unexpected fetch: ${init?.method ?? 'GET'} ${url}`);
  }) as unknown as FetchLike;
}

describe('fetchRepoInput', () => {
  it('assembles a GithubToMapInput, dropping pull requests', async () => {
    const input = await fetchRepoInput('tok', 'o', 'r', makeFetch());

    expect(input.issues.map(i => i.number)).toEqual([2]); // PR #99 dropped
    expect(input.milestones).toEqual([{ title: 'M1', number: 1, dueOn: '2026-07-01T00:00:00Z' }]);
    expect(input.repo).toEqual({ name: 'r', description: 'desc' });
    expect(input.relationships).toEqual([{ prereq: 1, dependent: 2 }]);
  });
});
