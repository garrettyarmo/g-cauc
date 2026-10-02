# agent-kit

One way of working for every project Garrett runs: ideas go into GitHub issues, agents turn them into agreed specs, and approved specs get built, reviewed, merged and deployed to staging without anyone watching. Production is Garrett's tap until a project has 10 clean staging runs.

agent-kit is instructions, not software. The loop is Claude Desktop scheduled tasks, the queue is GitHub Issues, the judge is GitHub's required checks, and the workers are the Claude, Codex and Cursor command-line tools. Nothing here holds state; state lives in GitHub and git. Design and research: `~/code/nessy/docs/proposals/2026-10-01-no-harness.md`. Diagram: https://claude.ai/artifact/TzKoUxmuhAmwQT2fWCHxEb

Status: v1, 2026-10-01, untested. CallFlow is the pilot.

## What is here

| Path | What it is |
|---|---|
| `skills/spec` | The CTO session. Garrett and Claude plan together: kickoff for a new project or phase, or one feature. Ends in a spec PR. |
| `skills/propose` | The product pass, run hourly. Turns `idea` issues into spec PRs, gets the CTO's agreement, turns merged specs into build issues. |
| `skills/cto-review` | The CTO's review of a spec, run unattended by the product pass on the other model family. |
| `skills/foreman` | One pass over every project: carries failures back to builders, starts reviews, starts builds, exits. |
| `skills/build` | One build issue to one pull request, tests first. Also used for fix rounds. |
| `skills/agent-review` | Cross-family review of one pull request. Sets the `agent-review` status. |
| `skills/adopt` | Brings a repo up to the contract below, as one PR. |
| `templates/` | The AGENTS.md outline, CLAUDE.md, the spec format, the label set. |
| `lanes.md` | The lanes (CLI, model, subscription), how many jobs each may run at once, launch commands, and how to tell a lane is out. |
| `routing.md` | Which model for which job, the fallback order when a lane is out, and the cross-family rule. |
| `projects.md` | The projects the product pass and foreman serve, in priority order. |
| `tasks/` | The instructions for the three Desktop scheduled tasks: product pass, foreman, 7am digest. |
| `scripts/install.sh` | Links every skill into `~/.claude/skills` and `~/.codex/skills`. |
| `scripts/labels.sh` | Creates or updates the label set on a repo. |

## The contract every project meets

The kit never assumes a language or framework. It only calls these entry points and reads their exit codes, so a Python, TypeScript, Go or mixed project all look the same from outside.

| Entry point | What it must do |
|---|---|
| `scripts/done --fast` | Lint, type check and the tests for what changed, fast enough to run many times per build. Exit 0 means green. |
| `scripts/done --full` | Everything, including the full end-to-end suite on a fresh stack. CI runs exactly this. |
| `scripts/dev up` / `down` | Boots the app and its services for one worktree, on ports that do not collide with another worktree. |
| `scripts/dev testdb -- CMD` | Runs CMD against a throwaway database that is never the dev database. |
| `scripts/deploy staging` | Deploys main to staging, then runs the smoke end-to-end pass against it. |
| `AGENTS.md` | The map every tool reads (outline in `templates/AGENTS.md`), including a `Test layers` table and an `Autonomy:` line. |
| `CLAUDE.md` | `@AGENTS.md` plus any Claude-only lines. |
| GitHub | Branch protection on main (PR only, CI and `agent-review` required, no bypass), auto-merge allowed, the label set, Issues on. |

Which test tools sit behind `scripts/done` is the project's choice and is written in its `Test layers` table: pytest, Vitest, Jest, Playwright, simulated phone calls, data checks. Every acceptance check in a spec names its layer and the command that proves it.

`Autonomy: attended` until the project's walking skeleton has passed every gate once with Garrett watching. Then `Autonomy: unattended`, which is what lets agents push feature branches and open PRs there without asking.

## The lifecycle, as labels

Ideas and specs:

1. `idea`: Garrett opened it (one line is enough). Any issue Garrett opens with no lifecycle label counts as an idea.
2. `proposed`: the product pass opened a spec PR for it.
3. `agreed`: product and CTO have both signed off on the spec PR's current commit. Waiting on Garrett.
4. Garrett merges the spec PR. That is the approval. Comment instead to reshape it.
5. The product pass creates the build issues from the spec's build plan and closes the idea with links.

Build issues:

1. `ready`: the foreman may start it once everything in its `Blocked by` list is closed.
2. `building`: a worker has it.
3. `in-review`: its PR is open; CI and the cross-family review run.
4. Closed when the PR merges. Staging deploys from main.
5. `needs:garrett`: parked with one question and a default. The queue keeps moving.

The foreman never touches an issue that is not `ready`. Nothing is `ready` until its spec was agreed by product and CTO and merged by Garrett.

Other labels: `spec` (spec PRs), `from-review` (advisory findings, batched into one hardening spec), `risk:high` (data, auth, money, migrations, deploy: Garrett merges the build PR too unless he delegated it, as CallFlow's D23 does), `size:s`, `size:m`, `size:l`, `lane:<name>`, `area:<name>` (per project, so work in different areas runs in parallel).

## Install

```bash
~/code/agent-kit/scripts/install.sh
```

```bash
~/code/agent-kit/scripts/labels.sh garrettyarmo/callflow
```

## Rules for changing the kit

1. No code that holds state. If a fix seems to need a program, look for a vendor feature first; otherwise a script under about 100 lines with no state, or nothing.
2. A line enters a skill or template only after a real failure, and says which failure. Once a week, delete lines that never fired.
3. Every skill change is tested on one real issue before it is trusted unattended.
