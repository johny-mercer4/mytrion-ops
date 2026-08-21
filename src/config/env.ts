import 'dotenv/config';
import { z } from 'zod';
import { horizonTelegramEnvShape } from './envHorizon.js';
import { featureFlagEnvShape } from './envFeatureFlags.js';
import { inboundSecretsEnvShape } from './envInboundSecrets.js';
import { operationalEnvShape } from './envOperational.js';
import { storageEnvShape } from './envStorage.js';

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

  // --- Database: Mytrion OPS Postgres (sessions, logging, knowledge) ---
  // No localhost default: a missing value should fail loudly (see assertRuntimeSecrets).
  // `DATABASE_URL` is a legacy alias.
  //
  // THERE IS NO LOCAL DATABASE OVERRIDE, deliberately. A `LOCAL_OPS_DATABASE_URL` used to redirect
  // this in development, and it cost three separate false diagnoses in one day: a repair script that
  // reported "scored 716" five times while writing nothing to prod, a 503 blamed on an unmigrated
  // prod database that was in fact migrated, and a filter reported as broken that was reading an
  // empty local snapshot. Localhost and prod must be the same database. See
  // tests/unit/no-local-db-override.test.ts.
  MYTRION_OPS_DATABASE_URL: z.string().default(''),
  DATABASE_URL: z.string().default(''),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  // Admin Data Loader launch target. NocoDB owns its own auth and runs outside this process.
  NOCODB_BASE_URL: z.string().default(''),

  // --- Data Warehouse (separate read Postgres; tool + metadata target) ---
  DWH_DATABASE_URL: z.string().default(''),

  // --- Verification DB (the single credit_platform Postgres DSN; `johnmercer` credential, Render →
  // SSL). Read pool (verificationDb.ts) opens it read-only; the write-back pool
  // (creditPlatformWriteDb.ts) opens the SAME DSN in a writable session. ---
  VERIFICATION_DATABASE_URL: z.string().default(''),
  // Write-back kill switch: when on, Mytrion may write credit_platform over VERIFICATION_DATABASE_URL
  // (kxd.sales_agent_* inbox + Orchestration stop_factors / system_state). On by default; set 0 to disable.
  VERIFICATION_WRITE_ENABLED: flag('1'),
  // Credit-platform HTTP (fire-and-forget create/run/approve). Empty = ingest still writes the
  // local case and marks auto-start failed.
  CREDIT_PLATFORM_BASE_URL: z.string().default(''),
  CREDIT_PLATFORM_API_KEY: z.string().default(''),
  CREDIT_PLATFORM_ANALYST_API_KEY: z.string().default(''),
  // Shared Verification case owner. Numeric Zoho user id; if empty we resolve "Sarvar Asqarov".
  /**
   * The verification desk's credit agents. Comma-separated Zoho ids — Stage 0 routes a new case to
   * one of them. `_IDS` is the current name; `_ID` is the same list under the old singular key and is
   * still read, because the deployed .env carries it.
   */
  VERIFICATION_CASE_OWNER_ZOHO_USER_IDS: z.string().default(''),
  VERIFICATION_CASE_OWNER_ZOHO_USER_ID: z.string().default(''),
  /** Who a case escalates TO. Empty means escalation has no destination and must refuse loudly. */
  VERIFICATION_MANAGER_ID: z.string().default(''),

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
  // Model IDs by role. Wired in modules/llm/openaiClient.ts (`models`):
  //   FIVE_O_NANO  → router / grader / casual / tool-free utility calls
  //   FIVE_O_MINI  → grounded answers + department specialists (reasoning WITH tools)
  //   HARD_MODEL   → escalation. MUST differ from FIVE_O_MINI or "escalate" is a no-op.
  //
  // Every id here must support reasoning AND function tools on /v1/chat/completions. Verified
  // 2026-08-11 against the live API: gpt-5.4 / gpt-5.4-mini / gpt-5.4-nano / gpt-5.5 all pass;
  // gpt-5.4-pro is not a chat model (404); and the whole GPT-5.6 family (sol/terra/luna) rejects
  // tools unless reasoning_effort is 'none' — i.e. adopting 5.6 here costs reasoning on every
  // tool call, which is why the agent tier stays on 5.4. See WORKING_NOTES 2026-08-11.
  OPEN_AI_FIVE_O_NANO: z.string().default('gpt-5.4-nano'),
  OPEN_AI_FIVE_O_MINI: z.string().default('gpt-5.4-mini-2026-03-17'),
  // Was gpt-5.4-mini — identical to the grounded tier, so escalation changed nothing.
  OPEN_AI_HARD_MODEL: z.string().default('gpt-5.4'),
  OPEN_AI_EMBEDDING_SMALL: z.string().default('text-embedding-3-small'),
  // Client-level deadline for every raw OpenAI SDK call (chat, RAG planner/judge,
  // rerank, memory, web search, embeddings). A hung provider call must never hang a turn.
  OPENAI_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  // Output cap for the chat pipeline's main completions (max_tokens / max_completion_tokens).
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(4096),
  // Embedding batch cap: embeddings.create is called with at most this many inputs per request.
  EMBED_BATCH_SIZE: z.coerce.number().int().positive().max(2048).default(128),

  // --- DeepAgents (LangChain/LangGraph orchestrator + RAG / web-search / tool-caller subagents). ---
  // Off by default (FF_DEEP_AGENTS_ENABLED). Reuses OPENAI_API_KEY; no new provider.
  // Empty DEEP_AGENTS_MODEL falls back to the default chat model. The web-search subagent calls the
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
  /**
   * Provider retries per model call. The OpenAI SDK honours the `retry-after` a 429 carries, so each
   * retry is a short, server-directed wait rather than a blind hammer.
   *
   * Was hard-coded to 2, which is thin for a shared 200k tokens-per-minute pool: at ~28,700 input
   * tokens per turn, ~7 turns/minute saturate the org, and a burst outlasts two backoffs. A failed
   * turn costs the user their whole question; a third and fourth retry costs a second.
   */
  AGENT_MODEL_MAX_RETRIES: z.coerce.number().int().min(0).max(8).default(4),
  // Output cap for agent-path model calls (maxTokens / maxCompletionTokens on ChatOpenAI).
  AGENT_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(4096),
  // Deadline for outbound integration HTTP calls (serverCrm, Zoho) via fetchWithTimeout.
  OUTBOUND_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  // Suite-level spend cap for scripts/evalLive.ts (agent turns + judge calls, USD).
  EVAL_MAX_COST_USD: z.coerce.number().positive().default(2),
  // Checkpointed threads idle longer than this are swept by a background job.
  AGENT_CHECKPOINT_TTL_DAYS: z.coerce.number().int().positive().default(30),
  // Context paging (PagedPostgresSaver): char budget for mid-history before eviction (~tokens×4).
  AGENT_CONTEXT_PAGE_CHARS: z.coerce.number().int().positive().default(32_000),
  // Keep this many trailing messages when paging (plus the first message).
  AGENT_CONTEXT_KEEP_RECENT: z.coerce.number().int().positive().max(50).default(19),
  // Inject goal re-anchoring into the turn brief every N user turns (messageCount/2).
  AGENT_GOAL_RECITE_EVERY: z.coerce.number().int().positive().default(4),
  // Shared JSON blackboard for supervisor↔worker handoffs.
  FF_AGENT_BLACKBOARD: flag('1'),
  AGENT_BLACKBOARD_MAX_CHARS: z.coerce.number().int().positive().default(16_384),
  // Procedural skill cache (winning tool trajectories).
  FF_AGENT_SKILL_CACHE: flag('1'),
  /**
   * Authored skills (src/modules/agents/skills/**): the whenToUse index in the system prompt and the
   * skill_read tool. On by default. Exists so the library can be A/B'd on the bench — a capability
   * whose cost is measured (+41% wall) but whose benefit is not is exactly what this repo turns off.
   */
  FF_AGENT_SKILLS: flag('1'),
  AGENT_SKILL_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.78),
  AGENT_SKILL_MAX_PER_KEY: z.coerce.number().int().positive().default(200),
  // Plan-and-Execute JSON DAG (orchestrator path).
  FF_AGENT_PLAN_DAG: flag('1'),
  // Deterministic wave executor (dispatches ready DAG nodes; soft prompt path when off).
  FF_AGENT_HARD_DAG: flag('1'),
  AGENT_PLAN_MAX_NODES: z.coerce.number().int().positive().max(16).default(8),
  AGENT_PLAN_MAX_PARALLEL: z.coerce.number().int().positive().max(8).default(3),
  AGENT_PLAN_MAX_REPLANS: z.coerce.number().int().positive().max(5).default(2),
  // Corrective RAG: after Incorrect/thin hops, try web fallback when the agent has webSearch.
  FF_CRAG_WEB_FALLBACK: flag('0'),
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
  RAG_RETRIEVAL_STRATEGY: z.enum(['exact', 'ann', 'shadow']).default('exact'),
  RAG_ANN_MIN_ELIGIBLE_CHUNKS: z.coerce.number().int().positive().default(10_000),
  RAG_HNSW_EF_SEARCH: z.coerce.number().int().min(10).max(1_000).default(100),
  RAG_MIN_COSINE_SCORE: z.coerce.number().min(-1).max(1).default(0.5),
  /**
   * Server-side cap on passages returned to an agent, regardless of the `limit` the model asks for.
   *
   * This is the single biggest lever on tokens-per-minute. Measured 2026-08-12: an answer-role call
   * averages 12,744 input tokens of which only ~3,600 is the cached static prefix (system prompt +
   * tool schemas); the rest is dominated by the grounding block, and it is REPLAYED on every model
   * call in the turn (2.24 of them on average, so ~28,700 input tokens per turn). At a 200,000
   * tokens-per-minute organisation limit that is roughly seven turns per minute for the whole org.
   */
  RAG_MAX_PASSAGES: z.coerce.number().int().min(1).max(25).default(6),
  RAG_NO_MATCH_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  // Release controls are deliberately opt-in until the governed schema migration has run.
  FF_RAG_V2_CONTEXT: flag('0'),
  FF_RAG_V2_RETRIEVAL: flag('0'),
  FF_RAG_CLAIM_VERIFY: flag('0'),
  FF_PLATFORM_KNOWLEDGE: flag('0'),
  FF_RAG_MODEL_POLICY: flag('0'),
  // Docs unverified for longer than this are demoted in retrieval and flagged in citations.
  STALE_DOC_DAYS: z.coerce.number().int().positive().default(180),
  // Optional LangSmith tracing passthrough (traces contain message content — staging only).
  LANGSMITH_TRACING: z.string().default(''),
  LANGSMITH_API_KEY: z.string().default(''),
  LANGSMITH_PROJECT: z.string().default(''),

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

  // --- Carrier onboarding / client mini-app bot (apps/mini-app + agent-gateway). ---
  // Deep-linked from the carrier invite flow: https://t.me/<username>?start=<inviteId>.
  // This token is ALSO what agent-gateway long-polls. Do NOT reuse it for Horizon.
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

  // --- Horizon worker-CRM Mini App bot (apps/mytrion-crm). Isolated from the carrier bot above. ---
  ...horizonTelegramEnvShape,

  // '1' → apply pending Drizzle migrations at boot (see db/migrate.ts). Set in the Render env group
  // so a deploy migrates the DB itself; off by default so tests/local/tooling never auto-migrate.
  DB_MIGRATE_ON_BOOT: z.string().default(''),
  /**
   * How long boot migrations may wait out a database that is still coming up (Postgres 57P03 /
   * connection refused) before giving up. A deploy that races a Render Postgres restart used to die
   * outright — see the incident note in db/migrate.ts. Only transient codes are retried; bad SQL
   * still aborts boot immediately. 0 disables waiting entirely.
   */
  /**
   * How long boot migrations wait for a database that is refusing connections before giving up
   * and exiting non-zero (which Render reports as a failed deploy).
   *
   * Raised 90 → 300 after the 2026-08-06 deploy failed exactly this way: the migrations had
   * already applied, then Render's Postgres restarted underneath the instance
   * (`pg_postmaster_start_time` = 22:36:21 UTC, seconds after the boot log) and every retry hit
   * ECONNREFUSED until the 90s budget ran out. A managed-Postgres restart routinely takes longer
   * than 90 seconds, and waiting five minutes for the database is strictly better than failing the
   * deploy — the instance is not serving traffic either way, and Render restarts it regardless.
   */
  DB_BOOT_WAIT_SECONDS: z.coerce.number().int().min(0).max(600).default(300),

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
  // EITHER form works: the portal origin (the SPA reads the params directly) or this API's
  // `/v1/auth/zoho/callback` (the GET handler there bounces the browser to PORTAL_BASE_URL).
  ZOHO_OAUTH_REDIRECT_URI: z.string().default('http://localhost:5173'),
  // Where the API sends the browser after Zoho redirects to the API's own callback path. Default '/'
  // is correct in prod: the portal is served same-origin at root (plugins/widgetStatic.ts). Set it to
  // the Vite origin (http://localhost:5173) only when running the SPA on a separate dev port.
  PORTAL_BASE_URL: z.string().default('/'),
  // Scopes for the sign-in token. `ZohoCRM.users.READ` reads the worker's own CRM user when their
  // profile is permitted to; `AaaServer.profile.READ` is the fallback that made ordinary profiles work
  // at all — `GET /users` is gated by the caller's CRM profile permission on the Users module, which
  // Administrators hold and Sales-type profiles usually do not, so login 403'd for everyone but admins.
  // The fallback identifies the human at the accounts level and reads their profile/role with the
  // service token instead. Adding a scope means existing workers re-consent once on next sign-in.
  ZOHO_OAUTH_SCOPES: z.string().default('ZohoCRM.users.READ,AaaServer.profile.READ'),

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

  // --- Gong (Call Hub Phase 2 — recordings/transcripts). Off until credentials + client land. ---
  FF_GONG_ENABLED: flag('0'),
  GONG_ACCESS_KEY: z.string().default(''),
  GONG_ACCESS_KEY_SECRET: z.string().default(''),
  GONG_BASE_URL: z.string().default('https://api.gong.io'),

  // --- FMCSA QCMobile + Socrata (Verification Phase 4 — authority & operating status) ---
  // The free QCMobile webKey (register at mobile.fmcsa.dot.gov/QCDevsite). It is a QUERY PARAM on
  // every call, never a header. NOT IP-bound as far as the docs go — but the FMCSA EDGE is: every
  // fmcsa.dot.gov host returns a blanket 403 to non-US egress, so this only resolves from the US
  // Render instance. A 403 is therefore permanent, not throttling; the client must not retry it.
  FMCSA_API_KEY: z.string().default(''),
  FMCSA_BASE_URL: z.string().default('https://mobile.fmcsa.dot.gov/qc/services'),
  // Socrata open data is third-party SaaS (data.transportation.gov CNAMEs to socrata.net), NOT DOT
  // infrastructure, so it answers from anywhere — which is what makes Phase 4 developable off-Render.
  SOCRATA_BASE_URL: z.string().default('https://data.transportation.gov'),
  // OPTIONAL and empty here. Anonymous access works; an app token only raises the rate limit. An
  // empty value is safe, but a WRONG one is a hard 403 — so the client omits the header entirely
  // when this is blank rather than sending it empty. Deliberately NOT in assertRuntimeSecrets.
  SOCRATA_APP_TOKEN: z.string().default(''),

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

  ...inboundSecretsEnvShape,
  ...storageEnvShape,

  // --- Realtime WebSocket (GET /v1/realtime + GET /v1/carrier/mini-app/realtime) ---
  // Server-side protocol-ping interval, which is also the reap deadline: a socket that has not
  // answered the PREVIOUS sweep's ping is terminated on the next one (so a dead socket is
  // dropped within 2 intervals). The browser's WebSocket API answers `pong` at the protocol
  // level with no JS involvement, so this is how a dead CLIENT is noticed server-side and its
  // hub subscriptions are freed. Render imposes no fixed WS timeout, but a CDN in front (e.g.
  // Cloudflare) caps WS at 100s — 25s stays under 75% of that so adding one needs no retune.
  REALTIME_PING_INTERVAL_MS: z.coerce.number().int().min(1_000).default(25_000),
  // --- Agent presence (drives ticket round-robin: only an available ONLINE agent is assignable) ---
  // Ships dark. When off, sockets are not tracked and nothing is written to
  // mytrion_agent_presence — so the table can land, and the heartbeat can run, well before ticket
  // assignment exists. Turn on together with the comms ticketing surface.
  FF_COMMS_PRESENCE: flag('0'),
  // How often a lease's last_seen_at is refreshed when nothing changed. Must be >= the ping
  // interval so each refresh follows at least one liveness check.
  PRESENCE_REFRESH_MS: z.coerce.number().int().min(1_000).default(30_000),
  // How old a lease may be and still count as online. Must be > 2x PRESENCE_REFRESH_MS or agents
  // flicker offline between refreshes — enforced as a boot assertion below, not left to a comment.
  PRESENCE_STALE_MS: z.coerce.number().int().min(3_000).default(90_000),

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

  ...featureFlagEnvShape,
  ...operationalEnvShape,
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
 * Resolved app database URL — the Mytrion OPS external Postgres. `DATABASE_URL` is a legacy alias
 * kept only as a fallback. Empty means unconfigured (caught at startup).
 *
 * One database, in every environment including localhost. No dev-only override.
 */
export const databaseUrl: string = env.MYTRION_OPS_DATABASE_URL || env.DATABASE_URL;

/** Hostname only — safe to log / return in operator-facing 503s. Never includes credentials. */
export function databaseHost(url = databaseUrl): string {
  try {
    return new URL(url).hostname || 'unknown';
  } catch {
    return 'unparseable';
  }
}

export const corsOrigins: string[] = env.CORS_ORIGINS.split(',')
  .map((o) => o.trim())
  .filter(Boolean);

export const corsOriginSuffixes: string[] = env.CORS_ORIGIN_SUFFIXES.split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
