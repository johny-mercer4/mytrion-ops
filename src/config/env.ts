import 'dotenv/config';
import { z } from 'zod';

/** Parse a '0'/'1'/'true'/'false' style flag into a boolean, with a default. */
const flag = (def: '0' | '1') =>
  z
    .string()
    .default(def)
    .transform((v) => v === '1' || v.toLowerCase() === 'true');

const EnvSchema = z.object({
  // --- Server ---
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  // Wildcard-by-suffix origins (comma-separated hostnames). Zoho serves each widget from a
  // per-instance subdomain of zappsusercontent.com, so we allow that whole suffix.
  CORS_ORIGIN_SUFFIXES: z.string().default('zappsusercontent.com'),

  // --- Database: Mytrion OPS external Postgres (sessions, logging, knowledge) ---
  // No local DB — always the external URL. `DATABASE_URL` is kept only as a legacy alias.
  // No localhost default on purpose: a missing value should fail loudly, not silently
  // connect to localhost (see assertRuntimeSecrets).
  MYTRION_OPS_DATABASE_URL: z.string().default(''),
  DATABASE_URL: z.string().default(''),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  // --- Data Warehouse (separate read Postgres; tool + metadata target) ---
  DWH_DATABASE_URL: z.string().default(''),

  // --- Verification DB (credit_platform — read-only metadata/reference target for the Sales
  // Mytrion verification pipeline; surfaced in Mytrion Admin like the DWH). Render Postgres → SSL. ---
  VERIFICATION_DATABASE_URL: z.string().default(''),

  // --- AWS MySQL (external RDS/Aurora MySQL; tool target, mirrors the DWH wrapper) ---
  // Two ways to point at it (discrete fields win when AWS_MYSQL_HOST is set):
  //  1. Discrete (preferred — password passed RAW, no URL-encoding footgun):
  //     AWS_MYSQL_HOST / _PORT / _USER / _PASSWORD / _DATABASE. Through an SSH tunnel, HOST is
  //     127.0.0.1 and PORT is the local forward (e.g. 3307).
  //  2. URI: mysql://user:pass@host:3306/db — but special chars in the password MUST be
  //     percent-encoded or mysql2 throws "URI malformed".
  // For IAM database auth, mint a short-lived token with @aws-sdk/rds-signer and use it as the
  // password (not wired — add when needed).
  AWS_MYSQL_DATABASE_URL: z.string().default(''),
  AWS_MYSQL_HOST: z.string().default(''),
  AWS_MYSQL_PORT: z.coerce.number().int().positive().default(3306),
  AWS_MYSQL_USER: z.string().default(''),
  AWS_MYSQL_PASSWORD: z.string().default(''),
  AWS_MYSQL_DATABASE: z.string().default(''),
  // AWS RDS/Aurora terminate TLS with publicly-trusted certs (in Node's store) — verify by default.
  // Set to '0' for a plaintext / non-RDS target (matches the DWH's ssl:false).
  AWS_MYSQL_SSL: flag('1'),
  // Read-only is the default (repo rule 7). Enforced per-connection via SET SESSION TRANSACTION
  // READ ONLY; set to '0' to allow writes. A read-only DB user is the real guarantee — this is defence in depth.
  AWS_MYSQL_READONLY: flag('1'),

  // --- CMP MySQL SSH tunnel (local dev only — mirrors scripts/db-tunnel.sh) ---
  // When AWS_MYSQL_HOST is 127.0.0.1 / localhost, ensureCmpTunnel() opens the forward on demand.
  MYSQL_SSH_HOST: z.string().default(''),
  MYSQL_SSH_PORT: z.coerce.number().int().positive().default(22),
  MYSQL_SSH_USER: z.string().default(''),
  MYSQL_SSH_KEYFILE: z.string().default(''),
  MYSQL_DB_HOST: z.string().default(''),
  MYSQL_DB_PORT: z.coerce.number().int().positive().default(3306),
  MYSQL_DB_LOCAL_PORT: z.coerce.number().int().positive().default(3307),

  // --- OpenAI ---
  OPENAI_API_KEY: z.string().default(''),
  // Model IDs by role: FOUR_O_MINI = default chat, FIVE_O_MINI = reasoning/hard tasks,
  // EMBEDDING_SMALL = embeddings. Wired in modules/llm/openaiClient.ts (`models`).
  OPEN_AI_FOUR_O_MINI: z.string().default('gpt-4o-mini-2024-07-18'),
  OPEN_AI_FIVE_O_MINI: z.string().default('gpt-5.4-mini-2026-03-17'),
  OPEN_AI_EMBEDDING_SMALL: z.string().default('text-embedding-3-small'),
  // Client-level deadline for every raw OpenAI/Groq SDK call (chat, RAG planner/judge,
  // rerank, memory, web search, embeddings). A hung provider call must never hang a turn.
  OPENAI_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  // Output cap for the chat pipeline's main completions (max_tokens / max_completion_tokens).
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(4096),
  // Embedding batch cap: embeddings.create is called with at most this many inputs per request.
  EMBED_BATCH_SIZE: z.coerce.number().int().positive().max(2048).default(128),

  // --- Groq (fast/cheap worker via the OpenAI-compatible API). Off unless FF_GROQ_ENABLED. ---
  GROQ_API_KEY: z.string().default(''),
  GROQ_BASE_URL: z.string().default('https://api.groq.com/openai/v1'),
  // Worker model for tool-calling/simple turns. gpt-oss (NOT Llama — deprecated on Groq).
  GROQ_MODEL_WORKER: z.string().default('openai/gpt-oss-120b'),

  // --- DeepAgents (LangChain/LangGraph orchestrator + RAG / web-search / tool-caller subagents). ---
  // Off by default (FF_DEEP_AGENTS_ENABLED). Reuses OPENAI_API_KEY; no new provider.
  // Empty DEEP_AGENTS_MODEL falls back to OPEN_AI_FOUR_O_MINI. The web-search subagent calls the
  // OpenAI Responses `web_search` built-in tool with DEEP_WEB_SEARCH_MODEL (must be a web-search-capable
  // model alias, e.g. gpt-4o-mini / gpt-4o; dated snapshots may not support it).
  DEEP_AGENTS_MODEL: z.string().default(''),
  DEEP_WEB_SEARCH_MODEL: z.string().default('gpt-4o-mini'),
  // --- Multi-agent core (orchestrator + department child agents) ---
  // Orchestrator model ('' → DEEP_AGENTS_MODEL → default chat model) and default child model.
  ORCHESTRATOR_MODEL: z.string().default(''),
  AGENT_CHILD_MODEL: z.string().default(''),
  // Child tool-call rounds (converted to a LangGraph recursionLimit with headroom in
  // orchestratorService — each round is several graph super-steps). Manifest may override.
  AGENT_MAX_CHILD_ITERATIONS: z.coerce.number().int().positive().max(50).default(8),
  // Tool output cap inside agent runs (chars) — keeps one chatty tool from flooding a context.
  AGENT_TOOL_OUTPUT_MAX_CHARS: z.coerce.number().int().positive().default(8000),
  // Per-run budget guards (BudgetMeter): tool calls, LLM dollars, wall-clock.
  AGENT_MAX_TOOL_CALLS: z.coerce.number().int().positive().default(20),
  AGENT_MAX_COST_USD: z.coerce.number().positive().default(0.5),
  AGENT_MAX_WALL_MS: z.coerce.number().int().positive().default(120_000),
  // Per-call deadline for agent-path ChatOpenAI requests (ms). Distinct from the wall-clock
  // budget: this bounds ONE model call, the budget bounds the whole run.
  AGENT_MODEL_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
  // Output cap for agent-path model calls (maxTokens / maxCompletionTokens on ChatOpenAI).
  AGENT_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(4096),
  // Deadline for outbound integration HTTP calls (serverCrm, Zoho) via fetchWithTimeout.
  OUTBOUND_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  // Suite-level spend cap for scripts/evalLive.ts (agent turns + judge calls, USD).
  EVAL_MAX_COST_USD: z.coerce.number().positive().default(2),
  // Checkpointed threads idle longer than this are swept by a background job.
  AGENT_CHECKPOINT_TTL_DAYS: z.coerce.number().int().positive().default(30),
  // Long-term agent memory (FF_AGENT_MEMORY): decay half-life + per-(agent,dept) row cap.
  AGENT_MEMORY_HALFLIFE_DAYS: z.coerce.number().int().positive().default(30),
  AGENT_MEMORY_MAX_PER_KEY: z.coerce.number().int().positive().default(500),
  // --- Agentic RAG ---
  // Planner/judge model for query decomposition + sufficiency ('' → default chat model).
  RAG_PLANNER_MODEL: z.string().default(''),
  RAG_MAX_HOPS: z.coerce.number().int().min(1).max(4).default(2),
  RAG_MULTIQUERY_MAX: z.coerce.number().int().min(1).max(5).default(3),
  RAG_RRF_K: z.coerce.number().int().positive().default(60),
  RAG_CANDIDATES_PER_LEG: z.coerce.number().int().min(5).max(100).default(30),
  // Short-circuit the sufficiency judge when the top fused score is at least this
  // (0.032 ≈ rank-1 in both legs for a single query at RRF_K=60).
  RAG_SUFFICIENT_SCORE: z.coerce.number().positive().default(0.032),
  // Docs unverified for longer than this are demoted in retrieval and flagged in citations.
  STALE_DOC_DAYS: z.coerce.number().int().positive().default(180),
  // Optional LangSmith tracing passthrough (traces contain message content — staging only).
  LANGSMITH_TRACING: z.string().default(''),
  LANGSMITH_API_KEY: z.string().default(''),

  // --- Composio (external tool-calling gateway for the DeepAgents external-tools subagent). ---
  // Off unless FF_COMPOSIO_ENABLED. Shared-org-account model: one fixed Composio user owns the
  // connected accounts (connect Zoho once → all callers use it). Toolkits are managed-auth slugs
  // (ZOHO = CRM, ZOHO_DESK). Execution is remote on Composio; we wrap each call with an audit log
  // and gate the subagent to admins (external tools include writes/deletes).
  COMPOSIO_API_KEY: z.string().default('COMPOSIO_KEY'),
  COMPOSIO_ORG_USER_ID: z.string().default('octane-org'),
  COMPOSIO_TOOLKITS: z.string().default('ZOHO,ZOHO_DESK'),
  COMPOSIO_TOOL_LIMIT: z.coerce.number().int().positive().max(200).default(50),

  // --- Telegram (native Bot API integration; auth = bot token, no OAuth/Composio needed). ---
  // Off unless FF_TELEGRAM_ENABLED. Exposed as native tools: reads (get_me/updates/chat) are
  // read-risk; sends (message/photo/document) are write-risk (admin-gated by the dispatcher).
  TELEGRAM_BOT_TOKEN: z.string().default(''),
  // Default ("main") chat the send tools target when no chatId is passed — lets the assistant DM the
  // primary user directly. Callers can still override per-call with an explicit chatId.
  TELEGRAM_CHAT_ID_MAIN: z.string().default(''),

  // --- Carrier onboarding bot (separate from the assistant's own Telegram integration above) ---
  // Deep-linked from the carrier invite flow: https://t.me/<username>?start=<inviteId>. The bot
  // itself (webhook + mini-app) is future work; today we only need the username to build the link.
  TELEGRAM_CARRIER_BOT_USERNAME: z.string().default(''),
  TELEGRAM_CARRIER_BOT_TOKEN: z.string().default(''),
  // Public HTTPS URL of apps/mini-app once deployed — the inline web_app button's target (`/start`
  // fallback path only).
  TELEGRAM_CARRIER_MINI_APP_URL: z.string().default(''),
  // BotFather-registered named Mini App short name (Bot Settings -> Configure Mini App). Set →
  // links use https://t.me/<bot>/<shortname>?startapp=<id>.
  TELEGRAM_CARRIER_MINI_APP_SHORT_NAME: z.string().default(''),
  // '1' when the bot's MAIN App is configured in BotFather (Edit Bot -> Configure Mini App -> Main
  // App URL = <origin>/mini-app/). Then links use https://t.me/<bot>?startapp=<id> (no short name)
  // and open the mini-app directly. Off → ?start= fallback (needs a bot /start reply, not built).
  TELEGRAM_CARRIER_MINI_APP_DIRECT: z.string().default(''),

  // '1' → apply pending Drizzle migrations at boot (see db/migrate.ts). Set in the Render env group
  // so a deploy migrates the DB itself; off by default so tests/local/tooling never auto-migrate.
  DB_MIGRATE_ON_BOOT: z.string().default(''),

  // --- Zoho MCP (hosted; "Authorize via Connection" → headless, URL embeds the credential). ---
  ZOHO_MCP_URL: z.string().default(''),

  // --- dbt MCP (hosted Streamable-HTTP MCP → dbt warehouse). Server-to-server via OAuth
  // `client_credentials` (no browser). DBT_MCP_URL is the JSON-RPC endpoint (e.g. …/mcp);
  // DBT_MCP_TOKEN_URL defaults to `${origin}/token` when blank. Creds are secrets → env only. ---
  DBT_MCP_URL: z.string().default(''),
  DBT_MCP_TOKEN_URL: z.string().default(''),
  DBT_MCP_CLIENT_ID: z.string().default(''),
  DBT_MCP_CLIENT_SECRET: z.string().default(''),

  // --- Live analytics (DWH-backed dashboard + analytics.snapshot tool) ---
  // Snapshot cache TTL. Snapshots self-expire after this long and the warmer recomputes them,
  // so the dashboard always serves from cache (fast) while data refreshes automatically.
  ANALYTICS_CACHE_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(120),

  // --- Department RBAC: EXACT profile/role names that grant UNLIMITED access (all depts + all tools). ---
  // Case-insensitive full-string equality after trim (see lib/department.ts) — NOT substring:
  // a 'manager' substring also matched "Sales Manager"/"Account Manager" and silently made
  // sales staff admins. 'ceo' matches the Zoho ROLE the frontend also treats as admin
  // (ADMIN_ROLES in mytrions.config.ts) — the two admin predicates must stay aligned or CEO
  // sessions get 'worker' role backend-side and 403 on admin-only routes. Names containing a
  // comma cannot be expressed (none exist in our Zoho org).
  ADMIN_PROFILE_MARKERS: z.string().default('administrator,ceo'),
  // Per-user overrides matched on the caller's `user_name` (case-insensitive). Accepts CSV or a
  // bracketed list, e.g. ADMIN_USERS=[alice,bob] or ADMIN_USERS=alice,bob.
  //   ADMIN_USERS  → granted all-department access (see everything, like an admin marker).
  //   BYPASS_USERS → hard RBAC bypass (skips audience/scope/write/department gates entirely).
  ADMIN_USERS: z.string().default(''),
  BYPASS_USERS: z.string().default(''),
  // "Act as agent" picker: which Zoho CRM profile / role names count as sales agents (CSV,
  // case-insensitive SUBSTRING match, so "Sales Agent" also matches region roles like
  // "Uzbekistan Sales Agent"). GET /v1/admin/agents?all=1 bypasses this filter (admin-only).
  SALES_AGENT_PROFILE_NAMES: z.string().default('Sales Agent'),
  // CS Mytrion manager tier (leaderboard, org-wide analytics, roster). Case-insensitive
  // SUBSTRING match against the caller's Zoho profile AND role — replaces the old widget's
  // hardcoded name allowlist ("Customer Service Manager" roles match via 'manager').
  CS_MANAGER_ROLE_MARKERS: z.string().default('manager,director,administrator'),
  SALES_AGENT_ROLE_NAMES: z.string().default('Sales Agent'),
  // TTL for the cached CRM users directory that VERIFIES act-as targets server-side
  // (x-act-as-* identity headers are never trusted; see actAsDirectory.ts).
  ACT_AS_DIRECTORY_TTL_MS: z.coerce.number().int().positive().default(300_000),

  // --- Auth ---
  JWT_SECRET: z.string().default(''),
  // Access token is short-lived; the SPA refreshes it transparently on 401 (never a re-login).
  JWT_ACCESS_TTL: z.string().default('1h'),
  // Refresh token = how long a signed-in worker stays logged in WITHOUT re-authenticating. It
  // rotates on every refresh, so any use within this window slides it forward — a worker who opens
  // the app at least once every 90 days effectively never has to sign in again.
  JWT_REFRESH_TTL: z.string().default('90d'),
  PASSWORD_PEPPER: z.string().default(''),

  // --- Encryption (vendor credentials at rest) ---
  ENCRYPTION_KEY: z.string().default(''),

  // --- Zoho: shared OAuth app (one self-client app across CRM/Desk/People/Projects) ---
  ZOHO_ACCOUNTS_DOMAIN: z.string().default('https://accounts.zoho.com'),
  ZOHO_CLIENT_ID: z.string().default(''),
  ZOHO_CLIENT_SECRET: z.string().default(''),
  // Optional shared refresh token; used as a fallback when a service-specific one is unset.
  ZOHO_REFRESH_TOKEN: z.string().default(''),

  // --- Zoho OAuth login (WORKER sign-in — authorization-code flow). A SEPARATE "server" app
  // whose redirect URI is registered in the Zoho console (must exactly match ZOHO_OAUTH_REDIRECT_URI).
  ZOHO_SERVER_CLIENT_ID: z.string().default(''),
  ZOHO_SERVER_CLIENT_SECRET: z.string().default(''),
  // Where Zoho sends the browser back with ?code&state — the SPA relays it to /v1/auth/zoho/callback.
  // MUST byte-match a redirect URI registered on the Zoho server app (local dev: the Vite origin).
  ZOHO_OAUTH_REDIRECT_URI: z.string().default('http://localhost:5173'),
  // Scope for reading the signed-in worker's CRM user (id, name, email, profile, role → RBAC).
  ZOHO_OAUTH_SCOPES: z.string().default('ZohoCRM.users.READ'),

  // The *_API_DOMAIN / *_BASE_URL values are the FULL versioned API roots; callers append
  // only the resource path (e.g. `${ZOHO_CRM_API_DOMAIN}/settings/modules`).

  // --- Zoho CRM ---
  ZOHO_CRM_CLIENT_ID: z.string().default(''),
  ZOHO_CRM_CLIENT_SECRET: z.string().default(''),
  ZOHO_CRM_REFRESH_TOKEN: z.string().default(''),
  ZOHO_CRM_API_DOMAIN: z.string().default('https://www.zohoapis.com/crm/v8'),
  // Zoho custom-function (Deluge) execution root. Blank = derived from the ORIGIN of
  // ZOHO_CRM_API_DOMAIN + '/crm/v2/functions' — the functions API is v2, not v8.
  ZOHO_FUNCTIONS_BASE_URL: z.string().default(''),
  // Which org the Deluge executor targets. PRODUCTION by default; flip to 'sandbox' (plus
  // the two vars below) to point every executeZohoFunction call at the CRM sandbox with
  // zero code change.
  ZOHO_FUNCTIONS_ENV: z.enum(['production', 'sandbox']).default('production'),
  ZOHO_FUNCTIONS_SANDBOX_BASE_URL: z.string().default('https://sandbox.zohoapis.com/crm/v2/functions'),
  // Refresh token minted against the SANDBOX org (falls back to the prod CRM token).
  ZOHO_CRM_SANDBOX_REFRESH_TOKEN: z.string().default(''),

  // --- Zoho Desk ---
  ZOHO_DESK_REFRESH_TOKEN: z.string().default(''),
  ZOHO_DESK_BASE_URL: z.string().default('https://desk.zoho.com/api/v1'),
  ZOHO_DESK_ORG_ID: z.string().default(''),
  // The Desk agent the app posts comments as (the shared "Sales Agent Rep" account tied to the
  // Desk token). Ticket comments with this commenterId are the caller's own → rendered as "me"
  // (right-aligned), matching the reference dashboard's zohoDeskAdminId.
  ZOHO_DESK_AGENT_ID: z.string().default('1057080000010543217'),

  // --- Zoho People ---
  ZOHO_PEOPLE_REFRESH_TOKEN: z.string().default(''),
  ZOHO_PEOPLE_BASE_URL: z.string().default('https://people.zoho.com/api'),

  // --- Zoho Projects ---
  ZOHO_PROJECTS_REFRESH_TOKEN: z.string().default(''),
  ZOHO_PROJECTS_BASE_URL: z.string().default('https://projectsapi.zoho.com/api/v3'),

  // --- RingCentral (Sales Mytrion Embeddable softphone) ---
  // Default path = per-agent OAuth sign-in in the widget (only CLIENT_ID is required). The shared
  // CLIENT_SECRET + org JWT are the auto-login shortcut, embedded only when BROWSER_CREDS_ACK=1.
  RINGCENTRAL_CLIENT_ID: z.string().default(''),
  RINGCENTRAL_CLIENT_SECRET: z.string().default(''),
  RINGCENTRAL_JWT: z.string().default(''),
  RINGCENTRAL_SERVER_URL: z.string().default('https://platform.ringcentral.com'),
  // Embeddable-hosted OAuth callback — register the SAME value in the RingCentral app → Auth.
  RINGCENTRAL_REDIRECT_URI: z
    .string()
    .default(
      'https://apps.ringcentral.com/integration/ringcentral-embeddable/latest/redirect.html',
    ),
  // Gates GET /v1/ringcentral/embed-config + the Sales softphone bootstrap.
  FF_RINGCENTRAL_ENABLED: flag('0'),
  // Explicit ops acknowledgment that the shared client secret + org JWT are handed to every
  // sales browser via the adapter URL (the Phase-1 shared-extension shortcut). OFF by default:
  // the adapter loads without credentials (agents see RingCentral's own login instead of JWT
  // auto-login). Set to 1 only as a deliberate decision; every fetch is then audited.
  RINGCENTRAL_BROWSER_CREDS_ACK: flag('0'),

  // --- Vendor: Octane internal API ---
  OCTANE_INTERNAL_API_URL: z.string().default(''),
  OCTANE_INTERNAL_API_KEY: z.string().default(''),

  // --- CMP (our custom Node server; login/password auth, prod + sandbox) ---
  // Which CMP environment the wrapper authenticates against by default.
  CMP_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  CMP_PRODUCTION_URL: z.string().default(''),
  CMP_PRODUCTION_LOGIN: z.string().default(''),
  CMP_PRODUCTION_PASSWORD: z.string().default(''),
  CMP_SANDBOX_URL: z.string().default(''),
  CMP_SANDBOX_LOGIN: z.string().default(''),
  CMP_SANDBOX_PASSWORD: z.string().default(''),

  // --- EFS (CardManagement SOAP/WSDL) ---
  EFS_WSDL_URL: z.string().default(''),
  // CarrierGroupWS WSDL (child-token auth). Derived from EFS_WSDL_URL when blank.
  EFS_GROUP_WSDL_URL: z.string().default(''),
  EFS_LOGIN: z.string().default(''),
  EFS_PASSWORD: z.string().default(''),
  EFS_PARENT: z.string().default('PARENT'),

  // --- Server CRM (outbound integration) ---
  SERVER_CRM_URL: z.string().default(''),
  SERVER_CRM_KEY: z.string().default(''),

  // --- Browser automation microservice (BOCA / Close Application — Playwright) ---
  // Same host the Zoho self-service widget hits via BROWSER_AUTOMATION_BASE_URL.
  BROWSER_AUTOMATION_URL: z.string().default(''),
  BROWSER_AUTOMATION_KEY: z.string().default(''),
  // These runs drive a real browser; 30s outbound default is too short.
  BROWSER_AUTOMATION_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),

  // --- Zapier catch-hook (card replacement / account reactivation email tickets) ---
  // Widget hardcodes hooks.zapier.com/hooks/catch/21602064/433y0ax/ — set the same URL here.
  ZAPIER_TICKET_WEBHOOK_URL: z.string().default(''),

  // --- Inbound server API key (callers present this to reach this engine) ---
  API_KEY: z.string().default(''),

  // --- Billing payment-ingest webhook (Zapier → payment_transactions). A dedicated shared
  //     secret, scoped to just the ingest endpoint (NOT the full API_KEY). ---
  BILLING_INGEST_SECRET: z.string().default(''),

  // --- Inbox-message webhook (Zoho CRM Org_Module → mytrion_inbox_messages). A dedicated shared
  //     secret in the `x-inbox-secret` header, scoped to just that endpoint (NOT the full API_KEY). ---
  INBOX_WEBHOOK_SECRET: z.string().default(''),

  // --- File storage: Cloudflare R2 (S3-compatible) ---
  R2_ACCOUNT_ID: z.string().default(''),
  R2_ACCESS_KEY_ID: z.string().default(''),
  R2_SECRET_ACCESS_KEY: z.string().default(''),
  R2_BUCKET: z.string().default(''),
  // Defaults to https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com when blank.
  R2_ENDPOINT: z.string().default(''),
  // Optional public/custom-domain base for serving uploaded files.
  R2_PUBLIC_BASE_URL: z.string().default(''),
  // R2 ignores region but the S3 SDK requires one; 'auto' is correct for R2.
  R2_REGION: z.string().default('auto'),

  // --- File storage: MinIO (self-hosted, S3-compatible). R2 swaps in later via env only:
  // set S3_ENDPOINT to the R2 endpoint, S3_REGION=auto, S3_FORCE_PATH_STYLE=0.
  S3_ENDPOINT: z.string().default(''),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  S3_BUCKET: z.string().default(''),
  S3_REGION: z.string().default('us-east-1'),
  // MinIO requires path-style addressing (bucket in the path, not the host).
  S3_FORCE_PATH_STYLE: flag('1'),
  S3_PRESIGN_TTL_SECONDS: z.coerce.number().int().positive().max(86_400).default(900),
  // Hard cap for uploads AND generated artifacts.
  FILE_MAX_SIZE_MB: z.coerce.number().int().positive().max(200).default(25),
  // Parse-path memory guardrail (Render starter plan): max bytes loaded for file analysis.
  PARSE_MAX_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),

  // --- Browser automation: Browserbase (legacy direct stubs — superseded by Composio toolkits) ---
  BROWSERBASE_API_KEY: z.string().default(''),
  BROWSERBASE_PROJECT_ID: z.string().default(''),
  BROWSERBASE_BASE_URL: z.string().default('https://api.browserbase.com'),

  // --- Browser automation via Composio toolkits (FIRECRAWL for scraping; add the Composio
  // Browserbase toolkit slug for interactive sessions once verified in the dashboard) ---
  COMPOSIO_BROWSER_TOOLKITS: z.string().default('FIRECRAWL'),
  // CSV of allowed hostnames/suffixes for browser/scrape targets. EMPTY = deny all navigation
  // (fail closed) — set explicitly before enabling browser automation.
  BROWSER_ALLOWED_DOMAINS: z.string().default(''),
  // Simple in-memory per-toolkit rate limit for Composio executions.
  COMPOSIO_RATE_PER_MIN: z.coerce.number().int().positive().default(30),

  // --- Feature flags ---
  FF_PARTNER_AUDIENCE_ENABLED: flag('1'),
  FF_KNOWLEDGE_INGEST_ENABLED: flag('1'),
  // Mini-app self-service WRITE actions (C-16 override, C-1/C-3 activate/deactivate, C-4/5 limits,
  // C-26 unit/driver, C-10 fraud request) — carrier-scoped, rate-limited, audit-logged. Off by
  // default: enable per environment once the pilot carrier is briefed.
  FF_MINIAPP_CARD_WRITES_ENABLED: flag('0'),
  /** Comma-separated carrier ids piloted for notification pollers (card_status diff). Empty =
   *  the cron job no-ops — per-carrier rollout, Onzmove first (see notification ultraplan). */
  NOTIFY_POLL_CARRIERS: z.string().default(''),
  // Mini-app C-17 money-code preview/draw (servercrm owns the limit math). Off by default.
  FF_MINIAPP_MONEY_CODE_ENABLED: flag('0'),
  /** Mini-app "add a manager" invite creation. OFF by owner decision 2026-07-22 — managers are
   *  onboarded by Octane agents only; the roster (list/revoke) in the mini-app stays available. */
  FF_MINIAPP_MANAGER_INVITES_ENABLED: flag('0'),
  // Cap on a single mini-app limit CHANGE (C-4/5). Bigger adjustments go through CS.
  MINIAPP_LIMIT_CHANGE_MAX: z.coerce.number().positive().default(1000),
  // Always-on RAG: inject RBAC-scoped pgvector passages into every chat turn.
  FF_RAG_ENABLED: flag('1'),
  // Hybrid retrieval (vector + full-text RRF fusion). Requires the content_tsv migration.
  FF_RAG_HYBRID: flag('0'),
  // Agentic retrieval loop (multi-query planning + sufficiency-driven refinement + citations).
  FF_AGENTIC_RAG: flag('0'),
  // Optional LLM rerank of fused candidates (adds a model call per retrieval).
  FF_RAG_RERANK: flag('0'),
  // Route worker/tool-calling turns to Groq (gpt-oss). Off → all turns stay on OpenAI.
  FF_GROQ_ENABLED: flag('0'),
  // Expose Zoho MCP tools to the chat agent (read tools only unless FF_ZOHO_MCP_WRITES). Off by default.
  FF_ZOHO_MCP_ENABLED: flag('0'),
  // Additionally expose Zoho MCP WRITE tools (create/update/upsert). Off by default (read-only posture).
  FF_ZOHO_MCP_WRITES: flag('0'),
  // Connect the hosted dbt MCP (warehouse analytics + query-memory RAG). Off by default. When on,
  // OpenAI chat/agents get the same agentic tools Claude uses on that MCP (`recall_similar_queries`,
  // `query`); admin-only via department policy. See integrations/dbtMcp.ts + dbtMcpTools.ts.
  FF_DBT_MCP_ENABLED: flag('0'),
  // Expose dbt MCP WRITE tools (`run` / `test`). Off by default (read-only posture).
  FF_DBT_MCP_WRITES: flag('0'),
  FF_AUDIT_LOG_ENABLED: flag('1'),
  // Dev-only route that mints a validly-signed Telegram initData for a fake user (local mini-app
  // testing without a real Telegram client). Off by default — gating solely on NODE_ENV!=='production'
  // is not enough, since NODE_ENV defaults to 'development' when unset (a misconfigured staging/
  // preview env sharing the prod bot token would otherwise expose it). Explicit opt-in required.
  FF_DEV_MOCK_TELEGRAM_ENABLED: flag('0'),
  // Sales workers may run DESTRUCTIVE touchpoints (card deactivate/limits, money-code draw,
  // fraud release, EFS override) — widget parity, ON by default. 0 = admin-only, no code change.
  FF_TOUCHPOINT_DESTRUCTIVE_SALES: flag('1'),
  // DeepAgents orchestrator endpoint (POST /v1/agent/deep). Off by default; lazy-loaded when on.
  FF_DEEP_AGENTS_ENABLED: flag('0'),
  // Composio external tool-calling (adds the external-tools subagent + /v1/integrations/composio/*).
  FF_COMPOSIO_ENABLED: flag('1'),
  // Expose Composio WRITE/destructive tools (create/update/delete/…) to the agent. Off = read-only
  // (hard-rule #7), mirroring FF_ZOHO_MCP_WRITES. Even when on, the subagent stays admin-gated.
  FF_COMPOSIO_WRITES: flag('0'),
  // Expose the native Telegram toolkit (send/get tools) to the agent. Sends are write-risk →
  // admin-gated by the dispatcher regardless; this just registers the toolkit.
  FF_TELEGRAM_ENABLED: flag('1'),
  // Strict customer isolation: requests carrying customer markers (carrier_id / application_id /
  // chat_id) get a locked-down 'customer' context — client-supplied department_scope /
  // allDepartments / profile / role / user_name are IGNORED and scope derives solely from the
  // company id. ON by default (hardening pass 2026-07): set to 0 only as a temporary rollback
  // while a legacy client (Telegram shim) still sends worker-style scope fields.
  FF_CUSTOMER_SCOPE_STRICT: flag('1'),
  // Strict worker departments: bound a verified NON-admin worker's department view by the
  // departments derived from their Zoho profile/role (deriveWorkerDepartments). Off until the
  // profile→department mapping is validated against the live Zoho roster — an unmapped profile
  // would silently drop the worker to Global-only knowledge.
  FF_WORKER_DEPT_STRICT: flag('0'),
  // Session-authoritative department access on the direct routes (Desk / Data Center /
  // RingCentral / Retention / Knowledge): verified sessions IGNORE the x-department-access /
  // x-all-departments headers; a non-admin worker's departments are derived from their Zoho
  // profile/role. ON by default (security fix 2026-07: header trust let any authenticated user
  // self-elevate). Set to 0 ONLY as an emergency rollback if live Zoho profiles don't map onto
  // KNOWN_DEPARTMENTS (watch the "department claims ignored" warn log).
  FF_SESSION_DEPT_AUTHORITATIVE: flag('1'),
  // Zoho OAuth worker sign-in (/v1/auth/zoho/*) + Bearer-session identity on caller routes.
  // ON by default — the portal always expects Zoho OAuth; set to 0 only for emergency static-key bypass.
  FF_ZOHO_OAUTH_ENABLED: flag('1'),
  // Multi-agent orchestrator endpoint (POST /v1/agent). FF_DEEP_AGENTS_ENABLED is kept as a
  // deprecated alias — either flag enables the endpoint.
  FF_ORCHESTRATOR_ENABLED: flag('0'),
  // Durable LangGraph threads (PostgresSaver in the 'langgraph' schema). Off = stateless runs.
  FF_AGENT_CHECKPOINTS: flag('0'),
  // Reuse the compiled LangGraph agent across turns, keyed by (agent + full caller identity/scope).
  // Skips re-compiling the graph + re-fetching Composio tools every turn (big win for admin/
  // orchestrator turns). Safe because the key includes every identity/authority/view field, so no
  // two callers ever share a graph; requestId is sourced from the run context at dispatch, not baked.
  FF_AGENT_GRAPH_CACHE: flag('1'),
  // File generation/analysis tools + /v1/files routes (MinIO/S3 storage).
  FF_FILES_ENABLED: flag('0'),
  // Browser automation via Composio toolkits (admin-gated; domain-allowlisted; fail closed).
  FF_BROWSER_ENABLED: flag('0'),
  // Human-in-the-loop approvals: agent-proposed write/destructive tools park as pending
  // approvals (24h TTL) instead of executing. Unlocks agent writes safely.
  FF_WRITE_APPROVALS: flag('0'),
  // Long-term agent memory: end-of-run distillation + UNTRUSTED recall in scoped RAG.
  FF_AGENT_MEMORY: flag('0'),
  // Interactive browser WRITE actions (navigate/click/fill/…). Off = scrape/read-class only.
  FF_BROWSER_WRITES: flag('0'),
  // Retention Open Pool notify (Ryan Saab) + Ops Manager vacation signoff — Zoho user ids.
  // Empty = skip inbox notify (sweep/transitions still run). Outbound email = Zapier.
  RETENTION_OPEN_POOL_NOTIFY_ZOHO_USER_ID: z.string().default(''),
  RETENTION_OPS_MANAGER_ZOHO_USER_ID: z.string().default(''),
  // Reserved for Zapier / ops identity — not used by app Zoho send_mail (disabled).
  RETENTION_NOTIFY_FROM_EMAIL: z.string().default(''),
  // Comma-separated Zoho CRM user ids for Phase 2 Retention RoundRobin (prefer Isonline).
  RETENTION_CS_ROUND_ROBIN_ZOHO_USER_IDS: z.string().default(''),
  // Spanish Retention desk assignee (bypasses RoundRobin when is_spanish_desk).
  RETENTION_CS_SPANISH_ZOHO_USER_ID: z.string().default(''),
  // Pilot switch: when ON, auto-create Retention cases only for listed Sales agents
  // (Zoho CRM user ids). Off = generate for all agents (production). Clear flag to reset.
  FF_RETENTION_PILOT_ONLY: flag('0'),
  // Comma-separated Zoho CRM user ids (e.g. Daniel Brown 6227679000031473048).
  RETENTION_PILOT_AGENT_ZOHO_USER_IDS: z.string().default(''),

  // Background jobs (pg-boss on the app Postgres, own 'pgboss' schema — self-migrating).
  FF_JOBS_ENABLED: flag('0'),
  // inline: this process runs boss + workers + schedules (default, single Render service).
  // send-only: this process only enqueues; a dedicated worker (dist/worker.js) executes.
  // off: /v1/agent/tasks returns 503.
  JOBS_WORKER_MODE: z.enum(['inline', 'send-only', 'off']).default('inline'),
  PGBOSS_SCHEMA: z
    .string()
    .regex(/^[a-z_][a-z0-9_]*$/, 'must be a plain lowercase identifier')
    .default('pgboss'),
  // Batch size for the agent-run queue worker (how many agent runs execute concurrently).
  JOBS_CONCURRENCY: z.coerce.number().int().positive().max(10).default(2),
  JOBS_CRON_TZ: z.string().default('America/Chicago'),
});

