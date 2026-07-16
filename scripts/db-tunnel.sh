#!/usr/bin/env bash
#
# Keep the CMP MySQL SSH tunnel up — local port → bastion EC2 → private RDS — and auto-reconnect if
# it drops. The CMP MySQL (AWS RDS) is NOT publicly reachable; this bridge is how the app (and the
# Admin → CMP Database tab) reaches it in local dev without you running ssh by hand.
#
#   pnpm tunnel            # run standalone (Ctrl-C stops it)
#   pnpm dev:all           # starts this automatically alongside the API + web
#
# Config comes from the environment, falling back to .env:
#   MYSQL_SSH_HOST / MYSQL_SSH_PORT / MYSQL_SSH_USER / MYSQL_SSH_KEYFILE   (the bastion + key)
#   MYSQL_DB_HOST / MYSQL_DB_PORT                                          (the real RDS endpoint)
#   MYSQL_DB_LOCAL_PORT                                                    (local forward port, 3307)
#
# It is a NO-OP (exit 0) when unconfigured or the key file is missing, so DWH-only and CI runs are
# unaffected. It only forwards a port — it moves/reads no data itself.
set -uo pipefail
cd "$(dirname "$0")/.."

# Read KEY from .env, tolerating "KEY = value" spacing and surrounding quotes.
envval() {
  [ -f .env ] || return 0
  grep -m1 -E "^$1[[:space:]]*=" .env | sed -E "s/^$1[[:space:]]*=[[:space:]]*//; s/^['\"]//; s/['\"][[:space:]]*\$//"
}

SSH_HOST="${MYSQL_SSH_HOST:-$(envval MYSQL_SSH_HOST)}"
SSH_PORT="${MYSQL_SSH_PORT:-$(envval MYSQL_SSH_PORT)}"; SSH_PORT="${SSH_PORT:-22}"
SSH_USER="${MYSQL_SSH_USER:-$(envval MYSQL_SSH_USER)}"
SSH_KEY="${MYSQL_SSH_KEYFILE:-$(envval MYSQL_SSH_KEYFILE)}"
RDS_HOST="${MYSQL_DB_HOST:-$(envval MYSQL_DB_HOST)}"
RDS_PORT="${MYSQL_DB_PORT:-$(envval MYSQL_DB_PORT)}"; RDS_PORT="${RDS_PORT:-3306}"
LOCAL_PORT="${MYSQL_DB_LOCAL_PORT:-$(envval MYSQL_DB_LOCAL_PORT)}"; LOCAL_PORT="${LOCAL_PORT:-3307}"
SSH_KEY="${SSH_KEY/#\~/$HOME}" # expand a leading ~

if [ -z "$SSH_HOST" ] || [ -z "$SSH_USER" ] || [ -z "$RDS_HOST" ]; then
  echo "[tunnel] MYSQL_SSH_* / MYSQL_DB_HOST not configured — skipping CMP tunnel (DWH unaffected)."
  exit 0
fi
if [ -z "$SSH_KEY" ] || [ ! -f "$SSH_KEY" ]; then
  echo "[tunnel] SSH key not found at MYSQL_SSH_KEYFILE='$SSH_KEY'."
  echo "[tunnel] Save your dbtunnel key there (chmod 600), then re-run. Skipping for now."
  exit 0
fi
chmod 600 "$SSH_KEY" 2>/dev/null || true

SSH_PID=""
cleanup() { [ -n "$SSH_PID" ] && kill "$SSH_PID" 2>/dev/null || true; echo "[tunnel] stopped."; exit 0; }
trap cleanup INT TERM

echo "[tunnel] CMP MySQL 127.0.0.1:${LOCAL_PORT} → ${RDS_HOST}:${RDS_PORT} via ${SSH_USER}@${SSH_HOST}:${SSH_PORT} (auto-reconnect)"
while true; do
  if nc -z -w2 127.0.0.1 "$LOCAL_PORT" 2>/dev/null; then
    # Port already served (a manual tunnel or another instance) — just watch, don't double-bind.
    sleep 5
    continue
  fi
  ssh -i "$SSH_KEY" -p "$SSH_PORT" \
    -o StrictHostKeyChecking=accept-new -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
    -N -L "${LOCAL_PORT}:${RDS_HOST}:${RDS_PORT}" "${SSH_USER}@${SSH_HOST}" &
  SSH_PID=$!
  wait "$SSH_PID"
  SSH_PID=""
  echo "[tunnel] connection dropped — reconnecting in 3s…"
  sleep 3
done
