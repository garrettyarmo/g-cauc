# Foreman (Desktop scheduled task)

Create in the Claude Desktop app: Code tab, Routines, New routine, Local. Ask any Desktop session to set the 15-minute interval, since the picker offers hourly at most.

- Name: `agent-kit-foreman`
- Schedule: every 15 minutes
- Permission mode: auto
- Model: Sonnet 5.5
- Folder: `~/code`, no worktree

Instructions:

```
Use the foreman skill: one pass over every unattended project in ~/code/agent-kit/projects.md, then exit with its summary.
```

Desktop skips a run while the previous one is still going, so there is never a second foreman. Turn on Keep computer awake in the Desktop app settings.
