# Lanes

A lane is one CLI and model that can run work. There is no global limit on jobs: the foreman fills every lane up to its own `Max jobs`, across all projects, so adding a provider, a model or a bigger plan adds capacity. Which lane does which job, and the fallback order, is in `routing.md`.

## The lanes

| Lane | Family | Subscription | Weight | Max jobs | Status |
|---|---|---|---|---|---|
| `composer` | Cursor | Cursor Ultra | light | 6 | on |
| `grok` | xAI | Cursor Ultra | light | 6 | on |
| `claude` | Anthropic | Claude Max 20x | medium | 4 | on |
| `codex` | OpenAI | ChatGPT Pro ($100) | heavy | 3 | on; its weekly allowance lasted about one day of full use on 2026-10-01 |
| `gemini` | Google | Cursor Ultra | light | 2 | on, for chores and as a spare reviewing family |
| `grok-xai` | xAI | SuperGrok, through the `grok` CLI | light | 0 | off: Garrett has only the small X subscription; Grok runs through Cursor instead |
| `muse` | Meta | Muse Code plan | light | 0 | off: run `muse auth` once on a paid plan (never the free contributor tier, which trains on your code), then set Max jobs |

Weight is how hard a job in that lane draws on its subscription. Light lanes are where the volume goes. If the Mac itself bogs down (each build can boot a full local stack), lower the light lanes' Max jobs first.

## Launch commands

Every prompt starts with the foreman's marker `[ak:<project>#<issue>:<role>:<round>]`.

**Claude** (can push and open PRs itself):

```bash
cd <worktree> && claude --bg --name "ak-<P>-<N>-<role>" --permission-mode auto --model opus "<prompt>"
```

**Codex** (if its sandbox refuses `git push`, it commits and leaves `AK_PR.md`):

```bash
cd <worktree> && nohup codex exec -m gpt-6.1-sol --sandbox workspace-write "<prompt>" < /dev/null > <log> 2>&1 &
```

**Cursor lanes** (`composer`, `grok`, `gemini`), proven on CallFlow 2026-10-02. The sandbox blocks GitHub, so these jobs never push or comment; they leave `AK_PR.md`, `AK_FIX.md` or `AK_REVIEW.md` and the foreman posts it.

```bash
cd <worktree> && nohup cursor-agent -p --model <model id> --sandbox enabled --force --trust --workspace <worktree> --add-dir <repo>/.git "<prompt>" < /dev/null > <log> 2>&1 &
```

`--add-dir <repo>/.git` lets a job commit inside a linked worktree. Model ids: `composer-2.5`, `grok-4.7-medium`, `grok-4.7-high`, `grok-4.7-xhigh`, `gemini-3.7-flash-high`. List them with `cursor-agent --list-models`. Use only the local CLI: Cursor's cloud agents bill at API prices. GPT and Claude models through Cursor bill differently from Cursor's own models and use up the plan faster, so they are never a lane default; run one by hand only when every lane in a routing row is out (GPT-5.6 Sol through Cursor gave a correct PASS on CallFlow PR 71).

## Telling when a lane is out

A lane is out when its last job failed on a usage limit. Whoever sees the limit writes the reset time to `~/code/agent-kit/limits/<lane>` as one ISO 8601 line (the folder is gitignored). A lane is out while that time is in the future; an expired file means the lane is back. This is the kit's one cache: it is safe to delete, and deleting it only costs one failed job.

- `claude`: `claude agents --json` shows a session waiting on a usage limit, with its reset time.
- `codex`: the job log says it hit the limit and when it resets (for example "try again at Oct 6th, 2026 3:21 PM").
- Cursor lanes: the job log reports the usage or spend limit. Keep Cursor's on-demand spending off or capped, so overflow never bills at API prices.
