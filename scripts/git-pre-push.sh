#!/usr/bin/env bash
# Refuse updates to remote build/main. Merge those branches via PR only.
# stdin: <local_ref> <local_sha> <remote_ref> <remote_sha>  (git pre-push)
set -euo pipefail

REASON='Refusing push to build/main — open a PR instead.'

is_protected() {
  local name="${1#refs/heads/}"
  [ "$name" = 'build' ] || [ "$name" = 'main' ]
}

# Default IFS — must split the four git pre-push fields. `IFS= read` would
# stuff the whole line into local_ref and never see the remote.
while read -r local_ref _local_sha remote_ref _remote_sha; do
  [ -z "${local_ref:-}${remote_ref:-}" ] && continue
  if is_protected "$remote_ref" || is_protected "$local_ref"; then
    printf '%s\n' "$REASON" >&2
    exit 1
  fi
done

exit 0
