# NNN: Title

Idea: #N · Author: product pass | CTO session · Size: S | M | L

## Why

The problem, who has it, and the evidence (a customer's words, a number, a failure). One paragraph.

## What

What changes for the user, in their terms.

Out of scope:

- What this spec deliberately does not do.

## Acceptance checks

Each check is something a machine can prove. The layer comes from the project's `Test layers` table in AGENTS.md.

| ID | Check | Layer | How it is proved |
|---|---|---|---|
| A1 | A signed-in owner sees ... | End to end | `tests/e2e/...` |

## Design notes

Interfaces, data shape, migrations, external services, security and privacy, and what could go wrong. Name the simplest design that meets the checks and why it is enough.

## Build plan

Each row becomes one build issue. A row is independently mergeable, no bigger than M, and names the acceptance checks it covers. Rows in different areas run in parallel; `Blocked by` orders the rest.

| # | Build issue | Checks | Size | Area | Lane | Blocked by | Risk |
|---|---|---|---|---|---|---|---|
| 1 | ... | A1 | S | web | claude | none | normal |

## Estimate

Queue ahead of this work, the parallelism the build plan allows, and the median time recent issues of each size took from `ready` to merged. The result as a range in hours or days.

## Decisions

Each open question with the default the build will use if nobody answers.

1. Question? Default: ...
