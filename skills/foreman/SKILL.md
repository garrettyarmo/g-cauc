---
name: foreman
description: One agent-kit foreman pass over every unattended project, run by a scheduled task every 15 minutes. Carries failures back to builders, starts cross-family reviews, starts ready build issues in every free lane, cleans up, then exits. Never waits on workers and never writes code itself.
---

# Foreman pass

You run one pass and exit. You keep nothing between passes: GitHub, git and the process list are the whole state. Read, act, summarize. You never build or review code yourself; you start workers.

## Before anything

- If `~/code/agent-kit/STOP` exists, print its contents and exit.
- Read `~/code/agent-kit/lanes.md` and `~/code/agent-kit/projects.md`.
- Work only in projects whose AGENTS.md says `Autonomy: unattended`.
- Touch only build issues and their PRs. Ideas and spec PRs belong to the product pass.

## Names that tie it together

For project P (its folder name) and issue N:

- Worktree: `~/code/<P>_wt/ak-<N>`. Branch: `build/<N>-<slug>`.
- Logs: `~/code/<P>_wt/logs/<N>-<role>-<round>.log`.
- Every worker prompt starts with the marker `[ak:<P>#<N>:<role>:<round>]`, where role is `build`, `fix` or `review`. Claude jobs are named `ak-<P>-<N>-<role>`.
- Live jobs: `claude agents --json` (by name) and `pgrep -fl "ak:<P>#<N>"` (Codex).
- Round counts live in GitHub as comments: `<!-- ak:round gate=<ci|review|rebase|staging|restart> n=<k> -->`. Count them; post one each time you send work back.

## The pass, project by project in priority order

1. `git -C <repo> fetch --prune -q`.
2. Gather: open PRs (`gh pr list --json number,headRefName,headRefOid,labels,mergeStateStatus,statusCheckRollup`), issues labeled `ready`, `building`, `in-review` or `needs:garrett`, and live jobs.
3. **Finish Codex hand-offs.** A finished job (no live process) whose worktree holds `AK_PR.md`: push the branch, open the PR with that body, add the labels the `build` skill lists, turn on auto-merge unless `risk:high`, delete the file. A worktree holding `AK_REVIEW.md`: post it as the PR comment, set the `agent-review` status from its first line on that exact sha, delete the file.
4. **Send failures back**, each PR at most once per pass. The fix goes to the lane that built it (the PR's `lane:` label).
   - CI red on the head commit: fewer than 3 `ci` rounds, start a `fix` job with the failed log (`gh run view <run> --log-failed`, last 200 lines saved to the log folder). Otherwise park.
   - `agent-review` failed on the head commit: no `review` round yet, start a `fix` job with the review comment; the recheck then runs as a normal review. A second failure parks.
   - Conflict with main (`mergeStateStatus` is `DIRTY`): one `rebase` round as a `fix` job. Then park.
   - Staging deploy failed after a merge, with no revert open: open a revert PR (`git revert -m 1 <merge sha>` on branch `revert/<short sha>`, auto-merge on), reopen the issue with the failing log, label it `ready`, and count a `staging` round. The second strike parks.
5. **Start reviews.** A PR whose CI is green on the head commit, with no `agent-review` status on that commit and no live review job: start an `agent-review` job in the other family's lane (see the cross-family rule in lanes.md), with a worktree at the head commit.
6. **Clean up.** Merged PRs: make sure the issue is closed, drop `building` and `in-review`, remove the worktree. A `building` issue with no live job and no commit on its branch for 45 minutes: restart the build in the same lane from the pushed branch or the worktree, and count a `restart` round. The second restart parks.
7. **Dispatch.** Free slots per lane = that lane's `Max jobs` minus its live jobs across all projects. Skip a lane that is at its usage limit. There is no other limit. Candidates are `ready` issues whose every `Blocked by #<n>` is closed and whose `area:` matches no `building` or `in-review` issue in the same project. Order: project priority, then issue number. For each candidate:
   1. Lane: its `lane:` label if that lane has a free slot; otherwise any lane with a free slot whose `Does` includes build.
   2. `git -C <repo> worktree add ~/code/<P>_wt/ak-<N> -b build/<N>-<slug> origin/main`.
   3. Launch the `build` job (commands below).
   4. Label the issue `building`, remove `ready`, and comment `<!-- ak:start lane=<lane> -->`.

   Stop when no lane has a free slot.

## Launch commands

Claude lane:

```bash
cd <worktree> && claude --bg --name "ak-<P>-<N>-<role>" --permission-mode auto --model opus "[ak:<P>#<N>:<role>:<round>] Use the <build|agent-review> skill. Repo: <repo>. Issue: #<N>. PR: <pr or none>. Worktree: <worktree>. Round: <round>. Failure: <log path or comment URL or none>."
```

Codex lane:

```bash
cd <worktree> && nohup codex exec -m gpt-6.1-sol --sandbox workspace-write "[ak:<P>#<N>:<role>:<round>] Use the <build|agent-review> skill. Repo: <repo>. Issue: #<N>. PR: <pr or none>. Worktree: <worktree>. Round: <round>. Failure: <log path or comment URL or none>." > <log> 2>&1 &
```

The pilot settles the exact flags. Change them here and in lanes.md, nowhere else.

## Park

Label the issue `needs:garrett`, drop `building` and `in-review`, and comment: what failed, the exact failing command or finding, the rounds tried, and one question with a default ("Default if no answer by tomorrow: ..."). Then move on. A parked issue never stops the rest of the queue.

## Finish

Print a summary under 15 lines: per project, builds started (issue and lane), fixes sent, reviews started, merged, parked, and lanes that were full or at their limit. Exit.
