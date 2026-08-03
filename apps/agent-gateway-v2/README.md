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
cd apps/agent-gateway-v2
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

In production, mapped groups default to `TELEGRAM_ENGAGEMENT_MODE=direct`: a registered owner or
driver starts a support thread by mentioning or replying to the bot, then gets natural follow-ups
for ten minutes. This prevents ambient chatter across hundreds of groups from consuming model
capacity. `all_registered` preserves the original ambient behavior when deliberately configured.
In-scope requests use live tools; unresolved operational questions can create a server-bound,
confirmed Customer Service ticket. Unregistered users never consume router tokens; only an
explicit mention/reply may receive the rate-limited registration signpost.

Telegram update preprocessing preserves source order per `(chatId, userId)` even when role lookups
have different latency. Different users and companies still preprocess concurrently.

Natural Telegram message bursts are combined per chat/user after 3 seconds of typing silence, with
a 120-second hard cap (`TELEGRAM_BURST_QUIET_MS`, `TELEGRAM_BURST_MAX_MS`). A five-minute,
12-message per-user context window lets the AI join real fragments such as a name/unit followed by
the requested action. When a request is admitted, that pending context is cleared so a new problem
does not inherit an unanswered question. Different clients remain independent.

Never run the legacy Claude and this OpenAI gateway with the same Telegram bot token. Replicas of
this gateway may share one token only with `GATEWAY_LEASE_ENABLED=1`; the DB lease keeps exactly one
poller active and the others warm. Use a separate test-bot token for side-by-side implementations.

## Required production environment

- `OPENAI_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BOT_USERNAME`
- `OCTANE_API_BASE`
- `OCTANE_SUPPORT_BOT_API_KEY`
- `MONITOR_TOKEN` (at least 32 characters)
- `GATEWAY_LEASE_ENABLED=1`
- A backend chat map (legacy single-group environment fallback is development-only)

The backend must use the same dedicated `SUPPORT_BOT_GATEWAY_API_KEY`, enable
`FF_SUPPORT_BOT_IDEMPOTENCY=1`, and apply migration `0083_support_bot_production_safety.sql` before
the gateway starts. Production writes fail closed unless they carry a consumed server confirmation,
stable idempotency metadata, and the current session fence.

An unmapped Telegram group is bound only after an active registered company owner or manager
mentions the bot and confirms the server-resolved company with the `Yes` button. Previewing or
pressing `No` never writes a chat mapping. Disable a stale mapping with
`DELETE /v1/support-bot/chat-map/:chatId` using admin or gateway-service auth; the action is
tenant-scoped and audit-logged. The backend enforces the 800-enabled-group cap while holding a
transaction-scoped advisory lock, so concurrent onboarding cannot exceed the limit.

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
until re-verified. Client-communicable material from the June 2026 Customer Support Operations
Manual is curated into the same seed and bundled fallback; internal credentials, contacts, ticket
codes, and exception criteria are never published. If the backend endpoint is unavailable during
rollout, the bundled corpus is a bounded fallback and is still filtered by service flags.

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
- Production drops ambient chatter before the router; mentions/replies and active follow-ups pass.
- Every authenticated request is admitted before the semantic router. The full request
  lifecycle is capped globally, per user, and per carrier.
- Semantic router calls are independently capped at 16 (`OPENAI_ROUTER_MAX_CONCURRENT`), with
  a hard 200-item router queue guard (`OPENAI_ROUTER_QUEUE_MAX`).
- OpenAI/tool work is capped at 8 active turns globally.
- Turns stay ordered per `(chatId, userId)` while different users in one group run in parallel.
- The admitted-request cap covers router wait, model wait, and active execution, so the
  downstream model queue cannot grow beyond the same bound.
- Requests that cannot start within 45 seconds (`MAX_REQUEST_QUEUE_WAIT_MS`) are discarded as
  stale without calling OpenAI and receive the static high-demand reply.
- Router, main-model, and vision calls share configurable RPM/TPM token buckets. OpenAI 429
  responses honor `Retry-After`; 3 consecutive 429s open a 30-second circuit breaker. Set
  `OPENAI_RPM_LIMIT` and `OPENAI_TPM_LIMIT` to the production OpenAI project's real limits.
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

1. Set the service root directory to `apps/agent-gateway-v2`.
2. Choose the Docker runtime and add the required environment variables above.
3. Mount a persistent disk at `/app/data` if chat history and monitor logs must survive deploys.
4. One replica is enough initially. Multiple replicas are supported as warm standbys when all use
   the DB-backed gateway lease; never mix this service with another poller implementation.

Render provides `PORT`; the monitor/health page binds to it automatically. OpenAI handles
inference remotely, so Render does not need a GPU.

Set the backend's `SUPPORT_BOT_GATEWAY_MONITOR_URL` to this Render service URL and
`SUPPORT_BOT_GATEWAY_MONITOR_TOKEN` to the same value as this service's `MONITOR_TOKEN`. The
backend authenticates the admin first and injects that token server-side; browsers never need it.

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
