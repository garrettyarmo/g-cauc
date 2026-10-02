# Lanes

A lane is one provider and model that can run work. There is no global limit on jobs: the foreman fills every lane up to its own `Max jobs`, across all projects, so adding a provider, a model or a bigger plan adds capacity. Raise `Max jobs` when a plan grows. Add a row for a new provider once its CLI passed one real build issue by hand.

When a lane hits its usage limit, the foreman skips it until the limit resets and sends new work to the other lanes. A job already running in that lane waits and resumes on its own.

| Lane | Family | CLI and launch | Model | Max jobs | Does | Notes |
|---|---|---|---|---|---|---|
| `claude` | Claude | `claude --bg --permission-mode auto --model opus` | Opus 5.5 | 4 | build, agent-review, propose | Can push and open PRs itself. Pauses at a usage limit and resumes after reset. |
| `codex` | OpenAI | `codex exec -m gpt-6.1-sol` (detached, see foreman) | GPT-6.1 Sol | 4 | build, agent-review, cto-review | Weekly limit only on Pro. If its sandbox refuses `git push`, it commits and the foreman pushes and opens the PR. |
| `cursor-grok` | Grok | `cursor-agent -p --model grok-4.7-medium` (sandboxed, see Cursor lanes) | Grok 4.7 Medium | 3 | agent-review, cto-review | Reviewed CallFlow PR 53 by hand on 2026-10-02: a specific, correct PASS. Not yet tried on cto-review. Hands off through `AK_REVIEW.md`. |
| `cursor-composer` | Composer | `cursor-agent -p --model composer-2.5` (sandboxed, see Cursor lanes) | Composer 2.5 | 2 | fix, agent-review | Ran fix round 2 on CallFlow PR 70 by hand on 2026-10-02: red tests first, then the fix, `scripts/done --fast` and `--full` green. Not yet tried as a reviewer. Add `build` (size:s, not risk:high) once one size:s issue passes by hand. Hands off through `AK_FIX.md` and `AK_PR.md`. |

## Routing

Claude and Codex run out of usage first; on 2026-10-02 Codex hit its weekly limit in the middle of the CallFlow phase 1 build and review of Claude builds stalled. So Claude and Codex do the work where a wrong answer costs most (`risk:high` and anything larger than size:s), and the Cursor lanes take most reviews and fix rounds. For each job, take the first lane in its row that has a free slot, is not at its limit, and passes the cross-family rule.

| Job | Lanes, in order |
|---|---|
| `agent-review`, PR not `risk:high` | `cursor-grok`, `cursor-composer`, then `codex` or `claude` |
| `agent-review`, PR `risk:high` | `codex` or `claude`, then `cursor-grok` (Garrett merges risk:high PRs himself, so he is the last check) |
| `build`, `risk:high` or size:m | the issue's `lane:` label, then the other of `claude` and `codex`; never a Cursor lane |
| `build`, size:s, not `risk:high` | the issue's `lane:` label, then any lane whose `Does` includes build |
| `fix` (`ci`, `review` or `rebase` round), PR not `risk:high` | `cursor-composer`, then the lane that built it |
| `fix`, PR `risk:high` | the lane that built it, the other of `claude` and `codex`, then `cursor-composer` |
| `cto-review` (product pass) | `codex`, `cursor-grok`, then a fresh-context Claude subagent, noted "same family" |

Cross-family rule: the reviewer of a PR is never from a family that has a commit on its branch. Families are the `Family` column, and a model counts as its maker's family wherever it runs, so GPT through Cursor is OpenAI and Claude through Cursor is Claude. A branch's families are the lanes in its issue's `ak:start` and `ak:round` comments plus any `Co-Authored-By` trailer on its commits. A fix round in another lane adds that lane's family: after Composer fixes a Claude build, only Grok or OpenAI may review it. (CallFlow PR 74 was built by Codex and finished by Claude, so Grok reviewed it.) If no allowed lane is free, the review waits for the next pass; it never falls back to a builder family.

## Cursor lanes

Both Cursor lanes run the local `cursor-agent` CLI (2026.10.01, signed in as Garrett on the Ultra plan), never Cursor's cloud agents, which bill at API price. The launch, as tried on CallFlow on 2026-10-02:

```bash
cursor-agent -p --model <model> --sandbox enabled --force --trust --workspace <worktree> [--add-dir <repo>/.git] "<prompt>" < /dev/null > <log> 2>&1
```

- `--add-dir <repo>/.git` only for jobs that commit (build and fix): a worktree's git data lives in the main checkout. Reviews commit nothing and leave it out.
- The sandbox closes the network, so `gh` and `git push` fail. A review writes `AK_REVIEW.md`, a fix writes `AK_FIX.md`, a build writes `AK_PR.md`, and the foreman does the GitHub side, as it does for Codex. Local tests still run: `scripts/done --full` passed inside the sandbox on PR 70.
- Cursor does not load agent-kit skills by name, so the prompt gives the skill file's path (full launch in the foreman skill).
- With text output the log stays empty until the job ends. Tell a live job by `pgrep`, not by its log.
- Only `composer-2.5` and `grok-4.7-*` are lane defaults. GPT and Claude models through Cursor bill differently from Cursor's own models and use up the plan faster, so they are never a default; start one by hand only when the routing table has nothing else free (GPT-5.6 Sol through Cursor gave a correct PASS on CallFlow PR 71).
- Not tried yet: the `-fast` variants, `grok-4.7-high`, and Grok as a builder.

## How the foreman reads a lane's limit

- `claude`: `claude agents --json` shows a session waiting on a usage limit.
- `codex`: the newest file under `~/.codex/sessions/` carries `rate_limits`; over 90 percent of the weekly window counts as full.
- `cursor-grok`, `cursor-composer`: the CLI reports no usage (`cursor-agent about` shows only the plan tier), so read the lane's newest log (logs end in `-<lane>.log`, in any project's log folder). If that job ended without its hand-off file and its log mentions a usage limit, rate limit or quota, the lane is at its limit until the reset time the message gives, or for 24 hours from the log's time if it gives none. Read the two lanes separately: one at its limit does not mark the other. Paste the exact message here the first time it fires. Garrett sees the real numbers at cursor.com/dashboard.
