# WORKING_NOTES.md

Append-only changelog of decisions. Newest entries at the bottom of each day.

---

## 2026-06-03 — Repo bootstrap

### Step 1 — Bootstrap project

- Created `package.json` (ESM, Node 20+, pnpm). Added `"packageManager": "pnpm@9.12.0"` (not in the
  original spec) so Corepack resolves a deterministic pnpm version in CI/Render/local.
- `tsconfig.json` is typecheck/IDE only: `noEmit: true`, no `rootDir` (the spec put `rootDir: ./src`
  on a config that also `include`s `tests/` + `scripts/`, which errors with TS6059). Emit lives in
  `tsconfig.build.json` (`rootDir: ./src`, src only).
- **Import convention:** relative imports with explicit `.js` extensions, no `@/*` alias usage. This
  is the only convention that runs unchanged under `tsx`, Vitest, and `node dist` without a
  path-rewrite build step. The `@/*` path is kept in tsconfig (per spec) but intentionally unused.
- ESLint via legacy `.eslintrc.cjs` (ESLint 8). `no-explicit-any: error` in `src/`, relaxed in
  `tests/` + `scripts/`. Not using type-aware linting (no `parserOptions.project`) to keep lint fast
  and decoupled from include globs.
- Added `vitest.config.ts` (not in spec tree) — needed so Vitest resolves `.js`→`.ts` and for
  coverage config.
- `docker-compose.yml` uses `pgvector/pgvector:pg16` so the `vector` extension is available locally;
  `redis:7-alpine` for the queue.
- Multi-stage `Dockerfile` (build → prod-deps runtime), `render.yaml` per spec (web + worker + redis
  + managed Postgres 16).

### Environment notes (this machine)

- Node v24.13.0, npm 11.6.2. `pnpm` not installed globally and Corepack cannot symlink into
  `/usr/local/bin` (EACCES) — pnpm is therefore invoked as `corepack pnpm`.
- `docker` not installed locally → compose stack cannot be brought up here; files are authored and
  validated by inspection. Same for live Postgres/Redis/OpenAI: code is written and unit-tested with
  mocks; anything requiring live services is called out in the relevant step.

### Step 2 — Docker compose (21:15)

- `docker-compose.yml`: `pgvector/pgvector:pg16` + `redis:7-alpine`, both with healthchecks;
  `enable-pgvector.sql` mounted as a Postgres init script. Docker isn't installed on this machine,
  so the stack was authored + reviewed but not booted here.

### Step 3 — Drizzle schema (21:25)

- 8 tables: tenants, users, conversations, messages, tool_calls, knowledge_docs, knowledge_chunks,
  audit_log. `knowledge_chunks.embedding` is `vector(1536)` with an HNSW cosine index.
- **No DB-level foreign keys.** Isolation is repo-layer (per spec). drizzle-kit 0.24 can't resolve
  ESM `.js` specifiers to `.ts`, so schema files avoid value-level sibling imports; `drizzle.config`
  lists the 8 table files explicitly (not the barrel). First migration `0000_*.sql` generated, then
  `CREATE EXTENSION IF NOT EXISTS vector;` prepended so `db:migrate` is self-sufficient.

### Step 4 — Repos (21:35)

- `userRepo`, `conversationRepo`, `messageRepo`, `knowledgeRepo`, `auditRepo`, `toolCallRepo` (+
  `util`). Every method scopes by `ctx.tenantId` (conversations also by `userId`).
  `knowledgeRepo.buildSearchQuery` is exposed so the RBAC test can assert the tenant/audience WHERE
  via `.toSQL()` offline.

### Step 5 — Auth (21:45)

- `permissions.ts` holds the literal role→{scopes,audiences} table. **Scopes are always derived from
  role server-side** (never read from the JWT) so a tampered token can't escalate. `jose` HS256
  access/refresh tokens; bcrypt + pepper for passwords; constant-time-ish login.

### Step 6 — Fastify plugins (21:50)

- requestContext (AsyncLocalStorage + requestId), errorHandler (AppError/Zod → JSON), auth
  (`app.authenticate`), rbac (`requireRole`/`requireScope`/`requireAudience`), healthcheck
  (`/health`). Applied on the root instance so decorators propagate without `fastify-plugin`.

### Step 7 — Tool framework (22:00)

- `ToolManifest` contract + type-erased `RegisteredTool`; `registerTool` validates input→handler→
  output with no casts. `ToolRegistry.checkAccess` is the single RBAC gate (audience + all scopes +
  write-risk→admin). 8 definitions: `knowledge.search` is real (retriever); the other 7 are typed
  stubs returning deterministic mock data keyed to `ctx.tenantId`. OpenAI function names can't
  contain dots, so the chat layer maps `.`↔`__`.

### Step 8 — OpenAI chat loop (22:00)

- `chatService.runChatTurn` + `streamChatTurn` (SSE with tool-call delta assembly), bounded by
  `MAX_TOOL_ITERATIONS`. Tools dispatch only through `toolDispatcher` (re-checks RBAC, persists a
  tool_calls row + audit). `costTracker` rolls up tokens×price per tenant. messageStore converts
  rows↔OpenAI messages and trims orphan leading tool messages.

### Step 9 — Knowledge ingestion (22:05)

