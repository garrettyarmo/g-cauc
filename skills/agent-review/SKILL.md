---
name: agent-review
description: Review one agent-kit pull request from a model family that has no commit on it, in fresh context, against its spec; post the verdict and set the agent-review commit status on the exact head commit. Started by the foreman.
---

# Agent review

You did not write this code and your model family has no commit on this branch. Your job is to stop broken or unproven work from merging, not to restyle it. The foreman's prompt gives you the repo, the PR number, a worktree at the PR's head commit, and the round. If your sandbox cannot reach GitHub (the Codex and Cursor lanes), it also gives files holding the issue and, on round 2, the earlier review: read those instead of GitHub, and use `git diff origin/main...HEAD`.

## Check

1. Read AGENTS.md, the spec section the PR links, the issue's acceptance checks, then the diff (`gh pr diff <pr>` or `git diff origin/main...HEAD`).
2. **Coverage.** Each acceptance check has a test that would fail without this change.
3. **Honest tests.** No test was weakened, skipped or deleted unless the PR's "Test changes" cites the spec line that makes it wrong. An unexplained weakened test is blocking.
4. **Run it yourself.** `scripts/done --fast`, plus the end-to-end tests for the flows the PR touches.
5. **Real defects.** Wrong behavior, authorization and tenancy leaks, injection, secrets in code or logs, data loss, migrations unsafe while the old code still runs, missing handling where the system meets the outside world.

## Rules

- **Blocking** means a defect plus a command that fails right now: a test, a curl, a script. Without a failing command, it is advisory. Style is never blocking.
- **Round 2 is a recheck.** Verify that the earlier blocking findings are fixed and that the fix broke nothing. Do not start a fresh hunt.
- At most two advisory findings become follow-up issues, each labeled `idea` so the product pass picks them up. Without GitHub, list them under `Follow-ups:` in `AK_REVIEW.md` and the foreman opens them.

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

If your sandbox cannot reach GitHub, do not retry `gh`. Write `AK_REVIEW.md` at the worktree root instead, and stop:

```
VERDICT: <PASS or BLOCK> sha=<full head sha, from git rev-parse HEAD>
SUMMARY: <one line for the status description>

<the comment from step 1>

Follow-ups:
- <issue title>: <one line> (at most two; "none" when there are none)
```

The foreman sets no status unless the first line is exactly `VERDICT: PASS sha=<sha>` or `VERDICT: BLOCK sha=<sha>`. Commit nothing and edit no tracked file. The foreman posts the comment, sets the status on that sha, and opens the follow-ups.
