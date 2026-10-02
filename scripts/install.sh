#!/usr/bin/env bash
# Link every g-cauc skill into Codex. Safe to rerun. Claude Code gets the
# skills from the g-cauc plugin instead (see README).
# Refuses to replace anything at the target that is not already a symlink.
set -euo pipefail

kit="$(cd "$(dirname "$0")/.." && pwd)"
targets=("$HOME/.codex/skills")

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
