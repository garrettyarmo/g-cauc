---
name: adopt
description: Bring a repo up to the agent-kit contract as one pull request (AGENTS.md, CLAUDE.md, scripts/done, scripts/dev, scripts/deploy, CI, gitignore) plus repo settings (labels, auto-merge, branch protection), or list the gaps for an in-flight repo as a spec. Works for any language or stack. Run attended, with Garrett.
---

# Adopt agent-kit

Run this with Garrett present: repo settings change, and he approves them. The contract is in `~/code/agent-kit/README.md` under "The contract every project meets". The kit never cares what language or test tools a project uses, only that these entry points exist and exit 0 when green.

## 1. Inventory

Languages, package managers, test runners, existing scripts and Makefile targets, CI, deploy, environments, seed data, end-to-end tests, secrets handling. Note what is missing.

## 2. Gap list

Compare against the contract. Show Garrett each gap with its effort. For an in-flight repo, write the gaps as a spec, `specs/NNN-adopt-agent-kit.md`, whose build plan closes them with the riskiest last, and stop there.

## 3. The adopt PR

On a new branch, add:

- `AGENTS.md` from `~/code/agent-kit/templates/AGENTS.md`, filled from what exists, with `Autonomy: attended` and a `Test layers` table naming this project's real tools. Fold the existing CLAUDE.md's instructions into the matching AGENTS.md sections; nothing gets lost.
- `CLAUDE.md` from the template: `@AGENTS.md` plus Claude-only lines.
- `scripts/done` (`--fast`, `--full`), `scripts/dev` (`up`, `down`, `testdb -- CMD`) and `scripts/deploy` (`staging`), each a thin wrapper over the project's own tools, under about 100 lines, holding no state. A piece that does not exist yet (often staging) exits non-zero with `not set up yet: see ROADMAP phase 1`.
- A CI workflow: on every pull request, `scripts/done --full`; on every push to main, `scripts/deploy staging` once staging exists.
- `.gitignore` entries for `AK_PR.md` and `AK_REVIEW.md`.

Prove the scripts: run `scripts/done --fast` and `--full` and paste the summaries in the PR.

## 4. Repo settings, with Garrett's OK

After CI has run once, so its check names exist:

```bash
~/code/agent-kit/scripts/labels.sh <owner>/<repo>
gh repo edit <owner>/<repo> --enable-auto-merge --delete-branch-on-merge
```

Then a ruleset on main: pull request required, required status checks (the CI job names and `agent-review`), block force pushes and deletion, no bypass.

## 5. Register

Add the project to `~/code/agent-kit/projects.md` with Garrett's priority.

## 6. Going unattended

Switch `Autonomy: attended` to `Autonomy: unattended` only after the walking skeleton has passed every gate once while Garrett watched: a PR built with the `build` skill, reviewed with `agent-review`, auto-merged, deployed to staging, with the smoke pass green. That switch is its own one-line PR, which Garrett merges.
