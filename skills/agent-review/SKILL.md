---
name: agent-review
description: Review one g-cauc pull request from the model family that did not build it, in fresh context, against its spec; post the verdict and set the agent-review commit status on the exact head commit. Started by the foreman.
---

# Agent review

You did not write this code and your model family has no commit on this branch. Your job is to stop broken or unproven work from merging, not to restyle it. The foreman's prompt gives you the repo, the PR number, a worktree at the PR's head commit, and the round. If your sandbox cannot reach GitHub (Codex and Cursor jobs), it also gives files holding the issue and, for a recheck, the earlier review: read those instead of GitHub, and use `git diff origin/main...HEAD`.

## Check

1. Read AGENTS.md, the spec section the PR links, the issue's acceptance checks, then the diff (`gh pr diff <pr>` or `git diff origin/main...HEAD`).
2. **Coverage.** Each acceptance check has a test that would fail without this change.
3. **Honest tests.** No test was weakened, skipped or deleted unless the PR's "Test changes" cites the spec line that makes it wrong. An unexplained weakened test is blocking.
4. **Run it yourself.** `scripts/done --fast`, plus the end-to-end tests for the flows the PR touches.
5. **Real defects.** Wrong behavior, authorization and tenancy leaks, injection, secrets in code or logs, data loss, migrations unsafe while the old code still runs, missing handling where the system meets the outside world.

## Rules

- **Blocking** means a defect plus a command that fails right now: a test, a curl, a script. Without a failing command, it is advisory. Style is never blocking.
- **Give blocking findings IDs.** B1, B2 and so on. In a recheck, report every earlier ID as `fixed` or `still failing` (with its repro output), and number any new ones after the last ID. The foreman uses these to tell progress from a stall.
- **Round 2 and later are rechecks.** Verify the earlier blocking findings and the new diff, and that the fix broke nothing. Do not start a fresh hunt across the whole PR.
- If you ran `scripts/dev up` to check something, run `scripts/dev down` before you stop.
- At most two advisory findings become follow-up issues, each labeled `idea` and `from-review`. The product pass batches those into one hardening spec instead of one spec each (day 1 filed 20 of them).

## Report

Write the findings, the advisory items and the follow-ups by `~/code/g-cauc/writing.md` (Simplified Technical English). Repro commands and output stay exactly as they ran.

1. Comment on the PR:

   ```
   ## agent-review (<model id>, <family>) on <short sha>: PASS | BLOCK

   | ID | Status | Finding | Repro command | Expected | Actual |
   |---|---|---|---|---|---|

   Advisory:
   - ...
   ```

2. Set the status on the exact head commit:

   ```bash
   gh api repos/<owner>/<repo>/statuses/<full head sha> -f state=<success|failure> -f context=agent-review -f description="<one line>"
   ```

If your sandbox has no network, do not retry `gh`. Write the comment to `AK_REVIEW.md` at the worktree root, and stop. Its first line is exactly `VERDICT: PASS sha=<full head sha>` or `VERDICT: BLOCK sha=<full head sha>` (the sha from `git rev-parse HEAD`); the foreman sets no status on anything else. End it with `Follow-ups:` listing the advisory findings that should become issues (at most two, or `none`), since you cannot file them. Commit nothing and edit no tracked file. The foreman posts it, sets the status and opens the follow-ups.