export type Env = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  // Only happens for malformed values (bad enum / non-numeric port), never for
  // missing-but-defaulted keys. Surface the issue and fail fast.
  console.error('[env] Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment configuration');
}

export const env: Env = parsed.data;

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
export const isDev = env.NODE_ENV === 'development';

/**
 * Resolved app database URL — the Mytrion OPS external Postgres. `DATABASE_URL` is a
 * legacy alias kept only as a fallback. Empty means unconfigured (caught at startup).
 */
export const databaseUrl: string = env.MYTRION_OPS_DATABASE_URL || env.DATABASE_URL;

export const corsOrigins: string[] = env.CORS_ORIGINS.split(',')
  .map((o) => o.trim())
  .filter(Boolean);

export const corsOriginSuffixes: string[] = env.CORS_ORIGIN_SUFFIXES.split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

/**
 * Verify that runtime secrets are present. Called once at server/worker startup
 * (not at import time, so tests and tooling can import modules freely). In
 * production any missing secret is fatal; in dev/test we warn and continue with
 * insecure fallbacks so the app still boots locally.
 */
export function assertRuntimeSecrets(): void {
  const missing: string[] = [];
  if (!databaseUrl) missing.push('MYTRION_OPS_DATABASE_URL');
  if (!env.JWT_SECRET) missing.push('JWT_SECRET');
  if (!env.ENCRYPTION_KEY) missing.push('ENCRYPTION_KEY');
  if (!env.OPENAI_API_KEY) missing.push('OPENAI_API_KEY');
  if (env.FF_GROQ_ENABLED && !env.GROQ_API_KEY) missing.push('GROQ_API_KEY');
  if (env.FF_ZOHO_MCP_ENABLED && !env.ZOHO_MCP_URL) missing.push('ZOHO_MCP_URL');
  if (env.FF_DBT_MCP_ENABLED) {
    if (!env.DBT_MCP_URL) missing.push('DBT_MCP_URL');
    if (!env.DBT_MCP_CLIENT_ID) missing.push('DBT_MCP_CLIENT_ID');
    if (!env.DBT_MCP_CLIENT_SECRET) missing.push('DBT_MCP_CLIENT_SECRET');
  }
  if (env.FF_COMPOSIO_ENABLED && !env.COMPOSIO_API_KEY) missing.push('COMPOSIO_API_KEY');
  if (env.FF_TELEGRAM_ENABLED && !env.TELEGRAM_BOT_TOKEN) missing.push('TELEGRAM_BOT_TOKEN');
  if (env.FF_ZOHO_OAUTH_ENABLED) {
    if (!env.ZOHO_SERVER_CLIENT_ID) missing.push('ZOHO_SERVER_CLIENT_ID');
    if (!env.ZOHO_SERVER_CLIENT_SECRET) missing.push('ZOHO_SERVER_CLIENT_SECRET');
    if (!env.JWT_SECRET) missing.push('JWT_SECRET');
  }
  if (env.FF_FILES_ENABLED) {
    if (!env.S3_ENDPOINT) missing.push('S3_ENDPOINT');
    if (!env.S3_ACCESS_KEY_ID) missing.push('S3_ACCESS_KEY_ID');
    if (!env.S3_SECRET_ACCESS_KEY) missing.push('S3_SECRET_ACCESS_KEY');
    if (!env.S3_BUCKET) missing.push('S3_BUCKET');
  }

  if (missing.length === 0) return;

  if (isProduction) {
    throw new Error(`Missing required secrets in production: ${missing.join(', ')}`);
  }
  console.warn(
    `[env] Missing secrets (${missing.join(', ')}). Using insecure dev fallbacks — do not use in production.`,
  );
}
