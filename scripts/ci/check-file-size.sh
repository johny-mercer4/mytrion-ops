#!/usr/bin/env bash
# 600-line cap on src/**/*.ts (house rule). Existing offenders are grandfathered unless they grow.
set -euo pipefail

if [ -z "${BASE:-}" ] || [ -z "${HEAD:-}" ]; then
  echo "BASE and HEAD must be set (PR base/head SHAs)."
  exit 1
fi

CAP=600
fail=0

while IFS= read -r f; do
  [ -z "$f" ] && continue
  [[ "$f" == src/* && "$f" == *.ts ]] || continue
  [[ "$f" == src/db/migrations/* ]] && continue
  [ -f "$f" ] || continue

  head_lines=$(wc -l < "$f" | tr -d ' ')
  base_lines=0
  if git cat-file -e "$BASE:$f" 2>/dev/null; then
    base_lines=$(git show "$BASE:$f" | wc -l | tr -d ' ')
  fi

  if [ "$head_lines" -le "$CAP" ]; then
    continue
  fi

  # New file over the cap, or an existing offender that grew further.
  if [ "$base_lines" -le "$CAP" ] || [ "$head_lines" -gt "$base_lines" ]; then
    echo "::error file=$f::$f is $head_lines lines (cap $CAP; was $base_lines on the PR base)"
    fail=1
  else
    echo "grandfathered $f ($head_lines lines, was $base_lines — did not grow)"
  fi
done < <(git diff --name-only "$BASE...$HEAD")

if [ "$fail" -ne 0 ]; then
  exit 1
fi
echo "File size cap OK."
