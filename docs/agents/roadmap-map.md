# Roadmap map from GitHub issues

How an agent turns this repo's GitHub issues into a PointPlanner map (a `maps/*.json`
file the app can render and edit). The generator lives behind one npm script,
`generate-map`; this doc records the conventions it follows so a generated map is
reviewable rather than mysterious.

## The flow

1. **Fetch** the issue data via the `gh` CLI (the script shells out for you — see
   "What the generator reads" below; you do not call `gh` by hand).
2. **Generate** with `npm run generate-map`. Bare, it writes `maps/roadmap.json`.
   With `--filter <label-or-milestone>`, it scopes to a subset and writes
   `maps/<slug>.json` instead.
3. **Review** the resulting `maps/*.json` diff and read the generator's stdout for
   dropped-edge and validation warnings.
4. **Commit** the map. Committed `maps/*.json` are bundled into the app and appear
   in the MapSwitcher as editable maps.

```bash
npm run generate-map                       # → maps/roadmap.json
npm run generate-map -- --filter v1.0      # → maps/<slug>.json, scoped to one label/milestone
```

The script infers the repo from the current clone (`gh repo view`), so run it from
inside the checkout with an authenticated `gh`.

## What the generator reads

All network I/O is in the script; the transform that builds the map is pure and
unit-tested. The script fetches, via `gh`:

- **Issues** — `gh issue list --state all` (open and closed), with
  `number,title,state,milestone,body`.
- **Milestones** — the REST API (`gh api repos/{owner}/{repo}/milestones`), in
  creation order, which fixes a deterministic line order.
- **Relationships** — native sub-issue links via `gh api graphql` and native
  `blocked by` dependencies via the REST dependencies endpoint (see below).

## Mapping conventions

### Issues → stations

- One issue = one station; sub-issues are also stations (one each).
- **Open** issues always become stations.
- A **closed** issue surfaces only when an open issue depends on it — it is rendered
  as a `done` prereq. Closed issues with no open dependent are excluded.

### Issues → lines

Lines are derived in three tiers, in this order:

1. **Milestones.** Each milestone becomes a colored line, in milestone (creation)
   order. An issue with a milestone always lands on its milestone line, with its
   full title — milestones win over any shared prefix.
2. **Shared title prefixes.** Among issues with *no* milestone, those whose titles
   share a leading prefix — the text before the first delimiter in the set `:`,
   `—` (em dash), `–` (en dash), or ` - ` (spaced hyphen; a bare `-` is left alone
   so `Cloud-backed` isn't split) — are grouped. A prefix shared by **2 or more**
   such issues becomes a line named **verbatim** by that prefix (the
   lowest-numbered member's casing; grouping is case-insensitive). These lines
   come after the milestone
   lines, ordered by the lowest issue number in each group. **The shared prefix is
   stripped from each member's station name** (and the remainder's first letter is
   capitalized), since the line already carries it — e.g. on the
   `Roadmap generator` line, `"Roadmap generator — agent skill doc"` becomes the
   station `"Agent skill doc"`.
3. **`Backlog`.** Any milestone-less issue that joins no prefix group (including a
   unique delimited prefix — a group of one — which keeps its full title) lands on
   a single catch-all **`Backlog`** line. An issue whose milestone isn't in the
   milestones list also folds into `Backlog`, so the map never has a dangling line
   reference. A map with no lines at all (empty repo) still gets a `Backlog` line.

One line per station — no interchanges in v1.

### Shared title prefixes → tags

Independently of the line tiers above, after names are settled the generator
collapses any **leading whole words shared by 2 or more station names** into a
**tag**: the shared words are stripped from each name (and surfaced as a tag in the
station's detail panel), so long titles that all start the same way don't overlap
on the map. The longest shared leading prefix wins, matching is case-insensitive,
and a remainder word is always left behind (a name is never reduced to nothing).
This complements the prefix→line tier — a prefix that didn't form a line can still
become a tag.

### Dependencies → edges

Edge direction is "prereq → dependent": the prereq must be `done` before the
dependent unlocks. Pairs are sourced, then deduped, from:

1. **Native links**:
   - **Sub-issue** (via `gh api graphql`) — the child is the prereq, the parent is
     the dependent, so a parent can't close until its children do.
   - **blocked by** (via the REST dependencies endpoint,
     `issues/{n}/dependencies/blocked_by`, one call per issue) — the blocking issue
     is the prereq, this issue is the dependent.
2. **Body-text fallback** — `Depends on #N` / `Blocked by #N` parsed out of the
   issue body (comma- or space-separated `#N` lists are supported).

Each edge is colored by the **downstream** (`to`) station's line. A pair is kept
only when both endpoints are real stations; references to excluded issues are
dropped.

### Status

- **Closed** issue → `done`.
- Every other (open) station starts `available`, then the dependency cascade
  (`recompute`) settles it to `locked` or `available` based on whether its prereqs
  are `done`.
- An in-progress marker on an issue (a `wip` / `in-progress` signal) maps to
  `active` where the generator surfaces it; otherwise the cascade governs status.

The status vocabulary (`locked` / `available` / `active` / `done`) is the project's
ubiquitous language — see `CONTEXT.md`.

### Layout

Deterministic topological layout: a station's column tracks its depth in the
dependency graph; rows are packed per line. Re-running the generator on unchanged
inputs produces an unchanged map, so diffs stay meaningful.

## The native relationship queries

Native links are not on the `gh issue list` JSON surface, so the script fetches them
separately and flattens both into plain `{ prereq, dependent }` pairs:

- **Sub-issues** — a GraphQL query (`gh api graphql`) against
  `repository(owner, name).issues`, paginating 100 at a time and reading each
  issue's `subIssues` nodes.
- **Blocked-by** — the REST dependencies endpoint
  (`gh api repos/{owner}/{repo}/issues/{n}/dependencies/blocked_by`), one call per
  issue. (An earlier version declared a GraphQL `blockedBy` field but never actually
  requested it, so native blocked-by links were silently dropped — hence the move to
  the REST endpoint.)

Both steps are **best-effort**: if a field/endpoint is unavailable on the host, the
script warns on stdout and falls back to the `Depends on #N` / `Blocked by #N`
body-text edges. A run that prints that warning is not a failure — it just means
edges came only from the other sources.

## Reading stdout

After writing the file, the generator reports what it produced (station and line
counts). Before trusting a map, scan stdout for:

- **Dropped edges** — dependency pairs the generator could not honor (a missing
  endpoint, or an edge removed to break a cycle). The generator breaks dependency
  cycles deterministically; the broken edges are listed so you can see what was cut.
- **Validation warnings** — structural issues in the produced map.
- The **best-effort relationship warning** described above.

If dropped edges or warnings look wrong, fix the source issues (correct a
`Blocked by`, set the right milestone, close/reopen) and regenerate — don't
hand-edit the JSON to paper over a bad relationship.

## Scoping with `--filter`

`--filter <label-or-milestone>` narrows the map to issues carrying that label or
belonging to that milestone, writing `maps/<slug>.json` (slug derived from the
filter) instead of `maps/roadmap.json`. Use it to publish a focused map (e.g. one
milestone's slice) alongside the full roadmap.

## Committing

Review the `maps/*.json` diff like any other change, then commit it. Do not modify
the source GitHub issues as part of generating a map — the map is downstream of the
tracker, not the other way around.
