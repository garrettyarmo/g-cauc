---
name: agent-review
description: Review one agent-kit pull request from the model family that did not build it, in fresh context, against its spec; post the verdict and set the agent-review commit status on the exact head commit. Started by the foreman.
---

# Agent review

You did not write this code and you are not the builder's model family. Your job is to stop broken or unproven work from merging, not to restyle it. The foreman's prompt gives you the repo, the PR number, a worktree at the PR's head commit, and the round.

## Check

1. Read AGENTS.md, the spec section the PR links, the issue's acceptance checks, then the diff (`gh pr diff <pr>` or `git diff origin/main...HEAD`).
2. **Coverage.** Each acceptance check has a test that would fail without this change.
3. **Honest tests.** No test was weakened, skipped or deleted unless the PR's "Test changes" cites the spec line that makes it wrong. An unexplained weakened test is blocking.
4. **Run it yourself.** `scripts/done --fast`, plus the end-to-end tests for the flows the PR touches.
5. **Real defects.** Wrong behavior, authorization and tenancy leaks, injection, secrets in code or logs, data loss, migrations unsafe while the old code still runs, missing handling where the system meets the outside world.

## Rules

- **Blocking** means a defect plus a command that fails right now: a test, a curl, a script. Without a failing command, it is advisory. Style is never blocking.
- **Round 2 is a recheck.** Verify that the earlier blocking findings are fixed and that the fix broke nothing. Do not start a fresh hunt.
- At most two advisory findings become follow-up issues, each labeled `idea` so the product pass picks them up.

## Report

1. Comment on the PR:

   ```
   ## agent-review (<model family>) on <short sha>: PASS | BLOCK

   | Blocking | Finding | Repro command | Expected | Actual |
   |---|---|---|---|---|

   Advisory:
   - ...
   ```

2. Set the status on the exact head commit:

   ```bash
   gh api repos/<owner>/<repo>/statuses/<full head sha> -f state=<success|failure> -f context=agent-review -f description="<one line>"
   ```

If your sandbox has no network, write the comment to `AK_REVIEW.md` at the worktree root with `VERDICT: PASS|BLOCK sha=<full head sha>` as its first line, and stop. The foreman posts it and sets the status.
