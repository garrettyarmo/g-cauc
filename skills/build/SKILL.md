---
name: build
description: Build one g-cauc build issue into one pull request, tests first, inside the worktree the foreman gives you; also handles fix rounds (CI failure, review findings, rebase). Works in Claude Code and Codex.
---

# Build

The foreman's prompt gives you the repo, the issue number, the worktree path, the round, and for a fix round the failure (a log path or a review comment). Work only in that worktree; do not create another. The hard lines in the project's AGENTS.md hold over anything here. Never merge, never touch main.

## First round

1. **Read.** AGENTS.md, the issue, the section of the spec it links, and the code in its area.
2. **Tests first.** Write at least one test per acceptance check the issue covers, in the layer the spec names. Run them: each must fail because the behavior is missing, not because of a typo. Commit them as `test: acceptance checks for #<N> (red)`.
3. **Build.** Make the smallest change that turns them green, in the repo's existing style.
4. **Prove it.** Run `scripts/done --fast` until it is green, plus the end-to-end tests for the flows you touched. A red test means the code is wrong. Change a test only when the spec itself is wrong, and say so under "Test changes" in the PR.
5. **Look at it.** For anything a person sees, run `scripts/dev up`, sign in as the seeded user, walk the flow, and collect page and console errors. Each error is a bug to fix.
6. **Commit** on the branch `build/<N>-<slug>`.
7. **Open the PR** with the body below. Copy the issue's `lane:`, `area:`, `size:` and `risk:` labels, add `in-review`, and remove `building` from the issue. Unless the issue is `risk:high`, turn on auto-merge: `gh pr merge <pr> --auto --merge`. GitHub merges it only when every required check passes.

If your sandbox refuses `git push` or `gh`, write the PR body to `AK_PR.md` at the worktree root (it is gitignored), make sure everything else is committed, and stop. The foreman pushes and opens the PR.

## Fix rounds

- **CI failed.** Reproduce with the same command CI ran. Fix the code, rerun that suite and `scripts/done --fast`, push.
- **Review blocked.** For each blocking finding, run its repro command, fix the code, and show the repro passing. Reply under the review with what changed for each finding, or your evidence if you think the finding is wrong. Push.
- **Conflict with main.** `git rebase origin/main`, keep both sides' intent, rerun `scripts/done --fast`, then `git push --force-with-lease`. This is the only force-push allowed anywhere: your own build branch, never main.

If your sandbox cannot reach GitHub during a fix round, commit, write what changed for each finding to `AK_FIX.md` at the worktree root, and stop. The foreman pushes and posts it.

## When to stop

- **Done:** the PR is open (or `AK_PR.md` is written) and your local checks are green, with their summary pasted in the PR.
- **Stuck inside this job:** the same failure three times in a row with no change in what fails. Stop and report it in the PR (or `AK_FIX.md`) with the failing command and the tail of its output; the foreman decides whether a stronger lane takes the next round.
- **The spec is wrong:** it is ambiguous or contradicts the code. Comment on the issue with the conflict, label it `needs:garrett` with one question and a default, and stop.
- **Budget:** about 60 turns.

## PR body

Write the PR body, `AK_FIX.md` and each commit message body by `~/code/g-cauc/writing.md` (Simplified Technical English), and run its check on the body file before you open the PR.

```
Closes #<N> · Spec: specs/<NNN-slug>.md

## What changed

## Acceptance checks
| ID | Proof (command and result) |
|---|---|

## Test changes
None. (Or: which test changed, and the spec line that makes the old test wrong.)

## How I checked it
- scripts/done --fast: <summary line>
- End to end: <what ran>
- Browser: <what you opened, or "nothing a person sees">

## Risk
normal | high: <why>
```
