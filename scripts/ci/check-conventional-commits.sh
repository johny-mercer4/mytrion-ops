#!/usr/bin/env bash
# Enforce conventional commits on the PR range. Cloud VMs skip husky; this is the real gate.
set -euo pipefail

if [ -z "${BASE:-}" ] || [ -z "${HEAD:-}" ]; then
  echo "BASE and HEAD must be set (PR base/head SHAs)."
  exit 1
fi

# Same types CLAUDE.md names, plus the usual extras so docs/ci/build commits are not blocked.
pattern='^(feat|fix|chore|refactor|test|docs|style|perf|ci|build|revert)(\([^)]+\))?!?: .+'

# The release PR (build -> main) re-checks every commit already merged into `build`. Each was gated
# by THIS script on its way in, so failing again here enforces nothing: once a bad subject is on
# `build`, the only remedy is rewriting history on a protected branch, which CLAUDE.md forbids. The
# check cannot be satisfied, so it just blocks the release, and it blames the release rather than
# the PR that introduced the commit.
#
# Downgraded to a WARNING here rather than dropped: the subject is still wrong and still worth
# seeing. Enforcement stays where it works — the feature -> build PR.
#
# For the record, the gate did NOT miss `ver mytr` (d3798d59). It failed PR #238 exactly as
# designed and #238 was merged with the check red. If that recurs, the fix is branch protection
# requiring `verify` to pass before merge, not a looser gate here.
release_pr=0
if [ "${HEAD_REF:-}" = "build" ] && [ "${BASE_REF:-}" = "main" ]; then
  release_pr=1
fi

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
    if [ "$release_pr" -eq 1 ]; then
      echo "::warning::Non-conventional commit already on build: $msg"
    else
      echo "::error::Non-conventional commit: $msg"
      echo "  expected: feat|fix|chore|refactor|test|docs|style|perf|ci|build|revert: description"
      fail=1
    fi
  fi
done < <(git log --format=%s "$BASE...$HEAD")

if [ "$fail" -ne 0 ]; then
  exit 1
fi
if [ "$release_pr" -eq 1 ]; then
  echo "Release PR (build -> main): subjects were gated when each commit entered build."
else
  echo "Conventional commits OK."
fi
