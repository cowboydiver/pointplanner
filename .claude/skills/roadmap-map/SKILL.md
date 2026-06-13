---
name: roadmap-map
description: Generate a PointPlanner roadmap map from this repo's GitHub issues — fetch via gh, run the generator, review the maps/*.json diff and stdout warnings, and commit. Use when the user wants to (re)generate a roadmap, build a map from GitHub issues, or refresh maps/roadmap.json.
---

# Roadmap map

Turn this repo's GitHub issues into a PointPlanner map (a `maps/*.json` file the
app bundles and renders). The conventions the generator follows are documented in
[`docs/agents/roadmap-map.md`](../../../docs/agents/roadmap-map.md) — read it
before running so you can review the output, not just produce it.

## When to use

- "Generate / refresh the roadmap map."
- "Build a map from our GitHub issues."
- "Make a map for the `v1.0` milestone" (a scoped, `--filter`ed map).

## The flow

1. **Confirm scope.** Whole repo (`maps/roadmap.json`) or a single label /
   milestone (`maps/<slug>.json`)? Default to the whole repo unless the user
   names a milestone or label.

2. **Fetch + generate.** Run the one npm script — it shells out to `gh` for you
   (issues, milestones, and the `gh api graphql` sub-issue / blocked-by query),
   runs the pure transform, and writes the JSON:

   ```bash
   npm run generate-map                       # → maps/roadmap.json
   npm run generate-map -- --filter v1.0      # → maps/<slug>.json, scoped
   ```

   `gh` must be installed and authenticated; the script infers the repo from the
   current clone. Do not call `gh` by hand or hand-edit the JSON.

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

See [`docs/agents/roadmap-map.md`](../../../docs/agents/roadmap-map.md) for the
full reference. In brief:

- **Milestones → lines** (creation order, deterministic); no-milestone issues →
  a `Backlog` line. One line per station (no interchanges in v1).
- **Dependencies → edges**, sourced from native sub-issue + `blocked by` links
  (via `gh api graphql`) with `Depends on #N` / `Blocked by #N` body text as a
  fallback. Each edge is colored by the downstream station's line.
- **Status**: closed → `done`; a `wip` / `in-progress` issue → `active`;
  everything else is settled to `locked` / `available` by the `recompute`
  cascade.
- A **closed** issue only becomes a station when an open issue depends on it.
</content>
