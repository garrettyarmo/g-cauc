#!/usr/bin/env bash
# Create or update the g-cauc label set on one repo: labels.sh OWNER/REPO
set -euo pipefail

repo="${1:?usage: labels.sh OWNER/REPO}"
kit="$(cd "$(dirname "$0")/.." && pwd)"

while IFS=$'\t' read -r name color description; do
  [ -z "$name" ] && continue
  gh label create "$name" --repo "$repo" --color "$color" --description "$description" --force >/dev/null
  echo "label $name"
done < "$kit/templates/labels.tsv"
