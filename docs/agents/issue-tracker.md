# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## Closing issues on merge

Every PR must name **each** issue it resolves with its own closing keyword in the
PR body, so the merge auto-closes them:

```
Closes #6
Closes #7
```

GitHub only auto-closes issues named in that PR's description — a summary like
`(#5–#11)` in the title closes nothing past the one issue GitHub happens to
parse. A PR that resolves several issues without listing them all leaves the
rest stranded as open-but-done (use `Refs #N` for issues a PR touches but does
not fully resolve). The `.github/pull_request_template.md` seeds a `Closes`
section as a reminder.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.
