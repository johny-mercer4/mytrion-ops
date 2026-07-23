#!/bin/sh
# Render single-service start: mytrion API + (optionally) the support-bot gateway.
#
# The bot starts ONLY when its two hard requirements are present
# (TELEGRAM_CARRIER_BOT_TOKEN + CLAUDE_CODE_OAUTH_TOKEN), so a deploy without
# bot env still serves the API / widget / mini-app exactly as before.
#
# Per-process env remap (one env group, two processes):
#   TELEGRAM_BOT_TOKEN      <- TELEGRAM_CARRIER_BOT_TOKEN   (the 8800... ops bot stays the backend's)
#   OCTANE_API_BASE         <- localhost:$PORT               (same box — no public round-trip)
#   OCTANE_INTERNAL_API_KEY <- API_KEY                       (supportBot routes use sessionOrApiKey)
#   HOME                    <- /app/data/claude-home         (SDK session store on the persistent disk)
#
# The gateway writes sessions/messages under its cwd ./data — symlinked onto the
# persistent disk so a redeploy never amnesias group conversations.
set -u
node dist/server.js &
BACKEND_PID=$!

if [ -n "${TELEGRAM_CARRIER_BOT_TOKEN:-}" ] && [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  mkdir -p /app/data/claude-home /app/data/gateway
  rm -rf /app/apps/agent-gateway/data 2>/dev/null || true
  ln -sfn /app/data/gateway /app/apps/agent-gateway/data
  cd /app/apps/agent-gateway
  TELEGRAM_BOT_TOKEN="$TELEGRAM_CARRIER_BOT_TOKEN" \
  TELEGRAM_BOT_USERNAME="${TELEGRAM_CARRIER_BOT_USERNAME:-octane_support_ai_bot}" \
  OCTANE_API_BASE="http://localhost:${PORT:-3001}" \
  OCTANE_INTERNAL_API_KEY="${API_KEY:-}" \
  OCTANE_MINIAPP_LINK="${TELEGRAM_CARRIER_MINI_APP_URL:-}" \
  GATEWAY_MODEL="${GATEWAY_MODEL:-claude-sonnet-4-5}" \
  HOME=/app/data/claude-home \
  pnpm start &
  echo "[start-prod] gateway launched"
else
  echo "[start-prod] gateway env absent — API only"
fi

wait $BACKEND_PID
