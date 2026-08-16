#!/usr/bin/env bash
#
# Cloud Agent `start` phase — per-boot reconciliation. Runs every time the VM starts.
# Must tolerate restarts, avoid duplicates, reach readiness, then return (no foreground server).
#
#   * starts the Postgres 16 cluster on :5433
#   * ensures the octane role / octane_assistant db / pgvector extension exist
#   * applies pending Drizzle migrations and seeds baseline rows (both idempotent)
#
# The long-running API + web dev servers are launched as `terminals`, not here.
set -euo pipefail
cd "$(dirname "$0")/.."

PG_VER=16
PG_PORT=5433
DB_NAME=octane_assistant
DB_USER=octane
DB_PASS=octane

corepack enable >/dev/null 2>&1 || true

# ── 1. Start the cluster (idempotent — a no-op error if already running) ──────
sudo pg_ctlcluster "$PG_VER" main start 2>/dev/null || true

# Wait until Postgres actually accepts connections on :5433.
ready=0
for _ in $(seq 1 30); do
  if sudo -u postgres pg_isready -p "$PG_PORT" -q; then ready=1; break; fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "[start] Postgres did not become ready on :$PG_PORT" >&2
  sudo pg_lsclusters || true
  exit 1
fi

# ── 2. Ensure role + database + extension (all idempotent) ───────────────────
sudo -u postgres psql -p "$PG_PORT" -tAc \
  "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1 \
  || sudo -u postgres psql -p "$PG_PORT" -c "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS';"

sudo -u postgres psql -p "$PG_PORT" -tAc \
  "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 \
  || sudo -u postgres createdb -p "$PG_PORT" -O "$DB_USER" "$DB_NAME"

sudo -u postgres psql -p "$PG_PORT" -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null

# ── 3. Apply migrations + seed baseline data (idempotent) ────────────────────
echo "[start] applying migrations"
CI=1 corepack pnpm db:migrate
echo "[start] seeding baseline data"
CI=1 corepack pnpm db:seed

echo "[start] ready — Postgres up on :$PG_PORT, schema migrated and seeded"
