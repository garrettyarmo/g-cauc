# Routing: which model for which job

The rule of thumb: volume goes to the light lanes (Composer 2.5 and Grok 4.7 through Cursor), judgment and risk go to Opus 5.5, and the scarce Codex allowance is saved for the reviews where a different family matters most. Every job has a fallback order; when a lane is out (see `lanes.md`), take the next one in its row and keep going for as long as the lane stays out. Nothing waits for a lane to come back.

## The map

| Job | 1st | 2nd | 3rd |
|---|---|---|---|
| Plan with Garrett (`spec`, kickoff) | `claude` Opus 5.5 | | |
| Product pass (`propose`) | `claude` Opus 5.5 | `grok` Grok 4.7 high | |
| CTO review of a spec (`cto-review`) | `codex` GPT-6.1 Sol | `grok` Grok 4.7 high | `claude` Opus subagent, marked same family |
| Foreman pass | `claude` Sonnet 5.5, as a Desktop task | | |
| Build, size S, normal risk | `composer` Composer 2.5 | `grok` Grok 4.7 medium | `claude` Opus 5.5 |
| Build, size M, normal risk | `grok` Grok 4.7 high | `composer` Composer 2.5 | `claude` Opus 5.5 |
| Build, `risk:high`, or ambiguous or cross-cutting | `claude` Opus 5.5 | `codex` GPT-6.1 Sol | `grok` Grok 4.7 xhigh |
| Fix round (CI red, review findings, rebase) | the lane that built it | one step stronger when stalled: `grok` Grok 4.7 high | then `claude` Opus 5.5 |
| Review, normal risk | `grok` Grok 4.7 medium | `composer` Composer 2.5 | `gemini` Gemini 3.7 Flash |
| Review, `risk:high` | `codex` GPT-6.1 Sol | `claude` Opus 5.5 | `grok` Grok 4.7 high |
| Chores (dependency bumps, lint, flaky tests, docs) | `composer` Composer 2.5 | `gemini` Gemini 3.7 Flash | |
| Research subagents | `claude` Sonnet 5.5 or Opus 5.5 | `grok` Grok 4.7 high | |

When the `lane:` label on an issue names a lane that is out, route by this map instead.

## The cross-family rule

The reviewer's family is never one that has a commit on the branch. Families: Anthropic (`claude`), OpenAI (`codex`), xAI (`grok`, `grok-xai`), Cursor (`composer`), Google (`gemini`), Meta (`muse`). A model counts as its maker's family wherever it runs, so GPT through Cursor is OpenAI. A branch's families are the lanes in its issue's `ak:start` and `ak:round` comments plus any `Co-Authored-By` trailer on its commits, so a fix round in a stronger lane adds that lane's family (CallFlow PR 74 was built by Codex and finished by Claude, so neither could review it). When the first choice in a review row is one of those families, skip to the next. If every other family is out, a same-family review is allowed: say "same family" in the review comment and the status description.

## Why the map looks like this

- Day 1 on CallFlow (2026-10-01 to 02): the Codex allowance ran out in about a day with Codex building and reviewing at full speed, and the Cursor lane was never used because the kit shipped it switched off. Garrett wants Grok 4.7 and Composer 2.5 carrying most of the load because they draw lightest on the plans.
- The reviews that caught the worst defects that day (a tenant isolation bypass through foreign keys, a schema filter wildcard) were strong models reviewing a different family's work. That is why `risk:high` reviews start with GPT-6.1 Sol and Opus.
- Fix rounds keep going while they make progress (Garrett, 2026-10-02: a PR that is nearly fixed must not park while he sleeps). A stall moves the fix to a stronger model instead of stopping; only a stall on Opus 5.5, or 12 rounds on one PR, parks it.
- Change this file when the evidence changes: a lane that keeps getting blocked in review moves down its build rows; a lane that keeps passing moves up.
