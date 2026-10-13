---
name: adopt
description: Bring a repo up to the g-cauc contract as one pull request (AGENTS.md, CLAUDE.md, scripts/done, scripts/dev, scripts/deploy, CI, gitignore) plus repo settings (labels, auto-merge, branch protection), or list the gaps for an in-flight repo as a spec. Works for any language or stack. Run attended, with Garrett.
---

# Adopt g-cauc

Run this with Garrett present: repo settings change, and he approves them. The contract is in `~/code/g-cauc/README.md` under "The contract every project meets". The kit never cares what language or test tools a project uses, only that these entry points exist and exit 0 when green.

## 1. Inventory

Languages, package managers, test runners, existing scripts and Makefile targets, CI, deploy, environments, seed data, end-to-end tests, secrets handling. Note what is missing.

## 2. Gap list

Compare against the contract. Show Garrett each gap with its effort. For an in-flight repo, write the gaps as a spec, `specs/NNN-adopt-g-cauc.md`, whose build plan closes them with the riskiest last, and stop there.

## 3. The adopt PR

On a new branch, add:

- `AGENTS.md` from `~/code/g-cauc/templates/AGENTS.md`, filled from what exists, with `Autonomy: attended` and a `Test layers` table naming this project's real tools. Fold the existing CLAUDE.md's instructions into the matching AGENTS.md sections; nothing gets lost.
- `CLAUDE.md` from the template: `@AGENTS.md` plus Claude-only lines.
- `scripts/done` (`--fast`, `--full`), `scripts/dev` (`up`, `down`, `testdb -- CMD`) and `scripts/deploy` (`staging`), each a thin wrapper over the project's own tools, under about 100 lines, holding no state. A piece that does not exist yet (often staging) exits non-zero with `not set up yet: see ROADMAP phase 1`.
- A CI workflow. On every push to a pull request, it runs `scripts/done --fast`. When the `ci:full` label is added, it runs `scripts/done --full`, and that run sets a commit status with its result. Branch protection requires that status, not the job, because GitHub counts a skipped job as passed. On every push to main, it runs `scripts/done --full`, then `scripts/deploy staging` once staging exists. Put the `labeled` trigger in its own workflow file, with its own concurrency group. Then a label event never skips, runs again or cancels a fast job (CallFlow, 2026-10-12: `gh pr checks` showed `quick skipping` after each label). Split the full suite into parallel jobs where its layers are independent. Run the tests in parallel inside each job too. Each test worker gets its own database or schema, named from its worker ID. Playwright gets more than one worker in each shard. `scripts/done --full` must finish in 12 minutes or less on the pool. When it takes longer, make it faster before you add more tests. On 2026-10-12, Bison Brain took 22 minutes with one Playwright worker in each shard. Every job that runs project code uses `runs-on: [self-hosted, gcauc]` (the pool in `~/code/g-cauc/runner/`), because hosted minutes on a private repo run out (CallFlow, 2026-10-04). A job that needs what the pool must not hold, such as a production credential, stays on `ubuntu-latest` with a comment saying why. If the project keeps a switch to GitHub's hosted runners, make the pool its default. Then a job uses hosted runners only when a repo variable asks for them. Bison Brain had the reverse on 2026-10-13: its test jobs used hosted runners unless a variable asked for the pool. Add the repo to `~/code/g-cauc/runner/repos` with its slot count (3 by default) and restart the pool. Give the workflow a `concurrency` group. Then a new push to a pull request cancels the older run of that pull request. On main, a newer run replaces a run that waits. Keep a run for each main commit only when a deploy needs it. On Bison Brain (2026-10-09), 1 run in 5 tested a commit that a newer push replaced.
- `.gitignore` entries for `AK_PR.md`, `AK_FIX.md` and `AK_REVIEW.md`.

Prove the scripts: run `scripts/done --fast` and `--full` and paste the summaries and their times in the PR.

## 4. Repo settings, with Garrett's OK

After CI has run once, so its check names exist:

```bash
~/code/g-cauc/scripts/labels.sh <owner>/<repo>
gh repo edit <owner>/<repo> --enable-auto-merge --delete-branch-on-merge
```

Then a ruleset on main: pull request required, required status checks (the fast CI job names, the commit status that the full run sets, and `agent-review`), block force pushes and deletion, no bypass. No job may have the name of that status: a skipped job counts as passed. Add `ci:full` to the adopt PR first, and set the rule after its full run has set that status once, so the name in the rule matches.

## 5. Register

Add the project to `~/code/g-cauc/projects.md` with Garrett's priority, and its accent color from its own `BRAND.md` as hex in the Color column.

## 6. Going unattended

Switch `Autonomy: attended` to `Autonomy: unattended` only after the walking skeleton has passed every gate once while Garrett watched: a PR built with the `build` skill, reviewed with `agent-review`, auto-merged, deployed to staging, with the smoke pass green. That switch is its own one-line PR, which Garrett merges.