- `chunker` (recursive char splitter, overlap), `embedder` (text-embedding-3-small, dim-checked),
  `ingestService` (checksum-idempotent: chunk→embed→atomic replaceChunks), `retriever` (kNN via
  repo), `ingestWorker` (BullMQ; connection passed as RedisOptions to dodge an ioredis version skew
  with BullMQ's bundled copy). The HTTP `/knowledge/embed` ingests synchronously so it works without
  Redis; the worker is for async/bulk.

### Step 10 — Remaining tools + routes (22:05)

- The 7 vendor tool stubs (Zoho ×2, Octane ×3, partner ×2) plus routes (auth, chat, knowledge,
  tools, admin, health), `app.ts` factory, and `server.ts`. Scripts: `seed` (octane tenant + admin
  + sample users), programmatic `migrate`, `embed-docs` CLI. CI (lint/typecheck/test/build) +
  deploy (Render hook).

### Verification (22:10)

- `pnpm typecheck` clean · `pnpm lint` clean · `pnpm test` 25/25 (incl. the cross-tenant RBAC test)
  · `pnpm build` clean · `dist/app.js` loads under Node ESM (confirms `.js`-extension prod runtime)
  · `pnpm db:generate` reports no drift · largest file 326 lines (< 600 cap).
- Not runnable here (no docker/Postgres/Redis/OpenAI key): `db:migrate`, `db:seed`, live
  `/v1/chat` round trip, `/v1/knowledge/embed` persistence. Code is complete; these need live
  services (run `docker compose up -d` + set `OPENAI_API_KEY`).

---

## 2026-06-04 — Direction reset: drop Redis, add metadata tooling

Server's purpose clarified: it's the **internal AI server that answers Agent requests**. Tool
targets going forward are DWH (Postgres), Zoho (CRM/Desk/People/Projects), the CMP custom Node
server, and external platforms. Prompts stay in TS (not md). Sessions + logging on our own
Postgres. Delivery: work on `build` → PR to `main` → Render deploy.

### Claude Code project config

- Added `.claude/settings.json`: auto-approve safe shell (cd/ls/pnpm/git status·add·commit/…),
  **deny `git push`**. Standing rule — Claude commits to the current branch but never pushes;
  pushing/PRs are the human's action.

### Dropped Redis/BullMQ (per "no Redis for now")

- Deleted `ingestWorker.ts`; removed `worker`/`worker:prod` scripts, `ioredis` + `bullmq` deps,
  `REDIS_URL`, `INGEST_QUEUE_NAME`, and the `/knowledge/embed` `async`→queue path (ingest is now
  always synchronous, which `embed-docs` CLI already was). Removed the redis + worker services from
  `render.yaml` and the redis service from `docker-compose.yml`. Updated README/.env.example.
  Lockfile re-synced. typecheck/lint/test(25)/build all green.

### metadataScripts/ (new)

- Standalone, read-only introspection tooling (run via tsx; not bundled into `dist`). Writes a
  metadata catalog to `output/` (git-ignored) as JSON + Markdown so we build tools against real
  API names. Scripts: `zohoCrmAnalyzer`, `zohoDeskAnalyzer`, `zohoPeopleAnalyzer`, `dwhAnalyzer`
  (+ `pnpm meta:*` scripts). Shared `lib/`: `zohoAuth` (refresh-token → access-token, per-service
  with shared-app fallback), `http`, `output`.
- Env: added a unified Zoho block (shared `ZOHO_CLIENT_ID/SECRET/ACCOUNTS_DOMAIN` +
  per-service refresh tokens & base URLs for CRM/Desk/People/Projects) and `DWH_DATABASE_URL`
  (separate read Postgres, distinct from the app's own DB) to `env.ts` + `.env.example`. All
  default to empty — to be filled in next ("set the .envs"). Analyzers fail fast with a clear
  message when creds are missing (verified).

### `.env` populated + analyzers validated live (later, 2026-06-04)

- Convention change: `*_API_DOMAIN` / `*_BASE_URL` now hold the **full versioned API root**
  (e.g. `https://www.zohoapis.com/crm/v8`, `https://desk.zoho.com/api/v1`,
  `https://people.zoho.com/api`, `https://projectsapi.zoho.com/api/v3`); analyzers append only
  the resource path. Updated env.ts defaults, .env.example, and the 3 Zoho analyzers.
- `.env` written from supplied secrets (git-ignored; never committed). `MYTRION_OPS_DATABASE_URL`
  mapped → `DATABASE_URL` (the app reads `DATABASE_URL`; note the value is a Render-internal host,
  so local dev should point at the docker-compose Postgres instead). `API_KEY` left as a commented
  note — nothing in the app consumes it yet (only `OCTANE_INTERNAL_API_KEY` exists in schema).
- Ran all four analyzers against live systems → catalogs in `metadataScripts/output/` (git-ignored):
  **CRM** 148 modules / 2460 fields · **Desk** 6 modules / 10 departments / 110 fields ·
  **People** 17 forms / 199 fields · **DWH** 6 schemas / 591 tables-views. OAuth + versioned-base
  paths confirmed working for all services.

### OpenAI model vars by role (later, 2026-06-04)

- Replaced `OPENAI_DEFAULT_MODEL` / `OPENAI_REASONING_MODEL` / `OPENAI_EMBEDDING_MODEL` with
  role-named pinned IDs: `OPEN_AI_FOUR_O_MINI` (gpt-4o-mini-2024-07-18 → `models.default`),
  `OPEN_AI_FIVE_O_MINI` (gpt-5.4-mini-2026-03-17 → `models.reasoning`), `OPEN_AI_EMBEDDING_SMALL`
  (text-embedding-3-small → `models.embedding`). Wired in `openaiClient.ts` + `embedder.ts`.
- `MODEL_PRICING` got entries for the pinned 4o-mini and gpt-5.4-mini. **gpt-5.4-mini price is a
  TODO placeholder** (0.25/2.0) — confirm; costTracker falls back to 0 for unknowns and `baseModel`
  already strips the date suffix, so this is visibility-only.

### Auth Wrapper — parent integration auth layer (later, 2026-06-04)

- New `src/integrations/`: `zoho.ts` (OAuth primitives, now returns `expiresInSec`) and
  `wrapper.ts` — the parent `wrapper.authHeaders(platform)` that hides each platform's auth and
  **caches Zoho access tokens** per service (refresh on expiry minus 60s skew). Platforms:
  `zoho_crm|zoho_desk|zoho_people|zoho_projects|cmp`; `zoho_desk` auto-attaches `orgId`. CMP uses a
  static `CMP_API_KEY` (header configurable via `CMP_AUTH_HEADER`, default `Authorization: Bearer`).
  Added `CMP_BASE_URL/CMP_API_KEY/CMP_AUTH_HEADER` to env (empty defaults). The pasted `API_KEY`
  likely belongs in `CMP_API_KEY` — pending confirmation.
- `metadataScripts/lib/zohoAuth.ts` now re-exports from `src/integrations/zoho.ts` (single source).
- Confirmed: 4o-mini (`OPEN_AI_FOUR_O_MINI`) is already the model for every chat + tool-calling
  request via `models.default`; `gpt-5.4-mini` is defined but unused. No change needed.
- New `tests/unit/wrapper.test.ts` (token caching / expiry / per-service / header). 29 tests pass.

### department_access RBAC + file-upload RAG training (later, 2026-06-04)

Scope model (per product direction): RAG **and** tool calling are gated by `department_access`.
- **TenantContext** gains `departments: string[]` + `allDepartmentAccess: boolean`. Supplied per
  request by the trusted caller via `withDepartmentAccess` (body `departmentAccess[]`/`allDepartments`
  or `x-department-access` CSV / `x-all-departments` headers). Admins default to allAccess
  ("managers can access almost everything").
- **Knowledge** docs + chunks get a nullable `department_access` column (NULL = shared/global) +
  btree indexes. Migration `0001_ambitious_gideon.sql` (additive). `ingestDocument` accepts a single
  `department`; retrieval filter in `knowledgeRepo`: managers → unfiltered; else
  `department_access IS NULL OR IN (ctx.departments)` (empty depts → global only).
- **Tools**: `ToolManifest.allowedDepartments?` (omit = all departments). `ToolRegistry.checkAccess`
  adds the gate after audience/scope/write-risk. Existing 8 tools set nothing → unchanged behavior.
- **Endpoints**: new `POST /v1/knowledge/upload` (multipart, `@fastify/multipart`, ≤10MB ×20 files;
  accepts .md/.markdown/.txt/.json/text; optional `department` form field tags every doc). `/embed`
  gains `department`; `/query` + `/chat` + `/chat/stream` thread department access into ctx.
- Tests: `tests/unit/department-access.test.ts` (tool gating + retrieval SQL filter). 36 tests pass;
  typecheck/lint/build clean. NOTE: the migration still needs to run against the DB (`pnpm db:migrate`).

### Always-on RAG in chat + R2/Browserbase env scaffolding (later, 2026-06-04)

Focus narrowed (R2/Browserbase deferred — no creds yet): get streaming chat working with
RBAC-enforced RAG; tool calling comes after confirmation.
- **Always-on RAG**: `chatService` now retrieves RBAC-scoped pgvector passages for the user's
  message and injects them as a system "grounding" block on every turn (`FF_RAG_ENABLED`, default
  on). Isolation is the existing `knowledgeRepo` filter (tenant + audience + department_access), so
  the grounding a caller sees is limited to their departments/keys; managers see all. Retrieval
  failures degrade gracefully (chat continues ungrounded). `ChatTurnResult.ragPassages` added; the
  stream emits a `context` event with the passage count. `department_access` is a generic access tag
  — a department name OR a unique key (zoho user id / carrier id), caller's choice at ingest + query.
- **Upload→ingest with department** (`POST /v1/knowledge/upload`) was already built last entry — this
  is the endpoint the Zoho admin-console widget calls (multipart: file(s) + `department` field).
- **Env scaffolding** (empty defaults, clients wired later): `API_KEY` (inbound key to this engine —
  registered, not yet enforced), Cloudflare R2 (`R2_ACCOUNT_ID/ACCESS_KEY_ID/SECRET_ACCESS_KEY/
  BUCKET/ENDPOINT/PUBLIC_BASE_URL/REGION`), Browserbase (`BROWSERBASE_API_KEY/PROJECT_ID/BASE_URL`).
- 37 tests pass (new: chat RAG grounding). typecheck/lint/build clean.

### DB live + new platform env (later, 2026-06-04)

- Switched `DATABASE_URL` to the **external** Mytrion OPS Render host (off-Render reachable).
  Added conditional **SSL** (`dbSslOption` in db/client.ts; matching ssl in drizzle.config + a
  programmatic-migrate fix) — managed hosts use TLS w/o CA verify, local docker uses none.
- **Applied the migration** to the (empty) Mytrion OPS DB via `tsx scripts/migrate.ts`
  (drizzle-kit's pg driver ignored the ssl option; the postgres.js programmatic migrator honors it).
  Verified: 8 tables created, pgvector installed, `department_access` on docs + chunks. DWH was
  **never touched** (migrations only target DATABASE_URL; DWH is read-only analytics, per user).
- Registered new platform env (values in .env, empty defaults in schema/.env.example): CMP
  login/password **prod + sandbox** (replaced the earlier api-key model), EFS SOAP
  (`EFS_WSDL_URL/LOGIN/PASSWORD/PARENT`), Server CRM (`SERVER_CRM_URL/KEY`). `API_KEY` = inbound key.
- Trimmed the auth Wrapper to **Zoho-only** for now; CMP/EFS/Server-CRM auth providers will be added
  with their tools (CMP needs a login→token flow, EFS is SOAP). Still nothing pushed.

### API_KEY inbound auth + Agent Scope widget endpoints (2026-06-05)

Building the first Zoho widget (**Agent Scope**: upload `.md` knowledge + view embedded vectors).
- **Inbound auth**: new `apiKeyAuthPlugin` decorates `app.apiKeyAuth` — validates the static
  `API_KEY` (`Authorization: Bearer` or `x-api-key`, constant-time) and sets a hardcoded
  `systemContext` (single identity, admin scopes, least-privilege departments). This is the
  no-users access path. `503` if `API_KEY` unset, `401` if missing/wrong.
- **Knowledge endpoints** (all `apiKeyAuth`): existing `/embed`, `/upload`, `/query` plus new
  **GET `/knowledge/docs`** (list, optional `?department`), **GET `/knowledge/stats`**
  (`{docs,chunks}`), **GET `/knowledge/docs/:id`**, **GET `/knowledge/docs/:id/chunks`** (chunk
  content + `hasEmbedding`; raw vectors omitted). Repo: `listChunksByDoc`, `countDocs`, dept filter
  on `listDocs`.
- **Brief for the widget dev's agent**: `docs/agent-scope-widget-backend.md` — full contract, auth
  (with a "don't ship API_KEY in client JS — proxy it" warning), RBAC, error shapes, examples.
- 39 tests pass (added API-key rejection tests). typecheck/lint/build clean. Migration unchanged.

### Fix prod DB env: use MYTRION_OPS_DATABASE_URL (2026-06-08)

Prod (`octane-ops-ai.onrender.com`) was 500ing on knowledge endpoints with `ECONNREFUSED
127.0.0.1:5432` — `DATABASE_URL` was unset in Render, so env.ts fell back to the localhost
default. Render env uses **`MYTRION_OPS_DATABASE_URL`**, not `DATABASE_URL`. Fixes:
- env.ts: `MYTRION_OPS_DATABASE_URL` is the canonical app DB var (`DATABASE_URL` kept only as a
  legacy fallback); **removed the localhost default**; exported resolved `databaseUrl`;
  `assertRuntimeSecrets` now fails fast in production if it's unset (no more silent localhost).
- db/client.ts, scripts/migrate.ts, drizzle.config.ts now use `MYTRION_OPS_DATABASE_URL`.
- render.yaml: dropped the unused Render-managed DB + `DATABASE_URL` wiring; all config (incl.
  `MYTRION_OPS_DATABASE_URL`) comes from the env group. .env.example renamed.
- Verified the external URL connects (8 public tables). **Action on user: set the Render env vars
  (esp. `MYTRION_OPS_DATABASE_URL`) and redeploy** — code alone can't fix a missing prod env.

### department_access normalization + new keys (2026-06-08)

Widget dev brief added 3 RBAC keys (`finance`, `c-level`, `management`) — no schema change needed
since `department_access` is free-text. Added **normalization** so ingest- and query-side tags can't
drift: `src/lib/department.ts` (`normalizeDepartment`/`normalizeDepartments` = trim + lowercase,
blank => null/Global; `KNOWN_DEPARTMENTS` for reference, NOT an enforced allowlist). Applied in
ingestService (doc tag), withDepartmentAccess (caller's allowed keys), and the `/docs?department=`
filter. Updated `docs/agent-scope-widget-backend.md` with the canonical key table + answers to the
5 RBAC questions. **Open product decision** (relayed to user): whether elevated keys
(`c-level`/`management`/`finance`) expand server-side to broader scopes, or stay caller-driven
(`allDepartments: true`). Today: no server hierarchy — caller passes the set + Global. 41 tests pass.

### Knowledge upsert/delete/re-tag + streaming chat for Zoho widget (2026-06-09)

First widget upload stored `department_access = null` (widget didn't send `department`, or sent a
different key, or deploy lagged). Fixes:
- **Upsert/re-tag**: `ingestDocument` now compares the normalized department; if content is
  unchanged (checksum match) but the department differs, it re-tags the doc + chunks (no re-embed,
  `status: "updated"`). Department is also persisted on the full-ingest path. So re-sending a file
  with the right department now corrects an existing doc.
- **Field alias**: `/embed` + `/upload` accept the department under `department` **or**
  `department_scope` (the chat-side name) to avoid silent nulls from a name mismatch.
- **Delete**: `DELETE /v1/knowledge/docs/:id` (repo `deleteDoc`, tx removes chunks + doc).
  Repo also gains `setDepartment` (re-tag doc + chunks).
- **Streaming chat enabled for the widget**: `/chat` + `/chat/stream` now use **API_KEY** auth and
  accept `zoho_user_id` (conversation owner, namespaced `zoho:<id>`), `user_name` (fallback id +
  added to the system prompt), and `department_scope` (string|array → department RBAC). GET history
  routes take `?zohoUserId=`. `ChatTurnOptions.userName` threads into the prompt.
- Frontend brief: `docs/chat-widget-backend.md` (SSE contract, params, fetch-stream snippet, RBAC).
- 41 tests pass; typecheck/lint/build clean. The existing SalesHandbook doc (null dept) can be
  fixed by re-uploading it with the department set, now that upsert re-tags.

### role/profile params + Administrator RBAC bypass (2026-06-09)

Chat endpoint now accepts `role` + `profile` (string|array). **Single source of truth** for the
"see everything" bypass: `resolveAllDepartmentAccess({allDepartments, profile})` in
`src/lib/department.ts` → true if `allDepartments:true` OR profile contains "administrator"
(case-insensitive substring; `isAdministratorProfile`). It sets `ctx.allDepartmentAccess`, which
**both** RAG retrieval (`knowledgeRepo.departmentFilter`) and tool gating
(`registry.hasDepartmentAccess`) already key off — so Administrator bypass is uniform across RAG and
tools by construction. TenantContext gained optional `profiles`/`callerRole` (audit + future
per-role policy). Documented in `docs/chat-widget-backend.md`. 44 tests pass (added admin-bypass
tests). Note: tool calling itself is still deferred, but the gate honors the same flag now.

### CORS for the Zoho widget (direct-from-browser SSE) (2026-06-09)

The RnD widget calls `/v1/chat/stream` directly from the browser (Zoho's proxy buffers and can't
stream). Zoho serves widgets from per-instance `*.zappsusercontent.com` subdomains (dynamic origin).
- `src/lib/cors.ts`: `isAllowedOrigin` (exact `CORS_ORIGINS` match OR allowed suffix from new
  `CORS_ORIGIN_SUFFIXES`, default `zappsusercontent.com`) + `sseCorsHeaders` (echo origin).
- `@fastify/cors` now uses an origin **function** (reflects the origin, never bare `*`), with
  explicit methods (`GET/POST/PUT/PATCH/DELETE/OPTIONS`) and allowedHeaders (incl. `x-api-key`,
  `Authorization`, `x-department-access`, …). Preflight → 204 via the plugin.
- **SSE fix**: `startSSE` does `reply.hijack()` + raw `writeHead`, which bypasses Fastify's reply
  headers — so the cors plugin's header was lost on the stream. `startSSE` now takes `extraHeaders`
  and the stream route passes `sseCorsHeaders(request.headers.origin)`. SSE already sets
  `text/event-stream` + `no-transform` + `X-Accel-Buffering: no` (no buffering).
- 46 tests pass (added preflight-echo + unknown-origin-rejected). Decision doc: no dept hierarchy.

### Tool-calling foundation: platform auth wrappers (2026-06-09)

Set up the per-platform wrapper layer under `src/integrations/` (auth only for now; calls/tools
later). Patterns borrowed (not imported) from `~/Desktop/Octane-Project/servercrm` (build):
`services/{cmpAuth,efs,dwh,zohoAuth}.js`.
- `tokenCache.ts`: reusable `createTokenProvider` (TTL + skew + in-flight dedup + forceRefresh/clear;
  injectable clock for tests). CMP + EFS use it; Zoho keeps its existing per-service cache.
- `dwh.ts`: read-only `pg.Pool` on `DWH_DATABASE_URL` (`ssl:false`, `options=-c
  default_transaction_read_only=on`) + `dwhQuery`/`getDwhPool`/`closeDwhPool`. Never writes the DWH.
- `cmp.ts`: login/password → bearer (`POST {base}/api/authenticate`), cached per environment;
  **defaults to sandbox** (`CMP_ENV`). `cmpAuthHeaders/getCmpToken/forceRefreshCmpToken/cmpBaseUrl`.
- `efs.ts`: node-soap (`soap` dep added) parent `login` → session clientId (TTL via tokenCache) +
  child carrier tokens (`CarrierGroupWS.loginAsChild`); WSDL/endpoint derived from `EFS_WSDL_URL`
  (override `EFS_GROUP_WSDL_URL`). Auth only — card ops later.
- `wrapper.ts` remains the Zoho parent (cached per service). `index.ts` barrel namespaces
  `zoho`/`dwh`/`cmp`/`efs`. New env: `CMP_ENV` (sandbox), `EFS_GROUP_WSDL_URL`.
- 55 tests pass (added integrations.test: tokenCache dedup/TTL, CMP cached auth, EFS helpers,
  DWH unset-guard). typecheck/lint/build clean; largest integration file 137 lines.

### Server CRM wrapper (proxy path) (2026-06-09)

Added `integrations/serverCrm.ts` — the "mix" path: our servercrm node server already wraps
DWH/EFS/CMP/Zoho and exposes an agent API under `/api/agent/*` (auth = static `x-api-key`, verified
against servercrm `middleware/auth.js`). Wrapper = `serverCrmBaseUrl` + `serverCrmAuthHeaders`
(`x-api-key: SERVER_CRM_KEY`) + thin `serverCrmRequest`/`serverCrmGet`/`serverCrmPost` (URL build,
query params, JSON, throw-on-non-2xx). No token flow. Uses existing `SERVER_CRM_URL`/`SERVER_CRM_KEY`
env. Barrel exports it as `serverCrm`. 59 tests pass (4 new: header, GET url+query, POST body,
non-2xx). So tool-building can choose: direct vendor wrapper (dwh/cmp/efs/zoho) OR proxy via serverCrm.

### Zoho API reference skills (2026-06-19)

Researched (3 parallel agents on official Zoho docs) and committed Claude Code skills under
`.claude/skills/` for building Zoho tool integrations — each covers metadata + core + bulk APIs:
- `zoho-crm-api/SKILL.md` — CRM REST **v8** (OAuth/scopes, modules/fields/layouts, record CRUD,
  search, COQL, related/notes/attachments/tags, bulk read/write, credits/limits, errors).
- `zoho-desk-api/SKILL.md` — Desk **v1** (orgId header, tickets CRUD+actions, threads/conversations/
  comments, sendReply, contacts/accounts, activities, search, counts, errors). Verified vs Zoho's
  official OpenAPI repo. Gotchas captured: update=PATCH, delete=`moveToTrash`, empty=HTTP 204.
- `zoho-people-api/SKILL.md` — People's **3 coexisting API styles** (legacy forms / v2 / v3),
  forms/records, employees, org structure, attendance, leave, bulk import; success sentinel varies.
- `.claude/skills/README.md` indexes them; each opens with a "Using this in Mytrion Ops" header tying
  it to `src/integrations/` wrappers + `pnpm meta:zoho-*` catalogs. Docs only — no code change.

### First real tool: Zoho People employee lookup (2026-06-19)

First production tool, routed through the existing chat tool-calling loop (no chat-route change —
`buildTools` exposes any registered tool to `/chat` + `/chat/stream`).
- `src/integrations/zohoPeople.ts` — `searchEmployees({name?,department?,limit?})` via the legacy
  forms `getRecords` on the `employee` form (auth from `wrapper.authHeaders('zoho_people')`,
  base from `baseUrl('zoho_people')`). Filters via `searchParams` (Contains, pipe=AND); single-word
  name fans out to FirstName∪LastName (two requests, deduped); two-word name → first AND last.
  Parses `response.result` `{recordId:[sections]}` → flat `{recordId, fields}`; throws on `status!=0`.
  Field label-names (`FirstName`/`LastName`/`Department`) are tweakable constants (People analyzer
  didn't capture them; these are the standard system labels).
- `definitions/zoho_people_search_employees.ts` — `ToolManifest` `zoho_people.search_employees`
  (read, internal, scope `zoho_people:read`); registered in tools/index. Covers all/by-name/by-dept.
- Tests: `tests/unit/zoho-people.test.ts` (6) + bumped `tools.test` counts (9 total; admin-internal 7;
  ops stays 6 — lacks `zoho_people:read`). 65 tests pass; typecheck/lint/build clean.
- NOT a sales-owner-scoped record, so no zoho_user_id ownership filter applied (HR lookup). Could
  later gate `allowedDepartments` to e.g. hr/management/c-level if employee data should be restricted.

### Automation_Logs table + insert endpoint (2026-06-19)

Simple front-end-driven logging into the Mytrion OPS DB.
- New table `automation_logs` ([schema](src/db/schema/automation_logs.ts)): `id`, `tenant_id`,
  `trigger_time` (text), `trigger_date` (text), `automation_type` (text, required), `agent_name`
  (text), `created_at` (timestamptz). Trigger time/date are pass-through strings; `created_at` is the
  authoritative server time. Migration `0002_safe_dakota_north.sql` — **applied directly to the live
  DB** (`tsx scripts/migrate.ts`); verified the 7 columns exist.
- `automationLogRepo.insert(ctx, {...})` + `POST /v1/automation/logs` ([automation.routes.ts])
  (API_KEY auth, zod-validated; `automationType` required, rest optional). Returns `{id, createdAt}`.
- Registered in app.ts + drizzle.config schema list. Front-end brief: `docs/automation-logs-widget-backend.md`.
- 67 tests pass (added 401 + 400-validation cases). typecheck/lint/build clean.

### Knowledge doc delete: DELETE + POST alias + bulk (2026-06-20)

Widget needs to remove ingested docs (cascade). `knowledgeRepo.deleteDoc` now returns
`{id,title,chunkCount}|null` (was boolean). Routes (all API_KEY-guarded):
- `DELETE /v1/knowledge/docs/:id` → `{ deleted: {id,title,chunkCount} }`, 404 if unknown.
- `POST /v1/knowledge/docs/:id/delete` — identical alias (Zoho proxy can't reliably DELETE).
- `POST /v1/knowledge/docs/delete` `{ids:[...]}` (1–100) → `{ deleted:[...], notFound:[...] }`.
Hard delete removes the doc row incl. checksum, so re-upload re-ingests fresh (no "skipped") — the
dev's IMPORTANT requirement, satisfied by construction (no soft-delete). Not department-scoped
(admin deletes any). **Live-verified against the prod DB** (temp script, cleaned up): delete returns
the right shape, `findDocByChecksum` → null after, chunks → 0, unknown id → null (404). Brief
updated (`docs/agent-scope-widget-backend.md` §7–8). 69 tests (added 401 + bulk-validation 400).

### servercrm-proxy agent tools + retire fake stubs (2026-06-22)

Reviewed servercrm (build) operational processes (3 parallel agents; map saved to memory
[[servercrm-reference]]). Then:
- **Retired the 7 mock/stub tools** (`zoho_crm.search_accounts`, `zoho_crm.get_account`, `octane.*`,
  `partner.*`) — they returned fake data and were live in chat. Registry is now real-only.
- **3 servercrm agent-API proxy tools** (via the `serverCrm` wrapper): `agent.sales_snapshot`
  (POST /api/agent/dwh/snapshot), `agent.debtors` (POST /api/agent/dwh/debtors), `agent.activity`
  (GET /api/agent/activity/:zohoUserId). Internal, read, scope `servercrm:read`.
- **Owner scoping** (`src/modules/tools/serverCrmScope.ts`): non-admins locked to their own identity
  (agentName = `ctx.userName`; zohoUserId from `ctx.userId` `zoho:<id>`); `Administrator`
  (allDepartmentAccess) may override to query another agent. Enacts the sales-agent ownership RBAC.
- Carrier-detail tools (overview/transactions/balance) deferred — not server-side owner-scoped, so
  they need a roster check first (next batch). CRM-via-COQL also next (user chose servercrm first).
- Registry now 5 tools. Updated rbac.test/tools.test/fixtures; new `tests/unit/servercrm-tools.test.ts`
  (scoping + request building). 75 tests pass; typecheck/lint/build clean. Widget brief Tools table updated.


### LLM provider research: OpenAI + Groq (2026-06-22)

Ran an 8-agent research workflow (6 parallel research → fact-check verify → synthesis) on OpenAI +
Groq/Llama for speed + cost. Output committed as skill `.claude/skills/llm-providers/SKILL.md`
(verified pricing/capability table + phased integration plan). Key conclusions:
- Add **Groq via the OpenAI-compatible baseURL** (existing `openai` SDK), not `groq-sdk`.
- Use **`openai/gpt-oss-120b`/`gpt-oss-20b`, NOT Llama** (all Groq-Llama deprecated in 2026; gpt-oss
  = official replacement + strict json_schema + caching). 
- Route: worker turns → Groq gpt-oss; final grounded answer → OpenAI; hard → `gpt-5.4-mini`.
- Mandatory validate→strip-wrappers→retry→**fallback-to-OpenAI** on Groq tool-call failure.
- Gate behind `FF_GROQ_ENABLED` (off by default). Decision saved to memory. NOT yet implemented —
  this turn is research + plan only; `GROQ_API_KEY` is in `.env`.


### Groq implementation: worker provider + OpenAI fallback (2026-06-22)

Implemented the Groq plan from the llm-providers skill, behind `FF_GROQ_ENABLED` (off by default).
Commits: `c1c2c45` (env/constants/openaiClient/modelRouter scaffolding) + `f2f93c2` (chat wiring,
review fixes, tests).
- `modelRouter.resolveModel(role)` → worker=Groq `gpt-oss-120b` when flag on, else OpenAI; answer/
  reasoning/embedding always OpenAI. Flag-off ⇒ behavior identical to the all-OpenAI baseline.
- `openaiClient`: `getGroq()` reuses the `openai` SDK with Groq baseURL; `getClient(provider)`.
- chatService runs the whole turn on the worker `TurnModel`; on a Groq error it falls back to
  OpenAI and stays there (sticky). Audit detail carries `provider` + `fellBack`.
- Hardening from an adversarial review workflow (16 agents, 9 confirmed findings) — all fixed before
  commit: (1) parse-first/sanitize-on-failure so valid tool args are never mutated (killed a
  baseline-affecting false-positive + a silent `<|python_tag|>` corruption); (2) ReDoS-safe unwrapper
  (substring guards + indexOf slicing + 64KB cap); (3) streaming fallback now covers mid-stream
  failures, falling back only before the first token is emitted (no duplicate output).
- Tests: router, non-stream + SSE routing, open/pre-token/mid-token fallback, multi-iteration
  stickiness, flag-off parity + OpenAI rethrow, sanitizer safety. RBAC suites green. 93 pass;
  typecheck/lint/build clean. chatService.ts 517 lines (<600 cap). Not pushed.


### Zoho CRM/Desk/People read tools + RAG verification (2026-06-22)

Added simple READ-ONLY tooling to prove the Zoho integrations + RAG work end to end.
Commits: `cbf1c89` (tools) + `4a0f78b` (review hardening).
- Integrations: `src/integrations/zohoCrm.ts` (runCoql via POST /coql + getOrg) and
  `zohoDesk.ts` (listTickets GET /tickets + listDepartments). People tool already existed.
- Tools: `zoho_crm.query` (COQL, scope zoho_crm:read) and `zoho_desk.search_tickets`
  (scope zoho_desk:read), both internal + riskClass read, departments left open. Registry now 7.
- `scripts/zoho-smoke.ts` (`pnpm zoho:smoke`): live read-only smoke — CRM org+COQL, Desk
  departments+tickets, People employees, and a RAG ingest→retrieve→delete round-trip. SKIPs when
  a secret is absent; only DB write is the self-deleting canary.
- **Verified live against the real org (company=Octane): all 6 checks pass**, incl. RAG retrieval
  (pgvector + OpenAI embeddings). So OAuth tokens, all three Zoho services, and RAG are confirmed working.
- Learned live: Zoho COQL REQUIRES a WHERE clause (use `where id is not null` to match all) — baked
  into the tool description. Desk `listTickets` works WITHOUT departmentId (kept optional).
- Adversarial review workflow (24 agents) → applied: Desk limit caps (tickets 99 / depts 200);
  removed the brittle COQL write-keyword regex (false-positives only, since /coql is SELECT-only +
  read scope); OrgInfo snake_case. Rejected the "departmentId required" finding (live evidence wins).
- Architecture decision: tool CONTRACTS stay hardcoded (ToolManifest); BUSINESS/SCHEMA context
  (module/field API names, dept name→id, glossary) goes in the RAG vector DB. The model needs RAG to
  write correct COQL — they're complementary, not either/or. Next: ingest a CRM/Desk/People data
  dictionary (.md, skeleton from `pnpm meta:zoho-*`).


### Whole-metadata analyzers + write-side feasibility (2026-06-22)

Expanded all four metadataScripts analyzers to pull complete catalogs; verified live (read-only).
Commit: `a686ddc`.
- CRM: + org, users, custom-module flag, per-field picklist values + lookup/relationship targets,
  per-module related lists. Live: 149 modules (47 custom), 200 users, 353 picklist fields, 84 lookups.
- Desk: + agents, teams, per-field allowedValues (picklists); module sweep extended. Live: 10 depts,
  10 agents, 24 picklist fields.
- People: + component options (best-effort; this edition's /components doesn't return them → 0).
- DWH: + foreign keys + indexes. Live: 594 tables/views, 146 indexes, 0 declared FKs (normal for a warehouse).
- All sections best-effort: missing scope / invalid module logged + recorded, never fatal. output/ git-ignored.

**Write-side finding (custom modules) — IMPORTANT.** Zoho's public APIs do NOT support creating
custom MODULES (CRM), FORMS (People), or any "module" (Desk) — that's a product-UI/admin-console
operation. Confirmed against the committed API skills + Zoho MCP tool set (no createModule anywhere).
What the APIs DO allow:
- CRM: create custom **fields** (`POST /settings/fields`, scope settings.fields.CREATE — the MCP
  `createFields` capability) and **records** (POST /{module}); also notes/tags/attachments.
- Desk: create **records** (tickets, departments) — no custom-field/module create endpoint.
- People: insert **records** into existing forms (insertRecord, add-employee, add-department) — no form create.
So any "creation" tooling = custom fields (CRM only) or records. These are production WRITES
(outward-facing, hard to reverse) → must be gated: riskClass 'write', admin role, dry-run default,
explicit --apply. Awaiting user decision on scope before building.


### Zoho MCP evaluation — decision: defer (2026-06-23)

Researched connecting Mytrion Ops to Zoho's hosted MCP (5-cluster research workflow + skeptical
critique). Decision: **do NOT build on Zoho hosted MCP now; keep the existing refresh-token integration.**

Why:
- **Headless auth is the blocker.** Zoho hosted MCP documents only two auth models: "Authorization on
  Demand" (per-user browser OAuth, default) and "Authorization via Connections" (a human Super Admin
  consents once, tokens shared org-wide). Every documented client (Claude/Cursor/VS Code) requires an
  interactive "Click Allow" at connect time. No documented server-to-server / API-key-only path for a
  cold backend process. So a multi-user backend almost certainly can't drive it headless.
- **We already have headless auth**: src/integrations/zoho.ts (grant_type=refresh_token) + wrapper.ts
  (cached 1h access tokens). Non-expiring refresh token minted once = autonomous forever. This is our
  "single service identity" and it's already proven live (last session's smoke test).
- **Beta risk**: Zoho MCP is early/beta ("functionalities may change"); no official GA date.
- **RBAC mismatch**: "Authorization via Connections" = one shared Super-Admin identity, no
  per-department scoping → our department_access RBAC would have to do ALL isolation (makes rule 9
  cross-tenant tests load-bearing).

If we revisit later (post-GA), the path = an MCP-client adapter behind toolDispatcher:
- Package: the single `@modelcontextprotocol/sdk` (v1.x, subpath imports e.g.
  `@modelcontextprotocol/sdk/client/streamableHttp.js`). The split `@modelcontextprotocol/client|server`
  is v2/pre-alpha (~stable Aug 2026) — NOT what you install today. (Repo has no MCP SDK yet.)
- Transport: StreamableHTTPClientTransport (SSE deprecated).
- Wrap each discovered MCP tool as a ToolManifest; classify riskClass via verb allowlist
  (get/search/list→read, create/update/delete/upsert/send→write), default-unknown→write (rule 7);
  route every call through toolDispatcher (RBAC+audit); sanitize JSON-Schema for OpenAI strict mode
  (strip anyOf/format/$ref); provision the shared token with READ-only scopes as defense-in-depth.
- Gate behind a one-time falsification test: in the Zoho MCP console create a server with
  "Authorization via Connections", then from a clean machine (no Zoho cookies) curl/Node-connect the
  generated URL — if it 401s/redirects-to-login, hosted-MCP-headless is dead.


### AI Chat sessions + conversation logging (2026-06-23)

Persistent chat sessions for the widget. Commit `3475aeb`. EXTENDED the existing conversations/messages
tables + repos (not new chat_* tables) since /chat/stream already returns conversations.id + replays
from messages. Migration 0004 applied live (additive columns; cv_/msg_ id prefixes for new rows).
- Logging wired into runChatTurn + streamChatTurn via finalizeTurn (annotate final assistant OR insert
  errored/cap-fallback row; auto-title; messageCount +2; lastMessageAt bump). ensureConversation is
  create-on-missing and returns the row.
- CRUD: POST create / GET list(+total) / GET :id (transcript) / POST :id rename / POST :id/delete (cascade).
- Reviewed (21 agents); fixed 4 blockers: cross-user IDOR (by-id routes now owner-scoped via zoho_user_id,
  tenant fallback only when absent — widget should always send it), tool-cap final answer now persisted to
  a transcript row, chatService split (completion.ts extracted) to stay <600 lines, errored-empty rows not
  replayed into prompt. Verified live incl. cross-user 404s.
- KNOWN non-blocking follow-ups (from review, deferred): (1) messageCount is a denormalized display-only
  counter (+2/turn) — can drift from transcript length on preamble-with-tool_calls or errored-after-preamble
  turns; no consumer depends on it. (2) A DB write failing mid-tool-loop can leave an assistant(tool_calls)
  row with no matching tool row → that one conversation is un-resumable until it ages past 20 turns; fix =
  drop a trailing unsatisfied-tool_calls assistant in loadHistory (symmetry with the existing leading-tool drop).


### Zoho MCP bridge — headless via "Authorize via Connection" (2026-06-23)

Reversed the earlier "hosted MCP can't go headless" conclusion: with the server created as
"Authorize via Connection" (not "on Demand") + the connection authorized once in the Zoho console,
the per-server URL authenticates a cold backend with NO browser/OAuth. Verified live (probe + bridge
smoke): 15 tools; getOrganization + COQL run through our dispatcher. Commit `d81f71a`.
- Only env needed: ZOHO_MCP_URL (+ FF_ZOHO_MCP_ENABLED=1 to turn on). FF_ZOHO_MCP_WRITES (off) gates writes.
- zohoMcp.ts raw JSON-RPC client (Streamable HTTP, timeout-bounded). mcpTools.ts discovers + wraps each
  tool as a RegisteredTool → toolDispatcher (RBAC+audit). Boot load is raced against 20s + try/catch (non-fatal).
- This server's tool names are `ZohoCRM_<verb>` (NOT bare camelCase). Live registered 11 read tools.
- WRITE SECURITY (important): riskClass 'write' + admin RBAC is INERT here — the sole inbound identity
  (static API_KEY) is admin/'*'. Real controls = FF_ZOHO_MCP_WRITES (off) + the Zoho connection's own
  scopes. If writes must be unreachable, recreate the connection READ-ONLY in the Zoho console.
- Non-blocking follow-ups (from 25-agent review, deferred): tool-name '.'<->'__' round-trip is lossy for
  names containing '__' (no live impact — names use single '_'); no outbound response-size cap (matches
  every other integration); session-state has no concurrency mutex (sequential tool loop today); add
  negative-path/boot-resilience + writes-on tests. None affect the flag-off default.


### Department agents — distribute RAG + tools per team (2026-06-26)

Per-department AI distribution. Commit `1e1fe86`. Reuses the existing department_access RBAC (RAG)
+ tool allowedDepartments (dispatcher) — no new enforcement path.
- `src/modules/agents/departmentAgents.ts` = single source of truth: 6 agents (sales, billing,
  customer-service, verification, collection, retention) → {persona, dept tools}. Drives both the
  system-prompt persona (resolveAgentPersona) and each tool's allowedDepartments (applyDepartmentPolicy,
  applied to native tools in tools/index and to MCP tools at app boot).
- Tool map: sales→sales_snapshot/activity/crm.query; billing+collection→debtors/crm.query;
  customer-service→desk/crm.query; verification+retention→crm.query; knowledge.search universal;
  zoho_mcp.* + zoho_people = admin-only (ADMIN_ONLY sentinel '__admin_only__').
- Admin/unlimited = ADMIN_PROFILE_MARKERS env (CSV, default administrator,manager,developer), matched
  case-insensitive substring on profile AND role. resolveAllDepartmentAccess is still THE single bypass.
- Verified live end-to-end: Sales caller denied admin-only MCP tools (got zoho_crm.query only);
  Manager (role marker) got zoho_mcp.getModules + real data. RAG dept-isolation proven prior session.
- KNOWN footgun (documented in .env + code): 'manager' substring over-matches titles like "Account
  Manager" → would grant unlimited. Tune ADMIN_PROFILE_MARKERS to precise values if that's a risk.
- To deploy: merge build→main (Render), set ADMIN_PROFILE_MARKERS if defaults don't fit, and the
  widget sends department_scope (per Zoho user's dept) + profile + role as it already does.


### AI Chat widget — external React+TS Zoho widget (2026-06-26)

First real frontend in `web/` (Vite + React 18 + TS, CSS Modules). Our OWN stack — the Vue/CDN
`zoho-octane` repo is reference-only. Auth = the user's CRM session via the Embedded App SDK; on mount
`getCurrentUser()` → {profile, role} → `deriveDepartmentScope()` → backend department-agent RBAC.
- API layer (`web/src/api/`): `config.ts` (org-var URL/key via getOrgVariable inside CRM; VITE_* only in
  dev), `transport.ts` (ZOHO.CRM.HTTP proxy inside CRM / direct fetch in dev; `findError` scans every
  wrapper level), `chat.ts` (conversation CRUD), `stream.ts` (SSE: direct fetch+getReader for live
  tokens → sticky proxy fallback on CORS). Contract verified clean against backend (events
  start/status/context/tool_call/tool_result/token/done/error; done={conversationId,message,ragPassages}).
- Chat feature (`web/src/features/chat/`): `useChat` reducer + ChatPanel/ConversationList/MessageList/
  MessageBubble/Composer, each with its own .module.css. "New chat" interrupts a live turn.
- Reviewed adversarially twice (find→verify workflows). Fixed: VITE_API_* now gated behind
  import.meta.env.DEV so it can't inline into the prod bundle (verified absent) + sourcemaps off;
  AbortSignal threaded through ALL THREE stream paths (proxy, reader-loop, buffered) so a stale stream
  can't clobber the current conversation; stream finally/catch guarded by controller identity; stable
  message ids; empty-bubble guard (keeps grounding-only rows); scroll-pin on [messages].
- OPEN tradeoff (user's call): stream.ts tries a direct browser fetch first (carries x-api-key) for live
  tokens, per the reference workaround. Key is already in-browser via getOrgVariable, so exposure is the
  user's own Network tab. To eliminate entirely → move to a Zoho Connection (key server-side, buffered
  responses only inside CRM). Left as-is to preserve live streaming.
- Build: `cd web && pnpm build` (tsc --noEmit + vite build → web/app/). `pnpm dev` on :3000 (in CORS
  allowlist) shows a DEV MOCK admin user. Package via `zet` (see web/README.md). `deriveDepartmentScope`
  still has placeholder rules — wire real profile/role → dept mapping before non-admin testing.


### Widget served same-origin by the backend at /widget (2026-06-29)

Decision: host the widget UI FROM the API instead of a separate static site. Chosen for one URL + zero
CORS (same origin → the live-token streaming fetch just works). Zoho external-widget Base URL =
`https://octane-ops-ai.onrender.com/widget/index.html`.
- `src/plugins/widgetStatic.ts` (NEW): @fastify/static@^7 serves `web/app` under `/widget` (public,
  no api-key guard — files hold no secrets). No-op if web/app isn't built. Resolves the dir via
  import.meta.url so it works under tsx-dev and `node dist`. index.html → no-cache; hashed assets →
  immutable. `/widget` → 302 `/widget/`.
- GOTCHA fixed: @fastify/helmet writes `X-Frame-Options: SAMEORIGIN` onto the RAW Node response, so
  `reply.removeHeader` can't see it — must `reply.raw.removeHeader('X-Frame-Options')` in an
  encapsulated onSend. Scoped to /widget only; the API keeps its frame guard. Verified via inject:
  /widget/* → no XFO, /v1/* → SAMEORIGIN.
- `render.yaml`: API buildCommand now also `pnpm --dir web install && pnpm --dir web build`; removed the
  separate `octane-assistant-widget` static service. Needs main merge + redeploy to go live.
- Tradeoff still open: key reaches the browser via getOrgVariable + rides the same-origin request.
  To keep it off the browser entirely → Zoho Connection (buffered, no live streaming). Left as-is.


### DeepAgents orchestrator — parent + RAG/web/tool-caller children (2026-06-29)

Added the LangChain/LangGraph DeepAgents harness as an ADDITIVE, embedded module (does NOT replace
the hand-rolled chatService). Deps: deepagents@1.10.5, langchain@1.5.2, @langchain/core@1.2,
@langchain/langgraph@1.4, @langchain/openai@1.5. Reuses the existing OpenAI key (no new provider).
- `src/modules/deepagents/`: orchestrator (createDeepAgent parent) delegates via the task tool to 3
  declarative subagents — rag-agent (knowledge_search → retrieve()), web-search-agent (OpenAI
  Responses `web_search` built-in; graceful fallback if model/account lacks it), tool-caller-agent
  (every registry tool → dispatchTool()). `context.ts` = AsyncLocalStorage carrying TenantContext so
  the LangChain tool handlers enforce the SAME RBAC + audit + validation as the chat loop.
- tool-caller tools are built PER REQUEST from `toolRegistry.listForContext(ctx)` (RBAC-filtered),
  knowledge.search excluded (rag-agent's). Registry names are classic-zod-v3 → converted with
  zodToJsonSchema; LangChain tool names can't contain '.', so `zoho_crm.query` → `zoho_crm__query`
  (real name used for dispatch). Smoke (admin ctx) built 6 tool-caller tools + a compiling graph.
- GOTCHA: LangChain v1 tool() rejects classic `import {z} from 'zod'` under exactOptionalPropertyTypes
  (_def.description string|undefined). Author tools with `import * as z from 'zod/v4'`; convert the
  registry's v3 schemas via zodToJsonSchema.
- Endpoint: POST /v1/agent/deep, flag-gated FF_DEEP_AGENTS_ENABLED (default OFF) + LAZY import so the
  heavy LangGraph deps stay out of cold start when off. Same body shape + ctx build as /v1/chat.
  env: FF_DEEP_AGENTS_ENABLED, DEEP_AGENTS_MODEL (''→default chat model), DEEP_WEB_SEARCH_MODEL
  (default gpt-4o-mini; dated snapshots may not support web_search). Stateless (no checkpointer).
- Verified: typecheck + build + lint (0 errors) + 143 tests pass + offline orchestrator smoke.


### Composio — external tool-calling gateway for DeepAgents (2026-06-29)

External SaaS tool calls (Zoho CRM/Desk, …) now route through Composio as a NEW `external-tools-agent`
subagent in the orchestrator. Native tool-caller (toolDispatcher) left intact (coexist). Deps:
@composio/core@0.13.1, @composio/langchain@0.10.0. Off unless FF_COMPOSIO_ENABLED.
- Decisions: SHARED ORG ACCOUNT (fixed COMPOSIO_ORG_USER_ID='octane-org' owns connected accounts —
  connect Zoho once, all callers use it; no per-user OAuth) + NEW subagent (keep native).
- `src/integrations/composio.ts`: lazy client (LangchainProvider), `authorizeToolkit`/`listConnections`,
  `isComposioAllowed(ctx)` = admin OR allDepartmentAccess. NOT re-exported from integrations/index.ts
  and only ever lazy-imported, so the SDK never loads at boot when the flag is off.
- `modules/deepagents/tools/composioTools.ts`: `composio.tools.get(orgUser,{toolkits,limit},{afterExecute})`
  → LangChain tools. Hard-rule handling for REMOTE execution: admin-gated exposure (#4/#7) + audit via
  the afterExecute modifier writing tool_calls + audit rows (#8), reading ctx from the run ALS.
- Toolkits = COMPOSIO_TOOLKITS env (default ZOHO,ZOHO_DESK — both Composio-managed OAuth, no custom
  creds). orchestrator.buildDeepAgent is now async; adds external-tools-agent only when FF on + allowed
  + tools resolve.
- Connection mgmt (admin): GET /v1/integrations/composio/status, POST /v1/integrations/composio/authorize
  {toolkit} → Connect Link redirectUrl. Flag+admin gated, lazy-imported.
- GOTCHA: doc said `@composio/core@next` + `LangChainProvider`; real published API is
  `composio.tools.get(userId,filters,opts)` + `LangchainProvider` (lowercase c). afterExecute modifier
  shape: `({toolSlug,toolkitSlug,result})=>result`.
- env: FF_COMPOSIO_ENABLED, COMPOSIO_API_KEY, COMPOSIO_ORG_USER_ID, COMPOSIO_TOOLKITS, COMPOSIO_TOOL_LIMIT.
- To go live: set COMPOSIO_API_KEY + FF_COMPOSIO_ENABLED, then POST .../authorize {toolkit:'ZOHO'} as
  admin → open redirectUrl → complete Zoho OAuth (once). Verified offline: gate, config, no-network
  viewer path, orchestrator builds. Live remote execution untested (needs key + connected account).
- READ-ONLY by default (hard-rule #7): ZOHO (14) + ZOHO_DESK (23) include destructive writes
  (ZOHO_DELETE_DEAL, ZOHO_DESK_UPDATE_TICKET, …). buildComposioTools filters to read tools via
  `isComposioWriteTool` (verb-in-slug regex) unless FF_COMPOSIO_WRITES — same pattern as
  FF_ZOHO_MCP_WRITES. afterExecute audit records per-tool riskClass (read/write). Classifier verified
  on the real slugs (8 read / 7 write sample, 0 misclassified).

## 2026-06-30 — Pivot: external multi-"Mytrion" app (drop Zoho SDK)

- DECISION (owner): drop the Zoho Embedded App SDK entirely. Zoho becomes a THIN shim that reads the
  CRM user and redirects to this external app with identity as URL values
  (`/m/:mytrion?uid&profile&role&uname[&ts&sig]`). The React app reads context from the URL — no SDK.
- Scaffolded 8 department Mytrions under `web/src/mytrions/<id>/` (uniform `MytrionShell` +
  `MytrionScaffold` = shared ChatPanel scoped to a department + "panels to build" notes). 5 ported
  refs (admin←agent-scope, sales←self-service, billing←billing-mytrion, finance←mytrion-finance,
  customer-service←mytrion-customer-service) + 3 new stubs (retention, verification, manager).
- ACCESS: single declarative table `web/src/access/mytrions.config.ts` — profile = DEFAULT,
  `allowedUsernames` = ADDITIVE override, `adminBypass`. `resolveAccess.ts` + route guard. Placeholder
  profile names — owner must edit to real Zoho values.
- ROUTING: react-router-dom v6; `/` Landing (0→403, 1→auto-enter, 2+→picker), `/m/:mytrion` guarded +
  lazy (build code-splits one chunk per Mytrion). Context params stripped from URL after capture.
- API: refactored `api/{config,transport,stream}.ts` to SAME-ORIGIN `/v1` (dropped Zoho HTTP proxy +
  org-variable resolution). TRUST = advisory (owner choice): URL params drive UI only; backend
  x-api-key + department_access is the real boundary. Prod sends NO key (same-origin) — OPEN: backend
  must accept same-origin widget requests; dev uses VITE_API_KEY.
- DELETED: `web/src/zoho/*`, `hooks/useZohoUser`, `features/userContext/*`, `web/plugin-manifest.json`.
- `pnpm -C web build` + typecheck GREEN. Left `web/app` (vendored, deployed at /widget) PRISTINE — the
  pivot needs a mount-point + SPA-fallback decision before rebuilding/vendoring (see web/ARCHITECTURE.md §9).
- Handoff spec for the design agent: `web/ARCHITECTURE.md` (URL contract, Zoho shim Deluge sketch,
  per-Mytrion porting map + endpoints, backend forwarding, deploy wiring, open decisions).

## 2026-06-30 — Apply MytrionOpsDesign system to the web app

- Built the web app to the design at `~/Desktop/MytrionOpsDesign` (Design System.dc.html + Mytrion.dc.html,
  4 screens: 1a picker, 1b admin tabbed, 1c admin chat-docked [chosen], 1d light). "Soft Midnight" dark
  default + "Cool White" light; cyan accent; Rajdhani/Inter/JetBrains Mono.
- Tokens → `styles/theme.css` (:root dark, [data-theme=light] override) + radii/shadows/--gem/--fuel +
  keyframes (spin/thinkBounce/blink) in global.css. Fonts via Google Fonts <link> in index.html.
- New components: `icons.tsx` (centralized SVGs + MytrionGlyph), `BrandMark`(FuelMark+wordmark), `Gem`,
  `TopBar` (brand+context badge+Switch+theme toggle+avatar), `hooks/useTheme` (localStorage, <html data-theme>).
- `MytrionShell` rebuilt to design 1c: TopBar + 64px icon nav rail + center content + ALWAYS-present
  docked `ChatPanel` (404px, surface-alt). Chat restyled: gem avatars, tool chips (running spinner/
  success check/denied x), grounding footnote, thinkBounce dots, pill composer + round accent send.
- `MytrionPicker` = design 1a (hero + 8 hued Mytrion cards, Ported/New badges, Enter →). Admin Mytrion
  center = `KnowledgeBase` panel (search + status-badged doc list, static placeholder — TODO wire /v1/knowledge)
  + Home/Train/Knowledge/Scope nav. Forbidden/NotFound themed. Deleted unused AppHeader/Badge/Card/KeyValueList.
- mytrions.config gained tag/icon(glyph)/hue per Mytrion. web typecheck + build GREEN (code-splits per Mytrion).
- Verified via 5-lens adversarial design-fidelity workflow: FAITHFUL, 0 deviations. `web/app` left PRISTINE
  (rebuild+vendor only after the mount-point + SPA-fallback deploy wiring — ARCHITECTURE.md §9). Caveat: static
  fidelity read, not a rendered pixel diff; chat dock collapses below 900px.

## 2026-07-01 — RBAC: two caller shapes + ADMIN_USERS / BYPASS_USERS

- Context recap: API_KEY callers already resolve to systemContext (role admin, scopes '*'), so the ONLY
  per-request RBAC that varies is DEPARTMENT access. Two caller shapes handled via chat/agent body params:
  - Worker (Zoho): zoho_user_id, user_name, profile, role (+ department_scope).
  - Customer (Telegram): carrier_id OR application_id (company id → department isolation tag), company_name,
    chat_id. Added these to chatSchema; carrier/application ids are UNIONed into departmentAccess so a
    customer only sees their company's knowledge/tools (+ Global).
- ADMIN_USERS / BYPASS_USERS env (CSV or bracketed `[a,b]`), matched on WORKER `user_name` (case-insensitive,
  NOT company_name — customers can't self-escalate). ADMIN_USERS → allDepartmentAccess (folded into
  resolveAllDepartmentAccess, the single see-everything decision). BYPASS_USERS → allDept + new
  TenantContext.bypassRbac; registry.checkAccess short-circuits to allow when bypassRbac (skips
  audience/scope/write/department gates). Wired in chat.routes.chatContext + agent.routes.
- Tests: added bypassRbac short-circuit test (144 total green). Verified list parsing + resolveAllDepartmentAccess
  by user_name via throwaway smoke ([alice,bob] admins, carol bypass — all correct).
- OPEN / flagged for customer-facing: (1) customer path currently still accepts client-supplied
  department_scope/allDepartments/profile — for untrusted customers these must be IGNORED and scope DERIVED
  from the authenticated company id (else self-escalation). (2) "Global" (untagged) knowledge is visible to
  every scope incl. customers — audit tagging before exposing internal docs. (3) no 'customer' audience yet
  (all API_KEY callers are 'internal').

## 2026-07-02 — Agentic Core v2, M0: security & agent foundation (10 manifests, authority narrowing, customer lockdown)

Kickoff of the approved Agentic Core v2 plan (orchestrator + 10 department child agents on LangGraph,
pg-boss, agentic RAG, MinIO files, Composio browser). Decisions locked with the user: OpenAI-only for
now (Groq stays dormant), browser automation via Composio toolkits, file storage on MinIO (S3 API),
Collection added as the 10th agent. This session = M0, everything default-off / no runtime change:

- **AgentManifest layer** (`src/modules/agents/types.ts`, `manifests/*` — one file per agent,
  `agentRegistry.ts` mirroring ToolRegistry): typed manifests for customer-service, billing,
  verification, retention, sales, marketing, finance, analyst, manager, collection. Manifests declare
  departments (access grant), operatingDepartments (cross-dept cap for analyst/manager), tool
  allowlist, ragScope, readOnly, delegatesTo. `departmentAgents.ts` is now a DERIVED SHIM off the
  manifests (same exports; /v1/chat personas + applyDepartmentPolicy unchanged in behavior, policy
  extended: finance/marketing/manager tiers now grant their tools — test expectations updated).
  'marketing' added to KNOWN_DEPARTMENTS.
- **Authority narrowing** (`authority.ts`): narrowContext (child depts = caller ∩ operating; admins
  bounded to the operating list; allDepartmentAccess + bypassRbac ALWAYS dropped; sets ctx.actingAgent),
  narrowRagScope (ragScope is a cap, never a grant), effectiveRetrievalContext (what scoped RAG will use).
- **Customer-trust fix** (the 2026-07-01 OPEN item): new `routes/v1/callerIdentity.ts` with explicit
  workerContext/customerContext builders; chat.routes now uses buildCallerContext. New 'customer'
  audience (deny-by-default everywhere; knowledge.search opted in — retrieval is audience-exact so
  customers only see customer-audience docs). FF_CUSTOMER_SCOPE_STRICT (default 0 = legacy + loud
  warning listing fields that will be ignored; 1 = customer requests get viewer role, NO scopes,
  departments = company tag only, client scope/profile/user_name fields ignored). Telegram shim must
  migrate before flipping.
- **Audit attribution** (migration 0008): tool_calls + audit_log gain acting_agent + agent_run_id;
  new agent_runs table (per-run status/tokens/cost) + agentRunRepo. DispatchOptions gains
  {readOnly, actingAgent, agentRunId}; dispatcher denies non-read tools under readOnly (defense in
  depth for analyst/manager) and stamps attribution on ok/error/denied rows.
- **Injection defenses + budgets**: `security/untrusted.ts` (wrapUntrusted with delimiter-smuggling
  neutralization + control-char strip; sanitizeToolResult with truncation notice; UNTRUSTED_RULE added
  to the system prompt). Wired at boundaries: RAG grounding (chatService), web search output,
  Composio afterExecute (payload → untrusted_content). `agents/budget.ts` BudgetMeter
  (AGENT_MAX_TOOL_CALLS/COST_USD/WALL_MS env knobs) ready for the M1 run loop.
- **Tests: 216 green** (was 181). New suites: agent-registry (selection matrix incl. customer/partner
  denial), agent-authority (narrowing invariants, table-driven over all 10), caller-identity (hostile
  customer lockdown + legacy warn path), untrusted (smuggling/ANSI/canary — secret-shaped env values
  never in prompts), budget, and the headline **agent-rbac-leakage** suite (retrieval SQL never
  references foreign departments through any agent; hostile reformulation can't change the WHERE;
  dispatch-by-name denied + audited with actingAgent; read-only gate holds for admins).
- Note for later milestones: zoho_mcp.* stays admin-sentinel (unavailable inside child agents — revisit
  when Composio covers Zoho breadth); Composio output wrapping changes tool payload shape to
  {untrusted_content} — verify against live Composio in M5.

## 2026-07-02 — Agentic Core v2, M1: orchestrator runtime (POST /v1/agent, 10 compiled agents, checkpointer)

- **Compiler** (`src/modules/agents/orchestrator.ts`): AgentManifest → deepagents SubAgent per request,
  AFTER agentRegistry RBAC filtering — a sales caller's orchestrator contains only sales+marketing.
  Children get: per-agent scoped knowledge_search (effectiveRetrievalContext — the leakage-tested fn),
  registry tools (RBAC ∩ allowlist, dispatched under the NARROWED ctx captured at build time, readOnly
  + actingAgent + agentRunId stamped), webSearch (manifest.webSearch: marketing), Composio filtered by
  manifest.composioToolkits with longest-prefix toolkit matching (manager only, admin-gated; failures
  degrade — never break construction). Children return structured AgentResult (answer/citations/
  toolsUsed/confidence/escalate) via responseFormat; escalation is advisory — parent re-delegates only
  within the RBAC-filtered set. Direct-to-child mode compiles one agent, no orchestrator hop.
- **deepagents module absorbed** into `src/modules/agents/` (context/models/prompts/tools moved,
  toolCaller→agentTools, rag→scopedRag, composioTools→composio); `deepagents` pinned exact 1.10.5
  (compiler file is the single API seam). Old 4-generic-subagent stack deleted.
- **Service** (`orchestratorService.ts`): runAgentTurn/streamAgentTurn share one streamEvents
  consumption path (`streamAdapter.ts` — SSE vocabulary start/status/token/tool_call/tool_result/done
  + new `agent` {key,state} events; ONLY root tokens stream, child runs surface as progress; final =
  last root chain-end message). Persistence mirrors chatService (appendUser/appendAssistant, auto-title,
  bumpForTurn) so widget transcripts are pipeline-agnostic. BudgetMeter per run (tool calls counted in
  wrappers; cost charged from RunTracker usage); breach → friendly partial answer + audit. agent_runs
  row per run (status/model/tokens/cost/duration) + costTracker + audit `agent.turn`.
- **Durability**: `checkpointer.ts` PostgresSaver (own pg pool max 5, `langgraph` schema) behind
  FF_AGENT_CHECKPOINTS; setup() runs from scripts/migrate.ts (library owns that schema's DDL);
  threadId = tenantId:conversationId with findOwned guard. Brief builder packs date/user/departments +
  ≤600-token mechanical history summary into the HUMAN message (system prompts stay byte-stable for
  prompt caching). TTL sweep job lands with pg-boss (M2).
- **API**: POST /v1/agent {message, conversationId?, agent?, stream?} + caller-identity fields
  (shared callerIdentitySchema); /v1/agent/deep kept as deprecated alias returning {answer}.
  FF_ORCHESTRATOR_ENABLED (or legacy FF_DEEP_AGENTS_ENABLED) gates both. LANGSMITH_* env passthrough.
- **Tests: 228 green.** New: agent-compiler (per-caller subagent sets), stream-adapter (token routing,
  child silence, task boundaries, error tools), integration gate paths (404 off / 401 / 403 cross-dept
  direct-to-child / 400 unknown agent). Deferred: web app sends `agent` param (needs a web build cycle;
  /v1/chat stays the widget default until the flag flips); per-child token cost split is approximated
  at the run level (tool attribution is exact via tool_calls.acting_agent).

## 2026-07-02 — Agentic Core v2, M2: pg-boss job infrastructure (async agent runs + cron automations)

- **pg-boss 12.24.1** on the app Postgres, own self-migrating `pgboss` schema (never modeled in
  drizzle; no ordering hazard with release migrations). `src/modules/jobs/`: boss.ts (lazy singleton,
  pool max 3, dbSslOption reuse, graceful stop {graceful, close, timeout 25s} inside Render's SIGTERM
  window), catalog.ts (typed `defineJob` + zod payloads; payloads embed the caller's TenantContext
  verbatim via `tenantContextSchema` + `payloadToContext` — workers execute with EXACTLY the
  requester's authority), queue.ts (parse-before-send), scheduler.ts (idempotent cron upsert +
  stray-schedule cleanup, tz=JOBS_CRON_TZ), systemContext.ts (cron authority: department-scoped,
  admin role for write-risk notifies, NO allDepartmentAccess/bypass).
- **Deployment shape**: JOBS_WORKER_MODE=inline (default — web service runs workers in-process) |
  send-only (dedicated Render Background Worker runs `node dist/worker.js`, same image) | off.
  server.ts boots jobs after listen; shutdown order stopJobs → app.close → closeDb. `src/worker.ts`
  entry built NOW so the second-service flip is config-only.
- **Job catalog**: `agent.run` (retry 1, expire 15m, dead-letters; singleton per taskId),
  cron automations — collection debtor-sweep (weekday 08:00), retention weekly-scan (Mon 09:00),
  verification recheck-reminders (daily 07:00) — each: scoped systemContext → agent_tasks row →
  direct-to-child runAgentTurn with a canned prompt → automation_logs row → optional Telegram
  summary THROUGH dispatchTool (explicitly elevated notify ctx; audited). `maintenance.checkpoint-
  ttl-sweep` (nightly; deletes langgraph threads whose newest checkpoint ts < now-TTL). `jobs.dead`
  dead-letter sink (audit `job.dead` + mark task failed).
- **agent_tasks table** (migration 0009) + agentTaskRepo: tenant-scoped, owner-isolated listing,
  `markRunning` transitions only from queued/running/failed (re-delivered completed/cancelled jobs
  ack without re-running — the idempotency guard).
- **Routes** `tasks.routes.ts`: POST /v1/agent/tasks (fail-fast agent RBAC → row → enqueue → 202
  {taskId}), GET list/:id, GET /:id/stream (SSE row-poll 1.5s, 10m cap, keep-alive comments),
  POST /:id/cancel (row transition authoritative + best-effort boss.cancel), GET /agent/jobs/stats
  (allDepartmentAccess only; pgboss.job counts + recent failures via validated schema identifier).
- **Tests: 236 green.** jobs-catalog (cron↔queue integrity, payload round-trip preserves authority
  verbatim, payloadToContext strips explicit-undefineds, malformed rejected), systemContext scoping,
  integration 503/401 gates. NOTE: no live pg-boss lifecycle test — deliberately not pointed at the
  Render DB; M2 smoke happens in dev per plan (docker Postgres) before flipping FF_JOBS_ENABLED.

## 2026-07-02 — Agentic Core v2, M3: agentic RAG (hybrid RRF + retrieval loop + citations)

- **Hybrid retrieval** (migration 0010): `knowledge_chunks.content_tsv` STORED generated tsvector
  column (drizzle `generatedAlwaysAs` + customType) + GIN index. New `repos/knowledgeSearchRepo.ts`:
  buildVectorQuery/buildFullTextQuery (websearch_to_tsquery + ts_rank_cd) — BOTH legs reuse the now-
  exported `departmentFilter` chokepoint + tenant/audience predicates, join knowledge_docs for titles.
  `resolveRetrievalContext(ctx, scope)` = intersection-only cap (bounds admins to the cap list).
- **Agentic loop** `modules/knowledge/agentic/`: queryPlanner (1–3 sub-queries + sufficiency judge —
  BOTH degrade safely: planner→original question, judge→sufficient), hybrid.ts (parallel legs per
  sub-query, RRF fuse 1/(K+rank), dedupe across hops; full-text leg degrades to vector-only on
  error/flag-off), rerank.ts (optional listwise LLM rerank, FF_RAG_RERANK), loop.ts (plan → retrieve →
  top-score short-circuit (RAG_SUFFICIENT_SCORE≈rank-1-both-legs) → judge → refine ≤ RAG_MAX_HOPS;
  sets suggestWebSearch for the CALLER to decide), citations.ts ([S1..Sn] markers + cite-instruction
  OUTSIDE the UNTRUSTED wrapper).
- **Wiring**: chatService.retrieveGrounding honors FF_AGENTIC_RAG (lazy import); scopedRag honors it
  per child agent (retrieval ctx unchanged — effectiveRetrievalContext already encodes the cap) and
  surfaces a thin-coverage hint. Flags default OFF: FF_RAG_HYBRID, FF_AGENTIC_RAG, FF_RAG_RERANK —
  flip after evalRetrieval in dev.
- **Eval harness**: `scripts/evalRetrieval.ts` + `tests/fixtures/retrieval-corpus.json` (10 docs
  across 8 dept tags + Global, 10 labeled queries) → recall@6/MRR for single-shot vs hybrid vs
  agentic against a dev DB (checksum-idempotent ingest; requires OPENAI + DB, run manually).
- **Tests: 244 green.** hybrid-retrieval suite: cap semantics (never widens, bounds admins), both
  legs' SQL scoping under a hostile reformulated query (query string is a PARAMETER, dept params stay
  the caller's), RRF fusion math/determinism, full-text degradation, grounding-block markers.
- Deferred/noted: citation objects aren't yet persisted to message metadata (markers live in the
  grounding block; the model cites [Sn] in its answer text) — revisit with the web app citations UI.

## 2026-07-02 — Agentic Core v2, M4: files on MinIO (generate + analyze + routes + Telegram delivery)

- **Storage**: `modules/files/storage/` ObjectStorage interface + S3 adapter (@aws-sdk/client-s3,
  forcePathStyle for MinIO; R2 swap = env-only: S3_ENDPOINT/S3_REGION=auto/S3_FORCE_PATH_STYLE=0).
  Lazy singleton + setStorageForTests seam. Keys: `<tenant>/<kind>/<yyyy-mm>/<fileId>/<name>`
  (sanitized, no '..'). getBuffer enforces PARSE_MAX_BYTES via HEAD + stream cap.
- **Catalog**: `file_assets` (migration 0011) + fileRepo — visibility mirrors knowledge RBAC
  (NULL-dept tenant-global OR caller dept OR ownership OR allDepartmentAccess; exported
  fileVisibilityFilter for SQL assertions). storeFile: size caps, customer callers NEVER set
  department tags (owner-scoped only), audit `file.store`/`file.delete`.
- **Generation** (riskClass 'read' — the plan-ratified deviation, commented in code):
  file.generate_csv (csv-stringify, 100k-row cap), file.generate_excel (exceljs, per-sheet specs),
  file.generate_pdf (pdfkit, structured title/sections/tables spec, 2k-row guard), file.get_link.
- **Analysis**: parse/ (unpdf 200-page cap, exceljs 50k-row, csv-parse, mammoth docx, text;
  2M-char extract cap) → file.analyze (read; optional question → one LLM pass over UNTRUSTED-
  wrapped content) + file.ingest_to_knowledge (WRITE, admin-sentinel; non-admins can only tag
  their own departments; >2MB routes through new `knowledge.bulk-ingest` pg-boss queue with
  agent_tasks tracking — finally unlocks pdf/xlsx/docx → RAG).
- **Exposure**: FILE_TOOLS (5 read tools) added to ALL 10 manifests (registered only when
  FF_FILES_ENABLED, inert otherwise); tool registration flag-gated in tools/index.ts so tool
  counts/tests unchanged with the flag off. Routes `/v1/files` (multipart upload w/ per-route cap,
  list, metadata, presigned download, delete; global multipart ceiling raised to FILE_MAX_SIZE_MB).
  telegram.send_document now accepts `fileId` (RBAC-checked fresh presign; requires MinIO to be
  publicly reachable for Telegram fetches — else fall back to a URL upload later).
- docker-compose: added `minio` service (console :9001; bucket `octane-files` created via console).
- **Tests: 258 green.** files (generators round-trip via exceljs/csv-parse/%PDF header, caps,
  key sanitization, hostile customer department tag ignored), file-rbac (visibility SQL scoping +
  ownership escape hatch; file tools available to every real department; ingest stays admin-sentinel).
