#!/usr/bin/env bash
# Stop hook — enforce the two close-out rules from CLAUDE.md that nothing else catches:
#   1. a change under packages/* needs a changeset
#   2. meaningful work needs docs/STATE.md updated
#
# Fires at most once per session (marker file), so it can never trap the model in a stop loop.
# Silent (exit 0) when there is nothing to say.
set -uo pipefail

input=$(cat 2>/dev/null || echo '{}')
session=$(printf '%s' "$input" | jq -r '.session_id // "unknown"' 2>/dev/null || echo unknown)
marker="${TMPDIR:-/tmp}/forge-closeout-${session}"
[ -e "$marker" ] && exit 0

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$root" || exit 0

# Everything this branch touched, committed or not. Untracked dirs appear as a single entry
# (e.g. ".claude/"), which is fine — we only care about packages/, apps/, docs/ and .changeset/.
base=$(git merge-base HEAD main 2>/dev/null || echo '')
committed=''
[ -n "$base" ] && committed=$(git diff --name-only "$base"...HEAD 2>/dev/null || echo '')
working=$(git status --porcelain 2>/dev/null | awk '{print $NF}')
changed=$(printf '%s\n%s\n' "$committed" "$working" | grep -v '^$' | sort -u)
[ -z "$changed" ] && exit 0

# Only nag when real code moved. Doc-only and CI-only sessions are exempt.
code=$(printf '%s\n' "$changed" | grep -E '^(packages|apps)/' || true)
[ -z "$code" ] && exit 0

pkgs=$(printf '%s\n' "$changed" | grep -E '^packages/' || true)
changeset=$(printf '%s\n' "$changed" | grep -E '^\.changeset/[^/]+\.md$' | grep -v 'README\.md' || true)
state=$(printf '%s\n' "$changed" | grep -E '^docs/STATE\.md$' || true)

missing=''
if [ -n "$pkgs" ] && [ -z "$changeset" ]; then
  missing="${missing}- Files under packages/* changed but .changeset/ has no new entry. Run \`pnpm changeset\` and commit the generated file."$'\n'
fi
if [ -z "$state" ]; then
  missing="${missing}- docs/STATE.md was not updated. Update the affected rows, the known-issues / next-steps lists, and the date at the top."$'\n'
fi
[ -z "$missing" ] && exit 0

touch "$marker"
reason="ForgeCMS close-out check (CLAUDE.md \"Definition of done\"):"$'\n'"${missing}"$'\n'"Handle these, or — if this change genuinely needs neither — say so in one line and stop."
printf '{"decision":"block","reason":%s}\n' "$(printf '%s' "$reason" | jq -Rs .)"
