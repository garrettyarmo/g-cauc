# Lanes

A lane is one provider and model that can run work. There is no global limit on jobs: the foreman fills every lane up to its own `Max jobs`, across all projects, so adding a provider, a model or a bigger plan adds capacity. Raise `Max jobs` when a plan grows. Add a row for a new provider once its CLI passed one real build issue by hand.

When a lane hits its usage limit, the foreman skips it until the limit resets and sends new work to the other lanes. A job already running in that lane waits and resumes on its own.

| Lane | CLI and launch | Model | Max jobs | Does | Notes |
|---|---|---|---|---|---|
| `claude` | `claude --bg --permission-mode auto --model opus` | Opus 5.5 | 4 | build, agent-review, propose | Can push and open PRs itself. Pauses at a usage limit and resumes after reset. |
| `codex` | `codex exec -m gpt-6.1-sol` (detached, see foreman) | GPT-6.1 Sol | 4 | build, agent-review, cto-review | Weekly limit only on Pro. If its sandbox refuses `git push`, it commits and the foreman pushes and opens the PR. |
| `cursor` | `cursor-agent -p --model composer-2.5` | Composer 2.5 | 0 | chores | Off until tried by hand. Cloud agents bill at API price; use the local CLI only. |
| `grok` | `grok -p` | Grok 4.7 | 0 | chores, third-family review | Off until tried by hand. Needs the folder trusted once. |

Cross-family rule: the reviewer of a PR is never the builder's family. Claude builds are reviewed in the `codex` lane and Codex builds in the `claude` lane. A third family (Cursor or Grok) may stand in when a lane is at its limit.

How the foreman reads a lane's limit:

- `claude`: `claude agents --json` shows a session waiting on a usage limit.
- `codex`: the newest file under `~/.codex/sessions/` carries `rate_limits`; over 90 percent of the weekly window counts as full.
