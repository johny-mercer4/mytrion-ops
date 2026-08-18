#!/usr/bin/env bash
# Enforce conventional commits on the PR range. Cloud VMs skip husky; this is the real gate.
set -euo pipefail

if [ -z "${BASE:-}" ] || [ -z "${HEAD:-}" ]; then
  echo "BASE and HEAD must be set (PR base/head SHAs)."
  exit 1
fi

# Same types CLAUDE.md names, plus the usual extras so docs/ci/build commits are not blocked.
pattern='^(feat|fix|chore|refactor|test|docs|style|perf|ci|build|revert)(\([^)]+\))?!?: .+'

fail=0
while IFS= read -r msg; do
  [ -z "$msg" ] && continue
  case "$msg" in
    Merge\ *|Revert\ *) continue ;;
    # Already on hotfix/Mercera before this gate could reject them. Do not add to this list —
    # new commits must match the pattern.
    handle|Hotfix/Mercera+) continue ;;
  esac
  if ! printf '%s\n' "$msg" | grep -Eq "$pattern"; then
    echo "::error::Non-conventional commit: $msg"
    echo "  expected: feat|fix|chore|refactor|test|docs|style|perf|ci|build|revert: description"
    fail=1
  fi
done < <(git log --format=%s "$BASE...$HEAD")

if [ "$fail" -ne 0 ]; then
  exit 1
fi
echo "Conventional commits OK."
