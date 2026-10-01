#!/usr/bin/env bash
# Link every agent-kit skill into Claude Code and Codex. Safe to rerun.
# Refuses to replace anything at the target that is not already a symlink.
set -euo pipefail

kit="$(cd "$(dirname "$0")/.." && pwd)"
targets=("$HOME/.claude/skills" "$HOME/.codex/skills")

for target in "${targets[@]}"; do
  mkdir -p "$target"
  for skill in "$kit"/skills/*/; do
    name="$(basename "$skill")"
    link="$target/$name"
    [ -f "$skill/SKILL.md" ] || continue
    if [ -e "$link" ] && [ ! -L "$link" ]; then
      echo "skip $link: exists and is not a symlink" >&2
      continue
    fi
    ln -sfn "${skill%/}" "$link"
    echo "linked $link"
  done
done
