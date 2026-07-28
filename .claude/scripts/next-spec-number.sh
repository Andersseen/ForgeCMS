#!/usr/bin/env bash
# Print the next free spec number for docs/specs/, zero-padded to three digits.
# Spec numbers are not contiguous in this repo (022 is followed by 039), so "count the files"
# is wrong — take the highest existing number and add one.
set -euo pipefail

repo_root="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
specs_dir="$repo_root/docs/specs"

highest=0
for f in "$specs_dir"/[0-9][0-9][0-9]-*.md; do
  [ -e "$f" ] || continue
  n=$(basename "$f" | cut -c1-3)
  # Strip leading zeros so 039 is not read as octal.
  n=$((10#$n))
  if [ "$n" -gt "$highest" ]; then
    highest=$n
  fi
done

printf '%03d\n' $((highest + 1))
