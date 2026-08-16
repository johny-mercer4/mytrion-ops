#!/usr/bin/env bash
#
# Cloud Agent `install` phase — durable, idempotent repository setup.
# Runs after the repo is checked out. Must terminate and start no long-lived process.
#
#   * ensures Postgres 16 + pgvector are present (no-op when the base snapshot already has them)
#   * installs backend + CRM dependencies from the committed lockfiles
#   * writes dev-only .env / .env.local when they do not already exist
#
# Per-boot work (starting Postgres, migrations, seed) lives in .cursor/start.sh.
set -euo pipefail
cd "$(dirname "$0")/.."

PG_VER=16

# ── 1. System dependency: Postgres 16 + pgvector ─────────────────────────────
# The snapshot base normally already carries these, so this whole block is skipped.
# It self-provisions a bare image (repository-managed use) and is safe to re-run.
if ! command -v pg_ctlcluster >/dev/null 2>&1; then
  echo "[install] Postgres not found — installing postgresql-$PG_VER + pgvector"
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    "postgresql-$PG_VER" "postgresql-$PG_VER-pgvector" "postgresql-client-$PG_VER"
fi

# Pin the cluster to :5433 (repo convention — avoids colliding with a 5432 Postgres) and
# bind to localhost only. Idempotent: pg_conftool just rewrites the value.
sudo pg_conftool "$PG_VER" main set port 5433
sudo pg_conftool "$PG_VER" main set listen_addresses localhost

# ── 2. Dependencies (backend + CRM). CI=1 keeps pnpm non-interactive in a fresh VM. ──
corepack enable >/dev/null 2>&1 || true
echo "[install] installing backend deps"
CI=1 corepack pnpm install --frozen-lockfile
echo "[install] installing CRM frontend deps"
CI=1 corepack pnpm -C apps/mytrion-crm install --frozen-lockfile

# ── 3. Backend .env (dev-only; NEVER overwrites an existing file) ────────────
# NODE_ENV=development means absent vendor secrets only warn, so the API boots against the
# local Postgres with no external credentials. These values are throwaway local secrets.
if [ ! -f .env ]; then
  echo "[install] writing dev .env"
  cat > .env <<'ENV'
NODE_ENV=development
PORT=3001
LOG_LEVEL=info
# Allow the local Vite dev server (:5173) to call the API cross-origin.
CORS_ORIGINS=http://localhost:5173,http://localhost:3000

# App database: local Postgres 16 + pgvector on :5433 (started by .cursor/start.sh)
MYTRION_OPS_DATABASE_URL=postgresql://octane:octane@localhost:5433/octane_assistant

# Core secrets (DEV ONLY — do not use in production)
JWT_SECRET=dev_jwt_secret_local_only_change_me_0123456789abcdef
ENCRYPTION_KEY=ZGV2X2VuY3J5cHRpb25fa2V5XzMyX2J5dGVzX29rISE=
PASSWORD_PEPPER=dev_password_pepper_local_only
API_KEY=dev_local_api_key_change_me
SUPPORT_BOT_GATEWAY_API_KEY=dev_local_support_bot_gateway_key_change_me_32

# Keep boot clean: disable integrations that need external credentials.
FF_ZOHO_OAUTH_ENABLED=0
FF_COMPOSIO_ENABLED=0
FF_TELEGRAM_ENABLED=0
FF_DBT_MCP_ENABLED=0
FF_JOBS_ENABLED=0

# Give the static API_KEY session a Zoho identity so owner-scoped reads don't fail
# closed locally (ignored in production).
DEV_MOCK_ZOHO_USER_ID=1
ENV
fi

# ── 4. CRM Vite dev env — talk to the local API, mock auth for local UI preview ──
if [ ! -f apps/mytrion-crm/.env.local ]; then
  echo "[install] writing apps/mytrion-crm/.env.local"
  cat > apps/mytrion-crm/.env.local <<'ENV'
VITE_API_URL=http://localhost:3001
VITE_API_KEY=dev_local_api_key_change_me
# Local UI preview bypass (dev builds only; compiled out of prod). Real deploys use Zoho OAuth.
VITE_DEV_MOCK_AUTH=1
ENV
fi

echo "[install] done"
