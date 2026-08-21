#!/usr/bin/env bash
# Refuse updates to remote build/main. Then run the cheap CI PR gates that have
# surprise-failed Collection pushes: conventional commits vs origin/build,
# file-size cap, CRM vitest on CRM diffs, vendored-bundle when src moved
# without app/. Does not run the full backend suite.
# Requires: git config core.hooksPath .githooks
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

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! git rev-parse --verify origin/build >/dev/null 2>&1; then
  echo "pre-push: origin/build is missing. Fetch it so this hook matches CI:" >&2
  echo "  git fetch origin build" >&2
  exit 1
fi

# Same range shape as .github/workflows/ci.yml PR jobs (BASE...HEAD).
export BASE HEAD
BASE="$(git rev-parse origin/build)"
HEAD="$(git rev-parse HEAD)"
echo "pre-push: checking ${BASE}...${HEAD} (vs origin/build)"

bash "$ROOT/scripts/ci/check-conventional-commits.sh"
bash "$ROOT/scripts/ci/check-file-size.sh"

changed="$(git diff --name-only "$BASE...$HEAD")"

# CI `web` job always runs CRM tests; locally only when that tree moved (~55s).
if printf '%s\n' "$changed" | grep -qE '^apps/mytrion-crm/(src/|package.json|vitest|tsconfig)'; then
  echo "pre-push: CRM paths changed — pnpm -C apps/mytrion-crm test"
  pnpm -C apps/mytrion-crm test
fi

check_bundle() {
  local src_prefix="$1"
  local app_prefix="$2"
  local rebuild="$3"
  local src_changed app_changed
  src_changed=$(printf '%s\n' "$changed" \
    | grep "^${src_prefix}" \
    | grep -vE '\.test\.(ts|tsx)$|/__tests__/' \
    | grep -c . || true)
  app_changed=$(printf '%s\n' "$changed" | grep -c "^${app_prefix}" || true)
  if [ "$src_changed" -gt 0 ] && [ "$app_changed" -eq 0 ]; then
    echo "pre-push: ${src_prefix} changed without ${app_prefix}." >&2
    echo "pre-push: run '${rebuild}' and commit ${app_prefix} (CI will fail the PR)." >&2
    exit 1
  fi
}

check_bundle 'apps/mytrion-crm/src/' 'apps/mytrion-crm/app/' 'pnpm build:widget'
check_bundle 'apps/mini-app/src/' 'apps/mini-app/app/' 'pnpm -C apps/mini-app build'

echo "pre-push: OK"
