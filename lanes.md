# Lanes

A lane is one CLI and model that can run work. There is no global limit on jobs: the foreman fills every lane up to its own `Max jobs`, across all projects, so adding a provider, a model or a bigger plan adds capacity. Which lane does which job, and the fallback order, is in `routing.md`.

## The lanes

| Lane | Family | Subscription | Weight | Max jobs | Status |
|---|---|---|---|---|---|
| `composer` | Cursor | Cursor Ultra | light | 6 | on |
| `grok` | xAI | Cursor Ultra | light | 6 | on |
| `claude` | Anthropic | Claude Max 20x | medium | 4 | on; Sonnet 5.5 for routine jobs, Opus 5.5 only where `routing.md` names it |
| `codex` | OpenAI | ChatGPT Pro ($100) | heavy | 3 | on; its weekly allowance lasted about one day of full use on 2026-10-01 |
| `gemini` | Google | Cursor Ultra | light | 2 | on, for chores and as a spare reviewing family |
| `grok-xai` | xAI | SuperGrok, through the `grok` CLI | light | 0 | off: Garrett has only the small X subscription; Grok runs through Cursor instead |
| `muse` | Meta | Muse Code Max ($200) | light | 4 | on since 2026-10-12, with contributor mode off; its limits are not measured yet; its sandbox blocks Docker, except on myqap (see its launch command) |

Weight is how hard a job in that lane draws on its subscription. Light lanes are where the volume goes. If the Mac itself bogs down (each build can boot a full local stack), lower the light lanes' Max jobs first.

## Launch commands

Every prompt starts with the foreman's marker `[ak:<project>#<issue>:<role>:<round>]`. Every log goes to `~/code/<project>_wt/logs/<issue>-<role>-<round>-<lane>.jsonl` as structured events: that is what lets `/board` show each job's thinking, commands and verdict. Claude jobs need no log file; `/board` reads their transcripts.

**Claude** (can push and open PRs itself). `<model>` is `sonnet` (Sonnet 5.5), or `opus` (Opus 5.5) when the row in `routing.md` names Opus 5.5:

```bash
cd <worktree> && claude --bg --name "ak-<P>-<N>-<role>" --permission-mode auto --model <model> "<prompt>"
```

A Claude build, fix or PR review always runs with this command, never as an Agent subagent of a CTO session. The product pass has the one exception: its spec review fallback is a subagent with model `opus`. That pass is short and starts with a fresh context. A subagent with no model of its own runs on the session's model, and its report goes into the session's large context. When a session starts a subagent for research, a digest or log reading, it always sets the model: `haiku` or `sonnet`, and `opus` only for judgment that needs it. The `haiku` alias selects Haiku 4.5 until Claude Code moves it. For Haiku 5.5 in a headless job, use `--model claude-haiku-5-5`.

**Codex** (if its sandbox refuses `git push`, it commits and leaves `AK_PR.md`):

```bash
cd <worktree> && nohup codex exec --json -m gpt-6.1-sol --sandbox workspace-write "<prompt>" < /dev/null > <log> 2>&1 &
```

**Cursor lanes** (`composer`, `grok`, `gemini`), proven on CallFlow 2026-10-02. The sandbox blocks GitHub, so these jobs never push or comment; they leave `AK_PR.md`, `AK_FIX.md` or `AK_REVIEW.md` and the foreman posts it.

```bash
cd <worktree> && nohup cursor-agent -p --output-format stream-json --model <model id> --sandbox enabled --force --trust --workspace <worktree> --add-dir <repo>/.git "<prompt>" < /dev/null > <log> 2>&1 &
```

`--add-dir <repo>/.git` lets a job commit inside a linked worktree. Model ids: `composer-2.5`, `grok-4.7-medium`, `grok-4.7-high`, `grok-4.7-xhigh`, `gemini-3.7-flash-high`. List them with `cursor-agent --list-models`. Use only the local CLI: Cursor's cloud agents bill at API prices. GPT and Claude models through Cursor bill differently from Cursor's own models and use up the plan faster, so they are never a lane default; run one by hand only when every lane in a routing row is out (GPT-5.6 Sol through Cursor gave a correct PASS on CallFlow PR 71).

**Muse** (`muse`, proven headless 2026-10-12). It can commit in a linked worktree, push and run `gh`, so it opens its own PRs. Its built-in git skill refuses to commit or push unless the prompt allows it. So the prompt always ends with the allow line below. `--approval-mode never` with `--user-input-auto-resolve` stops it from waiting on a question. Never run it with contributor mode on: that tier trains on the code.

```bash
nohup muse exec --json --model muse-wonder-1.0 --contributor-mode off --approval-mode never --user-input-auto-resolve --workspace <worktree> "<prompt> You may commit, push this branch and open or update its PR." < /dev/null > <log> 2>&1 &
```

Its sandbox blocks the Docker socket, so a Muse job cannot start a local database or `scripts/dev up`. It runs the gates that need no database and leaves the rest to CI (see the `build` skill). The one exception is myqap. On 2026-10-12, Garrett approved `--disable-sandbox` for myqap Muse jobs, so they can use Docker and PostGIS. For a myqap job, add `--disable-sandbox` after `--user-input-auto-resolve`. With the sandbox off, Muse can read every file on the Mac. Do not turn the sandbox off for another project without Garrett's decision. Model ids: `muse-wonder-1.0` (the default) and `muse-spark-1.3`.

## Telling when a lane is out

A lane is out when its last job failed on a usage limit. Whoever sees the limit writes the reset time to `~/code/g-cauc/limits/<lane>` as one ISO 8601 line (the folder is gitignored). A lane is out while that time is in the future; an expired file means the lane is back. This is the kit's one cache: it is safe to delete, and deleting it only costs one failed job.

- `claude`: `claude agents --json` shows a session waiting on a usage limit, with its reset time.
- `codex`: the job log says it hit the limit and when it resets (for example "try again at Oct 6th, 2026 3:21 PM").
- `muse`: the log ends on a `run.terminal.*` event whose `terminal` is not `completed`, with a `reason`. Its usage limit wording is not seen yet: when a job first stops on a limit, add the wording here.
- Cursor lanes: the job log reports the usage or spend limit. Keep Cursor's on-demand spending off or capped, so overflow never bills at API prices.
