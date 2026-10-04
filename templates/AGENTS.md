# PROJECT: the agent map

Every agent reads this file: Claude Code through CLAUDE.md, and Codex, Cursor, Grok and OpenCode directly. Keep it a map under about 150 lines. Procedures live in the g-cauc skills (`~/code/g-cauc`); enforcement lives in scripts, CI and branch protection.

Autonomy: attended

## What this is

Two or three sentences: the product, who uses it, and the one thing it must never get wrong.

## Commands

- `scripts/done --fast`: lint, types and the tests for what changed. Paste its summary whenever you claim a pass.
- `scripts/done --full`: everything, including the full end-to-end suite on a fresh stack. CI runs exactly this.
- `scripts/dev up` / `scripts/dev down`: the app and its services for this worktree.
- `scripts/dev testdb -- CMD`: CMD against a throwaway database.
- `scripts/deploy staging`: deploy main to staging, then the smoke pass. CI runs it after every merge.

## Layout

- `path/`: what lives there, and where its tests are.

## Test layers

| Layer | Tool | Command | What it proves |
|---|---|---|---|
| Unit | the project's runner | `scripts/done --fast` | Pure logic |
| Integration | the project's runner against real services in Docker | `scripts/dev testdb -- ...` | Data, queues, tenancy |
| End to end | Playwright, or the right driver for this app | `scripts/done --full` | A signed-in user's real workflow |
| Staging smoke | the end-to-end tool against the staging URL | `scripts/deploy staging` | The deployed system works |

## Product rules

1. Rules only this product has, each from a real decision or failure.

## Hard lines

1. Never push to main, force-push, or rewrite shared history. Main changes only through a PR with every required check green.
2. Production is Garrett's: no production hosts, credentials, data or deploys.
3. Tests never touch a database that is not a throwaway one, and nothing is ever sent to a real person: mail, texts, calls and payments are faked.
4. Fix the code, not the test. Change a test only when the spec is wrong, and say so in the PR.
5. Anything a person sees is opened in a browser, signed in with seeded data, before it is called done. If you did not open it, say so.
6. Never wait on Garrett mid-run: label the issue `needs:garrett` with one question and a default, and move on.

## Where things are decided

- `specs/`: one file per spec, with acceptance checks and the build plan.
- `DECISIONS.md`: decisions, newest last, append-only.

## Writing

No em or en dashes anywhere. Never hard-wrap markdown: one physical line per paragraph, list item and table row.

Text a person reads (README, `docs/`, specs, PR bodies, commit message bodies, comments) is in Simplified Technical English: follow `~/code/g-cauc/writing.md` and run its check.
