# octane-agent-gateway-openai

OpenAI API version of `apps/agent-gateway`, kept in the existing migration folder so the Claude
version remains unchanged. It keeps the Telegram gates, per-carrier chat map, backend RBAC,
support-bot endpoints, scoped hybrid KB search, buttons, reactions, photo handling, and monitoring.

The only model provider is OpenAI. `gpt-5.6-luna` runs text, function calling, and image
transcription through the Responses API. Function tools execute locally and sequentially
(`parallel_tool_calls: false`) through `toolDispatcher`; every call is validated, authorized,
and audit-logged. Provider failures fail closed and are reported to the Telegram user.

The catalogued feature surface matches the legacy gateway's tools: identity/role, KB, exact
card/fleet status, funds, transactions and private reports, Money Code quote/draw, card
activate/deactivate/limits/info, invoices, balance/manual-code DM delivery, service requests,
tracking, last-used/payment/billing-form reads, override, photo OCR, progress, buttons, and
reactions. Money Code is registered but disabled by default. An OpenAI structured-output router
uses current tool descriptions, service switches, role availability, and recent context to decide
engagement and tool scope without keyword or regex intent tables.

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

In mapped support groups, every registered owner or driver message reaches the semantic router and
receives a response without requiring a bot tag. It understands multilingual requests, slang,
unseen wording, fragments, and ordinary conversation from context. In-scope Octane requests use
live tools; commercial/product questions resolve the assigned Sales agent; unresolved operational
questions offer a confirmed Customer Service ticket. Unregistered users never consume router
tokens; only an explicit mention/reply may receive the rate-limited registration signpost.

Telegram update preprocessing preserves source order per `(chatId, userId)` even when role lookups
have different latency. Different users and companies still preprocess concurrently.

Natural Telegram message bursts are combined per chat/user after 3 seconds of typing silence, with
a 120-second hard cap (`TELEGRAM_BURST_QUIET_MS`, `TELEGRAM_BURST_MAX_MS`). A five-minute,
12-message per-user context window lets the AI join real fragments such as a name/unit followed by
the requested action. When a request is admitted, that pending context is cleared so a new problem
does not inherit an unanswered question. Different clients remain independent.

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

## Dynamic service switches

Every gateway capability belongs to the central registry in `src/serviceRegistry.ts`. The registry
controls three layers together:

- Disabled tools are removed before model tool definitions are built.
- `toolDispatcher` refuses a disabled tool even if a stale/model-generated call reaches it.
- Router-selected disabled services get a language-matched unavailable response without a second
  answer-model call.

Override safe catalog defaults with a comma-separated environment value:

```env
AGENT_SERVICE_FLAGS=money_code=off,billing=on,tracking=off,memory=on
```

Available switches are `identity`, `knowledge`, `cards`, `funds`, `transactions`, `money_code`,
`billing`, `service_requests`, `tracking`, `vision`, and `memory`. `memory=on` also requires
backend `FF_SUPPORT_BOT_MEMORY=1` and migration `0078_support_bot_memories`; recalled turns are
strictly scoped by tenant + carrier + chat + Telegram user and injected as untrusted context.
Memory commits never delay Telegram replies and are bounded by `MEMORY_COMMIT_CONCURRENCY` /
`MEMORY_COMMIT_QUEUE_MAX` for burst safety.
`core` Telegram confirmation/progress UX cannot be disabled. Environment changes restart the
process on Render; no code change is needed. New capabilities register their tool descriptions and
safe default in the service catalog and add a role-aware Markdown skill. The AI sees that live
metadata automatically; no keyword route is added. Unknown `octane_*` and `telegram_*` tools fail
closed.

## Support knowledge base

`octane_kb_search` uses the backend's dedicated `support_bot_knowledge_articles` table. Retrieval
combines pgvector semantic similarity with PostgreSQL full-text search, then filters every leg by
authenticated tenant, exact carrier overlay (plus tenant-global articles), published/valid dates,
and enabled service IDs. Per-user memory and generic Mytrion knowledge use different tables.

Apply backend migration `0079_support_bot_knowledge.sql`, then run from the repository root:

```bash
corepack pnpm seed:support-kb
corepack pnpm smoke:support-kb
```

The seed is idempotent. Money Code articles are excluded by default; a deliberate
`SUPPORT_KB_INCLUDE_MONEY_CODE=1` is required to publish them. Volatile April-2026 station,
discount, fee, limit, and delivery facts are seeded with an expiry and therefore remain hidden
until re-verified. If the new backend endpoint is unavailable during rollout, the bundled corpus
is a bounded fallback and is still filtered by service flags.

## Role-aware skill runtime

The gateway resolves the sender's role from the backend access list before starting an OpenAI
turn. The existing per-carrier single-flight cache carries both registration and role, so role
filtering adds no second backend request during bursts. `manager` is normalized to owner-equivalent;
missing or unknown profiles fail closed and never enter a model turn.

Every gateway tool belongs to exactly one entry in `src/skillRegistry.ts` and one Markdown
instruction pack under `skills/*/SKILL.md`. The registry controls:

- which roles may see each tool;
- which skill instructions enter the turn prompt;
- server-side denial when a selected tool is outside the verified role;
- a second role check inside `toolDispatcher`, before tool execution.

The backend still resolves registration and carrier scope on every business tool call, so the
gateway filter improves UX and token efficiency without replacing server-side RBAC. Memory and
user text can never grant a role.

## Burst handling

The gateway is bounded by default for multi-company bursts:

- Up to 32 Telegram updates are preprocessed concurrently.
- Semantic router calls are independently capped at 16 (`OPENAI_ROUTER_MAX_CONCURRENT`).
- OpenAI/tool work is capped at 8 active turns globally.
- Turns stay ordered per `(chatId, userId)` while different users in one group run in parallel.
- The queue accepts up to 2,000 turns globally and 5 per user before returning a capacity nudge.
- Access-list and chat-map refreshes are single-flight to avoid backend request stampedes.
- The access-list cache carries roles, so role-aware tool filtering does not add a per-turn
  `/whoami` lookup.
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
- Claude project skills are not loaded at runtime. The OpenAI gateway has its own strict skill
registry and Markdown packs; shared base behavior remains in `prompts/octane-openai.md`.
- Image transcription is a separate OpenAI vision request, so raw images never enter rolling chat
  history.

## Skills and knowledge

The legacy Claude gateway keeps its source skills under
`apps/agent-gateway/.claude/skills/*/SKILL.md`; the OpenAI gateway does not execute those Claude
SDK skill files. It loads its own role-aware Markdown packs from `skills/*/SKILL.md` through
`src/skillRegistry.ts`. Shared policy remains in `prompts/octane-openai.md`. The verified bundled
corpus in `src/kb/corpus.ts` is the migration/outage fallback; normal retrieval goes through the
DB-backed hybrid client in `src/kb/search.ts`.
Keep factual answers grounded through tools or the KB instead of copying live business data into
a prompt or skill file.
