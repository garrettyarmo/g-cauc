# Product pass (Desktop scheduled task)

Create in the Claude Desktop app: Code tab, Routines, New routine, Local.

- Name: `agent-kit-product-pass`
- Schedule: hourly
- Permission mode: auto
- Model: Opus 5.5
- Folder: `~/code`, no worktree

Instructions:

```
Use the propose skill for every project in ~/code/agent-kit/projects.md. Stop starting new items after 50 minutes; the next hourly pass picks up the rest. End with the summary the skill asks for.
```
