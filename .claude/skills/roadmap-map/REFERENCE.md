# Roadmap map — conventions reference

How the bundled generator turns a repo's GitHub issues into a PointPlanner map (a
`maps/*.json` file PointPlanner can render and edit). The generator lives in
[`scripts/generate-map.ts`](scripts/generate-map.ts); the pure transform it calls
is vendored under [`scripts/lib/`](scripts/lib/). This doc records the conventions
that transform follows so a generated map is reviewable rather than mysterious.

## The flow

1. **Fetch** the issue data via the `gh` CLI (the script shells out for you — see
   "What the generator reads"; you do not call `gh` by hand).
2. **Generate** with the bundled script (or a host `npm run generate-map`). Bare,
   it writes `maps/roadmap.json`. With `--filter <label-or-milestone>`, it scopes
   to a subset and writes `maps/<slug>.json` instead.
3. **Review** the resulting `maps/*.json` diff and read the generator's stdout for
   dropped-edge and validation warnings.
4. **Commit** the map. Committed `maps/*.json` are bundled into PointPlanner and
   appear in the MapSwitcher as editable maps.

```bash
npx tsx .claude/skills/roadmap-map/scripts/generate-map.ts                      # → maps/roadmap.json
npx tsx .claude/skills/roadmap-map/scripts/generate-map.ts --filter v1.0        # → maps/<slug>.json
```

The script infers the repo from the current clone (`gh repo view`), so run it from
inside the checkout with an authenticated `gh`. The output directory defaults to
`./maps` and can be set with `--out <dir>` or the `ROADMAP_MAP_DIR` env var.

## What the generator reads

All network I/O is in the script; the transform that builds the map is pure (and
unit-tested in PointPlanner, where this code originates). The script fetches, via
`gh`:

- **Issues** — `gh issue list --state all` (open and closed), with
  `number,title,state,milestone,body,labels,assignees,url`.
- **Milestones** — the REST API (`gh api repos/{owner}/{repo}/milestones`), in
  creation order, which fixes a deterministic line order.
- **Relationships** — native sub-issue and `blocked by` links via `gh api graphql`
  (see below).

## Mapping conventions

### Issues → stations

- One issue = one station; sub-issues are also stations (one each).
- **Open** issues always become stations.
- A **closed** issue surfaces only when an open issue depends on it — it is rendered
  as a `done` prereq. Closed issues with no open dependent are excluded.

### Milestones → lines

- Each milestone becomes a colored line, in milestone (creation) order.
- Issues with no milestone land on a single catch-all **`Backlog`** line.
- An issue whose milestone isn't in the milestones list folds into `Backlog` so the
  map never has a dangling line reference.
- One line per station — no interchanges in v1.

### Dependencies → edges

Edge direction is "prereq → dependent": the prereq must be `done` before the
dependent unlocks. Pairs are sourced, then deduped, from:

1. **Native links** fetched via `gh api graphql`:
   - **Sub-issue** — the child is the prereq, the parent is the dependent.
   - **blocked by** — the blocking issue is the prereq, this issue is the dependent.
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
- An in-progress label on an open issue (`wip` / `in-progress` / `in progress`)
  maps to `active`.

The status vocabulary is `locked` / `available` / `active` / `done`.

### Labels

- `est:<value>` or `size:<value>` (e.g. `est:3d`, `size:M`) → the station's
  estimate; the first match wins.
- `wip` / `in-progress` / `in progress` → `active` status (open issues only).
- All other labels become the station's `tags`.

### Layout

Deterministic topological layout: a station's column tracks its depth in the
dependency graph; rows are packed per line. Re-running the generator on unchanged
inputs produces an unchanged map, so diffs stay meaningful.

## The `gh api graphql` relationship query

Native sub-issue / blocked-by links are not on the `gh issue list` JSON surface, so
the script issues a GraphQL query (`gh api graphql`) against
`repository(owner, name).issues`, paginating 100 at a time and reading each issue's
`subIssues` (and, where the host schema exposes it, `blocked by`) nodes. It flattens
those into plain `{ prereq, dependent }` pairs.

This step is **best-effort**: if the GraphQL field is unavailable on the host, the
script warns on stdout and falls back to the `Depends on #N` / `Blocked by #N`
body-text edges. A run that prints that warning is not a failure — it just means
edges came only from issue bodies.

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

## Provenance

This skill is vendored from PointPlanner (`cowboydiver/pointplanner`). The transform
under `scripts/lib/` is a copy of that project's `src/lib/` map-generation logic
(`githubToMap`, `validateMap`, `layout`, `indexes`, `dependencies`, `placeholders`)
plus the `types`/`maps` shapes it depends on. Keep it in sync if you pull a newer
version of the skill.
