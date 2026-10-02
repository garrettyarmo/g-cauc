# 7am digest (Desktop scheduled task)

Create in the Claude Desktop app: Code tab, Routines, New routine, Local.

- Name: `g-cauc-digest`
- Schedule: daily, 7:00
- Permission mode: auto
- Model: Sonnet 5.5
- Folder: `~/code`, no worktree

Instructions:

```
Write Garrett's g-cauc digest for the last 24 hours, across every project in ~/code/g-cauc/projects.md, and post it as a new comment on the open issue titled "Daily digest" in garrettyarmo/g-cauc (create and pin it if missing) so it reaches his phone. Lead with what needs him. Sections, each skipped when empty:

1. Needs you: needs:garrett issues and agreed spec PRs, each with its one question and default, as links.
2. Shipped: PRs merged to main and whether staging deployed and passed its smoke run.
3. Proposed: new spec PRs, with size and estimate.
4. Building now: issue, lane, round.
5. Failures by cause: CI, review, conflict, staging, restart, with counts and rounds used.
6. Lanes: jobs per lane, and usage against limits (Claude from claude agents --json, Codex weekly percent from the newest ~/.codex/sessions file).
7. The number: PRs merged to staging per hour of Garrett's attention, counting each of his comments, merges and label changes as 3 minutes.

No em or en dashes. Under 40 lines.
```
