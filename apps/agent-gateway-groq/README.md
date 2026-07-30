# octane-agent-gateway-openai

OpenAI API version of `apps/agent-gateway`, kept in the existing migration folder so the Claude
version remains unchanged. It keeps the Telegram gates, per-carrier chat map, backend RBAC,
support-bot endpoints, local KB search, buttons, reactions, photo handling, and monitoring.

The only model provider is OpenAI. `gpt-5.6-luna` runs text, function calling, and image
transcription through the Responses API. Function tools execute locally and sequentially
(`parallel_tool_calls: false`) through `toolDispatcher`; every call is validated, authorized,
and audit-logged. Provider failures fail closed and are reported to the Telegram user.

The migrated feature surface matches the legacy gateway's 25 tools: identity/role, KB, exact
card/fleet status, funds, transactions and private reports, Money Code quote/draw, card
activate/deactivate/limits/info, invoices, balance/manual-code DM delivery, service requests,
tracking, last-used/payment/billing-form reads, override, photo OCR, progress, buttons, and
reactions. Context-aware routing handles short follow-ups such as a bare last-6 card number.

## Local setup

```bash
cd apps/agent-gateway-groq
cp .env.example .env
# Fill OPENAI_API_KEY, Telegram, and OCTANE_* values.
corepack pnpm install
corepack pnpm typecheck
corepack pnpm test
corepack pnpm stress:concurrency
corepack pnpm dev
```

Or:

```bash
docker compose up --build
```

The local monitor is available at `http://localhost:8787` when running directly, or
`http://localhost:8788` through Docker Compose. Set `MONITOR_TOKEN` outside local development.

Never run the Claude and OpenAI gateways at the same time with the same Telegram bot token:
Telegram long polling permits only one consumer. Use a separate test-bot token for side-by-side
comparison.

## Required production environment

- `OPENAI_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BOT_USERNAME`
- `OCTANE_API_BASE`
- `OCTANE_INTERNAL_API_KEY`
- Either the backend chat map or the `OCTANE_GROUP_CHAT_ID` / `OCTANE_CARRIER_ID` fallback

Useful defaults are documented in `.env.example`.

## Burst handling

The gateway is bounded by default for multi-company bursts:

- Up to 32 Telegram updates are preprocessed concurrently.
- OpenAI/tool work is capped at 8 active turns globally.
- Turns stay ordered per `(chatId, userId)` while different users in one group run in parallel.
- The queue accepts up to 2,000 turns globally and 5 per user before returning a capacity nudge.
- Access-list and chat-map refreshes are single-flight to avoid backend request stampedes.
- Session, message, and turn logs are buffered instead of synchronously writing on the hot path.
- Telegram replies are globally throttled and separately spaced per group; typing is best-effort
  and shared by all active turns in one chat.

Tune the values with the account's OpenAI limits and `/api/metrics`, not by adding API keys.
`pnpm stress:concurrency` is network-blocked by design and validates concurrency caps, per-user
ordering, queue cleanup, event-loop lag, and memory growth.

## Render

This folder can run as a Render Web Service using its Dockerfile:

1. Set the service root directory to `apps/agent-gateway-groq`.
2. Choose the Docker runtime and add the required environment variables above.
3. Mount a persistent disk at `/app/data` if chat history and monitor logs must survive deploys.
4. Keep only one production gateway polling the Telegram bot token.

Render provides `PORT`; the monitor/health page binds to it automatically. OpenAI handles
inference remotely, so Render does not need a GPU.

## Migration differences

- Claude OAuth/subscription and `@anthropic-ai/claude-agent-sdk` are removed.
- The standard `openai` package uses the OpenAI Responses API for every model turn.
- Claude resumable sessions become bounded rolling text history in `data/openai-sessions.json`.
  On first start, any existing `data/groq-sessions.json` is copied into the new history file.
- Claude project skills are not loaded at runtime. Their customer-service, communication,
  mini-app, privacy, confirmation, and tool-use behavior is condensed into
  `prompts/octane-openai.md`; factual support content remains grounded through `octane_kb_search`.
- Image transcription is a separate OpenAI vision request, so raw images never enter rolling chat
  history.
