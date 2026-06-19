---
name: roadmap-map
description: Generate a PointPlanner roadmap map from a repo's GitHub issues — fetch via gh, run the bundled generator, review the maps/*.json diff and stdout warnings, and commit. Use when the user wants to (re)generate a roadmap, build a map from GitHub issues, or refresh maps/roadmap.json.
---

# Roadmap map

Turn a repo's GitHub issues into a [PointPlanner](https://github.com/cowboydiver/pointplanner)
map — a `maps/*.json` file PointPlanner bundles and renders as a subway-style
dependency map. This skill is **self-contained**: the generator and the pure
transform it needs are vendored under [`scripts/`](scripts/), so it works in any
repo with `gh` and Node, not just PointPlanner itself.

Read [`REFERENCE.md`](REFERENCE.md) for the mapping conventions before running, so
you can review the output rather than just produce it.

## When to use

- "Generate / refresh the roadmap map."
- "Build a map from our GitHub issues."
- "Make a map for the `v1.0` milestone" (a scoped, `--filter`ed map).

## Prerequisites

- `gh` (GitHub CLI) installed and authenticated; the generator infers the repo
  from the current checkout (`gh repo view`).
- Node 20+ for running the bundled TypeScript via `tsx` (`npx tsx` fetches it on
  demand — no install or build step needed).

## The flow

1. **Confirm scope.** Whole repo (`maps/roadmap.json`) or a single label /
   milestone (`maps/<slug>.json`)? Default to the whole repo unless the user
   names a milestone or label.

2. **Fetch + generate.** Run the generator from the repo root. It shells out to
   `gh` for you (issues, milestones, and the `gh api graphql` sub-issue /
   blocked-by query), runs the pure transform, and writes the JSON.

   If the host repo already exposes a `generate-map` npm script (PointPlanner
   does), prefer it — it's wired to that project's own tested source:

   ```bash
   npm run generate-map                       # → maps/roadmap.json
   npm run generate-map -- --filter v1.0      # → maps/<slug>.json, scoped
   ```

   Otherwise run the bundled standalone generator (adjust the path if the skill
   lives somewhere other than `.claude/skills/`):

   ```bash
   npx tsx .claude/skills/roadmap-map/scripts/generate-map.ts                # → maps/roadmap.json
   npx tsx .claude/skills/roadmap-map/scripts/generate-map.ts --filter v1.0  # → maps/<slug>.json
   npx tsx .claude/skills/roadmap-map/scripts/generate-map.ts --out roadmaps # write to ./roadmaps
   ```

   Output goes to `./maps` under the current directory by default; override with
   `--out <dir>` or the `ROADMAP_MAP_DIR` env var. Do not call `gh` by hand or
   hand-edit the JSON.

3. **Read stdout.** Check the run's output before trusting the map:
   - **Dropped edges** — pairs the generator couldn't honor, including edges cut
     to break a dependency cycle deterministically.
   - **Validation warnings** — structural problems in the produced map.
   - **Best-effort relationship warning** — native links unavailable on the host;
     edges fell back to `Depends on #N` / `Blocked by #N` body text.

   If anything looks wrong, fix the **source issues** (a stray `Blocked by`, a
   missing milestone, a cycle between two issues) and regenerate. Don't patch the
   JSON to paper over a bad relationship.

4. **Review the diff.** `git diff` the touched `maps/*.json`. The generator is
   deterministic, so an unchanged repo yields an empty diff; any change should be
   explainable by issue activity. Sanity-check new/removed stations, line
   assignments, and edge colors.

5. **Commit.** Commit the regenerated map(s) on their own. The map is downstream
   of the tracker — never modify GitHub issues as part of generating it.

## Conventions (summary)

See [`REFERENCE.md`](REFERENCE.md) for the full reference. In brief:

- **Milestones → lines** (creation order, deterministic); no-milestone issues →
  a `Backlog` line. One line per station (no interchanges in v1).
- **Dependencies → edges**, sourced from native sub-issue + `blocked by` links
  (via `gh api graphql`) with `Depends on #N` / `Blocked by #N` body text as a
  fallback. Each edge is colored by the downstream station's line.
- **Status**: closed → `done`; a `wip` / `in-progress` issue → `active`;
  everything else is settled to `locked` / `available` by the dependency cascade.
- A **closed** issue only becomes a station when an open issue depends on it.
