---
name: foreman
description: One g-cauc foreman pass over every unattended project, run by a scheduled task every 15 minutes. Carries failures back to builders, starts cross-family reviews, starts ready build issues in every free lane, cleans up, then exits. Never waits on workers and never writes code itself.
---

# Foreman pass

You run one pass and exit. You keep nothing between passes: GitHub, git and the process list are the whole state. Read, act, summarize. You never build or review code yourself; you start workers.

## Before anything

- If `~/code/g-cauc/STOP` exists, print its contents and exit.
- Read `~/code/g-cauc/lanes.md`, `~/code/g-cauc/routing.md` and `~/code/g-cauc/projects.md`. A lane with an unexpired file in `~/code/g-cauc/limits/` is out.
- Work only in projects whose AGENTS.md says `Autonomy: unattended`.
- Touch only build issues and their PRs. Ideas and spec PRs belong to the product pass.

## Names that tie it together

For project P (its folder name) and issue N:

- Worktree: `~/code/<P>_wt/ak-<N>`. Branch: `build/<N>-<slug>`.
- Logs: `~/code/<P>_wt/logs/<N>-<role>-<round>-<lane>.jsonl`, written as structured events by the commands in `lanes.md`.
- Every worker prompt starts with the marker `[ak:<P>#<N>:<role>:<round>]`, where role is `build`, `fix` or `review`. Claude jobs are named `ak-<P>-<N>-<role>`.
- Live jobs: `claude agents --json` (by name), and `pgrep -fl "ak:<P>#<N>"` for Codex and Cursor jobs (the command line shows the CLI and `--model`, which tells you the lane).
- Round counts live in GitHub as comments: `<!-- ak:round gate=<ci|review|rebase|staging|restart> n=<k> lane=<lane> -->`. Count them; post one each time you send work back. With `ak:start`, they give the branch's families for the cross-family rule in `routing.md`.
- Codex and Cursor jobs may not reach GitHub. Before launching one, save what it would read there into the log folder and pass paths, not URLs: the issue body as `<N>-issue.md`, the blocking review as `<N>-review-<round>.md`, the failed CI log as `<N>-ci-<round>.log`.

## The pass, project by project in priority order

1. `git -C <repo> fetch --prune -q`.
2. Gather: open PRs (`gh pr list --json number,headRefName,headRefOid,labels,mergeStateStatus,statusCheckRollup`), issues labeled `ready`, `building`, `in-review` or `needs:garrett`, and live jobs.
3. **Finish sandboxed hand-offs** (Codex and Cursor jobs cannot always reach GitHub). For a finished job (no live process):
   - `AK_PR.md` in its worktree: push the branch, open the PR with that body, add the labels the `build` skill lists, turn on auto-merge unless `risk:high`, delete the file.
   - `AK_FIX.md`: push the branch (`--force-with-lease` after a `rebase` round) and post the file as a PR comment, then delete it. Push only what the worker committed; never commit for it.
   - `AK_REVIEW.md`: post it as the PR comment, set the `agent-review` status from its first line on that exact sha, naming the reviewing model in the description, open each item under `Follow-ups:` as an issue labeled `idea` and `from-review`, then delete it. If the first line is not exactly `VERDICT: PASS sha=<40 hex>` or `VERDICT: BLOCK sha=<40 hex>`, set no status: move the file to the log folder and start a fresh review.
   - A log that ends on a usage limit: write the lane's reset time to `~/code/g-cauc/limits/<lane>`, and start the same job in the next lane of its row in `routing.md`.
4. **Send failures back**, each PR at most once per pass. The fix goes to the lane given by the "Fix round" row of `routing.md`. Work keeps moving until it is fixed; there is no fixed number of rounds.
   - CI red on the head commit: start a `fix` job with the failed log (`gh run view <run> --log-failed`, last 200 lines saved to the log folder).
   - `agent-review` failed on the head commit: start a `fix` job with the review comment; the recheck then runs as a normal review.
   - Conflict with main (`mergeStateStatus` is `DIRTY`): a `rebase` round as a `fix` job.
   - **Progress, not a count.** A round made progress when at least one failing test or blocking finding (by its ID, B1, B2 and so on) is now fixed, even if new ones appeared. The PR is **stalled** when the same failing test or finding survived two fix rounds in a row. When stalled, move the fix one step stronger along the "Fix round" row, up to Opus 5.5, and give it two more rounds. Park only when it is stalled on Opus 5.5, or as a runaway guard after 12 rounds on one PR. A parked PR never stops the rest of the queue.
   - Staging deploy failed after a merge, with no revert open: open a revert PR (`git revert -m 1 <merge sha>` on branch `revert/<short sha>`, auto-merge on), reopen the issue with the failing log, label it `ready`, and count a `staging` round. The same progress rule applies: park when the same staging failure comes back after two fixes on the strongest lane.
5. **Start reviews.** A PR whose CI is green on the head commit, with no `agent-review` status on that commit and no live review job: start an `agent-review` job in the first lane of the matching review row in `routing.md` that is not out and whose family has no commit on the branch, with a worktree at the head commit.
6. **Clean up.** Merged PRs: make sure the issue is closed, drop `building` and `in-review`, remove the worktree. A `building` issue with no live job and no commit on its branch for 45 minutes: restart the build from the pushed branch or the worktree, and count a `restart` round. After two restarts in one lane, restart it in the next lane of its build row instead. Park only after it has stalled on Opus 5.5.
7. **Dispatch.** Free slots per lane = that lane's `Max jobs` minus its live jobs across all projects. Skip a lane that is at its usage limit. There is no other limit. Candidates are `ready` issues whose every `Blocked by #<n>` is closed and whose `area:` matches no `building` or `in-review` issue in the same project. Order: project priority, then issue number. For each candidate:
   1. Lane: the first lane in the matching build row of `routing.md` (by size, risk and the issue's nature) that has a free slot and is not out. The issue's `lane:` label is the CTO's hint; use it when that lane is free.
   2. `git -C <repo> worktree add ~/code/<P>_wt/ak-<N> -b build/<N>-<slug> origin/main`.
   3. Launch the `build` job (commands below).
   4. Label the issue `building`, remove `ready`, and comment `<!-- ak:start lane=<lane> -->`.

   Stop when no lane has a free slot.

## Launch commands

Use the commands in `lanes.md` for the chosen lane. The prompt is the marker, then: `Use the <build|agent-review> skill. Repo: <repo>. Issue: #<N>. PR: <pr or none>. Worktree: <worktree>. Round: <round>. Failure: <log path or comment URL or none>.` Codex and Cursor jobs get file paths for the issue and the failure, never URLs.

## Park

Label the issue `needs:garrett`, drop `building` and `in-review`, and comment: what failed, the exact failing command or finding, the rounds tried, and one question with a default ("Default if no answer by tomorrow: ..."). Then move on. A parked issue never stops the rest of the queue.

## Finish

Print a summary under 15 lines: per project, builds started (issue and lane), fixes sent, reviews started, merged, parked, and lanes that were full or at their limit. Exit.
