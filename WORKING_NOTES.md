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

---

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

## 2026-07-02 — Agentic Core v2, M5: browser automation via Composio + hygiene

- **browserTools.ts** (agents/tools): Composio-backed browser/scrape tools behind FF_BROWSER_ENABLED
  + the existing admin gate. Toolkit universe = COMPOSIO_BROWSER_TOOLKITS (default FIRECRAWL; add the
  Composio Browserbase toolkit slug for interactive sessions AFTER verifying it in the dashboard).
  Guardrails all fail-closed: beforeExecute domain allowlist over every URL-ish arg (suffix match,
  lookalike-host safe; EMPTY BROWSER_ALLOWED_DOMAINS = deny all navigation), interactive write verbs
  (navigate/click/fill/type/press/act/…) dropped unless FF_BROWSER_WRITES, per-toolkit in-memory
  token bucket (COMPOSIO_RATE_PER_MIN), audit + UNTRUSTED wrap via the shared afterExecute hook.
  Exposed via new manifest capability `browser: true` — marketing only at launch.
- **Composio hygiene**: buildComposioToolsFor now fetches PER TOOLKIT (one chatty toolkit can't crowd
  others out of COMPOSIO_TOOL_LIMIT; per-toolkit failures skip, not break), takes optional extra
  beforeExecute (the domain gate composes after the rate check), and requireEnabled opt-out for the
  browser universe. security/rateBucket.ts = minimal sliding-window limiter (no Redis by design).
- Web search complement: FIRECRAWL arrives through this same path — enabling it for search-grade
  scraping = connect the key in the Composio dashboard; no code change (verbs are read-class).
- **Tests: 265 green** — allowlist deny-by-default + suffix/lookalike cases, nested URL extraction,
  write-verb classification, flag-off no-op, rate bucket window behavior.

## 2026-07-02 — Agentic Core v2, M6: write approvals, agent memory, knowledge freshness, golden policy suite

- **Write approvals (FF_WRITE_APPROVALS — unlocks agent writes safely)**: migration 0012 `approvals`
  table + approvalRepo (pending→approved/denied once, TTL 24h, hourly expiry cron). dispatchTool
  gains `viaAgent`: agent-proposed non-read tools park as pending approvals AFTER checkAccess (an
  agent can't queue what its principal couldn't do — approval is a gate, never authority); the model
  receives {pendingApprovalId, message}. agentTools wrappers set viaAgent — direct API/admin usage
  untouched. `/v1/approvals` (admin-only): list, approve → approvalExecutor re-builds the PROPOSER's
  snapshot ctx, re-runs checkAccess (policy drift), dispatches with original attribution, records
  executed/failed; deny. Decisions only via authenticated HTTP (never Telegram callbacks).
- **Agent memory (FF_AGENT_MEMORY)**: migration 0013 `agent_memories` (embedding+HNSW, importance,
  per-user, dept-scoped like knowledge; deliberately NOT knowledge_docs — model-generated text stays
  UNTRUSTED + decays). memoryRepo (search bumps access stats; evictBeyondCap 500/(agent,dept);
  decayAndEvict exp half-life, drop <0.05). agents/memory.ts: end-of-turn distillation (≤3 durable
  facts, fire-and-forget) + recall appended to scoped RAG output inside UNTRUSTED source=memory
  ("do NOT cite as knowledge"). Nightly `maintenance.memory-decay` cron.
- **Knowledge freshness**: migration 0014 knowledge_docs origin/effective_at/expires_at/
  last_verified_at. Staleness computed AT QUERY TIME in both hybrid legs (no scan job needed):
  stale = past expiry OR unverified > STALE_DOC_DAYS (180) → half weight in RRF fusion + "may be
  outdated" in citation headers. POST /v1/knowledge/docs/:id/verify resets last_verified_at.
  Deferred: FF_INGEST_AUTOTAG auto-tagging (suggestion-only feature — later).
- **Golden policy suite** (tests/unit/agent-golden.test.ts): locks per-agent posture — exact bound
  registry tools under the agent's own-department caller, effective RAG departments, read-only set
  == {analyst, manager}, valid delegatesTo, non-trivial personas; adding an AGENT_KEY without a
  golden record fails CI. Behavioral scripted-model evals deferred to scripts/evalLive (follow-up).
- **Tests: 281 green** (approvals park/deny-before-park/legacy-off/executor-outcome included).

## 2026-07-02 — Agentic Core v2: adversarial review fixes (8 confirmed defects)

Ran an 11-agent adversarial review (3 dimensions × find→verify) over the M0–M6 build. 8 confirmed
defects fixed (all flag-on production issues; tsc+281 tests had passed but didn't cover these):

- **[CRITICAL] file cross-customer leak** (fileRepo/file_assets/fileService): file_assets had NO
  audience column and customer uploads stored dept=NULL (global), so the isNull(dept) visibility
  branch let any customer read any other customer's + internal files. Fix: added `audience` column
  (migration 0015), visibility now ALWAYS partitions by audience, and customers get OWNERSHIP-ONLY
  visibility (no global branch). storeFile stamps ctx.audience; markDeleted audience-scoped.
- **[CRITICAL] pg-boss dead-letter ordering** (boss.ts): createQueue in ALL_JOBS order created
  'jobs.dead' LAST, but v12 validates the deadLetter target exists first → deterministic crash-loop
  on first FF_JOBS_ENABLED boot. Fix: create dead-letter target queues before their referrers.
- **[MAJOR] read-only agents got Composio/browser writes** (orchestrator/composio/browserTools):
  manager (readOnly) received Composio write tools when FF_COMPOSIO_WRITES on, bypassing the
  dispatcher readOnly gate + approvals (Composio executes remotely). Fix: buildComposioToolsFor +
  buildBrowserTools take `readOnly` → strip write tools at binding regardless of the flag; orchestrator
  passes manifest.readOnly. Also fixed a latent bug: browser path now sets requireEnabled:false so
  FIRECRAWL isn't intersected away by the org toolkit list.
- **[MAJOR] budget/recursion unbounded** (orchestratorService/scopedRag): manifest.maxIterations was
  never applied (deepagents default ~unbounded) and budget breaches were swallowed. Fix: wire
  recursionLimit (child cap direct; orchestrator = 2×cap+6), unwrap wrapped BudgetExceededError via
  the cause chain, and count scopedRag calls against the tool-call budget.
- **[MAJOR] FF_JOBS_ENABLED bypassed the orchestrator gate + auto-ran LLM crons** (tasks.routes/
  scheduler): /v1/agent/tasks ran full agent turns and department cron automations DM'd Telegram with
  only FF_JOBS on. Fix: POST /agent/tasks now also requires FF_ORCHESTRATOR_ENABLED; applySchedules
  gates the 3 department automations on the orchestrator flag (maintenance crons always run).
- **[MAJOR] checkpointer schema not in deploy path** (checkpointer): setupCheckpointer only ran from
  scripts/migrate.ts, which isn't in the runtime image → 42P01 on every turn with FF_AGENT_CHECKPOINTS
  on. Fix: ensureCheckpointerReady() — idempotent, memoized setup() called before the first
  checkpointed run.
- **[MAJOR] agentPath always empty** (streamAdapter): subagentTypeOf only matched an object task
  input, but streamEvents v2 emits data.input={input:'<json string>'} → no `agent` SSE events, empty
  agentPath. Fix: parse the stringified form too.
- Tests: 289 green (+ composio-tools, jobs-queue-order, customer file-isolation, stringified-task
  stream cases). Migration 0015 (file_assets.audience).

## 2026-07-02 — Rollout: migrations applied + feature flags enabled (files/jobs held)

- **Migrations 0008–0015 applied to the app Postgres** (MYTRION_OPS_DATABASE_URL) via `pnpm db:migrate`
  (user-approved). Verified live: new tables agent_runs, agent_tasks, file_assets, approvals,
  agent_memories; new columns file_assets.audience, knowledge_chunks.content_tsv,
  tool_calls.acting_agent, knowledge_docs.last_verified_at. DWH untouched.
- **render.yaml: enabled 6 flags** as explicit envVars (override the env group):
  FF_ORCHESTRATOR_ENABLED, FF_RAG_HYBRID, FF_AGENTIC_RAG, FF_BROWSER_ENABLED, FF_WRITE_APPROVALS,
  FF_AGENT_MEMORY.
- **Held FF_JOBS_ENABLED** (excluded per request) and **FF_FILES_ENABLED** — the latter would crash
  boot (assertRuntimeSecrets requires S3_ENDPOINT/ACCESS_KEY_ID/SECRET_ACCESS_KEY/BUCKET, none set).
  To finish files later: add S3_* (MinIO) to the octane-assistant-secrets env group, then set
  FF_FILES_ENABLED=1. FF_AGENT_CHECKPOINTS left off (not requested).
- Pre-deploy setup still needed for browser to FUNCTION (not a boot blocker): real COMPOSIO_API_KEY
  + BROWSER_ALLOWED_DOMAINS in the env group (empty allowlist = deny-all, fail-closed).
- Note: FF_AGENTIC_RAG enabled without running scripts/evalRetrieval.ts against prod on purpose —
  that harness ingests 10 fixture docs and would pollute the live knowledge base; run it against a
  scratch/dev DB to measure recall before relying on hybrid quality.

## 2026-07-02 — Live end-to-end test (admin scope, real backends) + recursionLimit fix

Ran the API locally (flags on) against real OpenAI + app DB + servercrm with admin scope. Verified:
- **RAG**: /v1/chat grounded a billing question in 6 real KB passages (agentic hybrid loop, FF_AGENTIC_RAG+FF_RAG_HYBRID on).
- **Orchestrator**: /v1/agent delegated to the verification child (agentPath=["verification"] — confirms the streamAdapter stringified-task fix), which called scoped knowledge_search and synthesized a grounded answer.
- **Operational read tool**: direct-to-child billing agent dispatched agent.debtors → servercrm (real HTTP; returned "agent not found" for the fake admin name, handled gracefully). tool_calls.acting_agent="billing" recorded.
- **Agent-selection RBAC**: sales-scoped caller → finance agent = 403 RBAC_DENIED (pre-LLM). Non-admin → /v1/approvals = 403; admin = 200 (0 pending — read-only launch posture, no write tools bound to agents).
- **Persistence**: agent_runs rows with token/cost attribution; 3 agent_memories distilled (FF_AGENT_MEMORY); tool_call attribution.

**Bug found + fixed (live test):** recursionLimit was mapped 1:1 from AGENT_MAX_CHILD_ITERATIONS(8),
but LangGraph counts every graph super-step (model/tool/deepagents-middleware nodes), so a single
child agent hit "Recursion limit of 8" before finishing one tool round. Fixed: recursionLimit =
childCap*5+10 (single) / childCap*6+24 (orchestrator); the BudgetMeter (tool-call/cost/wall) remains
the real runaway guard. Re-tested green; 289 unit tests pass.

## 2026-07-02 — Real use case: servercrm client self-service tools + owner-scoping + dynamic-UI picker

Mapped the self-service widget's automation blocks + servercrm to AI agent tools. First slice = the
owner-scoped READ tools every sales/customer-service agent uses to serve THEIR OWN clients by carrier,
plus the "which client?" generative-UI flow. Grounded in a live exploration of zoho-octane
(app/self-service automation blocks: C-8 balance, C-28 account status, C-24 cards, C-15 transactions,
Q-2 payment info; department codes C/Q/V/M) and servercrm (/api/clients/by-agent/:zohoUserId roster;
/api/agent/dwh/carrier-*).

- **New tools** (`tools/definitions/servercrm_client.ts`, all read, servercrm:read):
  crm.list_my_clients, crm.pick_my_client (server-built picker), crm.carrier_balance (C-8),
  crm.carrier_overview (C-28), crm.list_cards (C-24), crm.transactions (C-15), crm.payment_info (Q-2).
  Added to the sales + customer-service manifests (+ CLIENT_SERVICE_RULE persona).
- **OWNER-SCOPING (security-critical, per user)**: the picklist comes ONLY from the caller's own
  zoho_user_id (ctx.userId `zoho:<id>` → /api/clients/by-agent/:id) — an agent NEVER sees another
  agent's carriers. Every carrier-keyed tool calls `assertCarrierOwned(ctx, carrierId)` first
  (targeted by-agent lookup); non-owned → RBACError. Admins (allDepartmentAccess) bypass. servercrm
  does NOT enforce this — our layer does. `fetchAgentRoster` coerces servercrm 0/1 flags → booleans.
- **Dynamic-UI elicitation** (`agents/elicitation.ts`): a tool that needs a choice returns an
  `elicitation` field; the per-agent tool wrapper stashes it into the run's ElicitationHolder;
  orchestratorService surfaces it on AgentTurnResult.elicitation + an `elicitation` SSE event.
  crm.pick_my_client builds the options SERVER-SIDE (model passes only an optional search) — no
  model-copied option arrays. States: resolved (1 match → carrier_id) / choose (picklist shown) /
  too_many (>25 → ask to narrow) / none. Generic ui.request_choice kept (universal) but removed from
  the sales/CS flow so the model can't re-present with invented options.
- **Live-tested (sales agent Frank Harrison, real servercrm)**: named client → resolve → REAL balance
  (ALI CARGO INC: EFS $1,000, limit $3,000, used $303.09, remaining $2,696.91); ambiguous "ALI" → REAL
  server-built picklist (ALI CARGO INC/5816381, ALI FAMILY TRUCKING/5759008, ALITRANS LLC/5772232, …);
  foreign carrier 5794015 (another agent's) → DENIED + audited ("not in your client list"). 299 tests.
- Bugs caught + fixed by live testing: empty-string optional params abort LangChain pre-handler
  validation (relaxed schemas); servercrm booleans-as-numbers broke output validation (toBool coerce);
  model hand-copying 70 options → hallucinated picklist (switched to server-built crm.pick_my_client).
- Writes (card activation/limits/override, money code, WEX BOCA) deferred → they go behind the M6
  approval flow. UI rendering of the picker is the frontend's job (later); backend contract is done.

## 2026-07-03 — Auth architecture: Zoho OAuth worker sign-in (session-authoritative RBAC)

Set up portal auth: workers sign in with their own Zoho account (authorization-code flow, backend is
the confidential client). All gated behind `FF_ZOHO_OAUTH_ENABLED` (default off). Client login/password
(Type 2) intentionally NOT built yet.

- **env** (`config/env.ts`): `ZOHO_SERVER_CLIENT_ID` / `ZOHO_SERVER_CLIENT_SECRET` (separate "server"
  app from the tool-integration Zoho creds), `ZOHO_OAUTH_REDIRECT_URI` (default `http://localhost:5173`,
  must byte-match the Zoho console), `ZOHO_OAUTH_SCOPES` (default `ZohoCRM.users.READ`), flag
  `FF_ZOHO_OAUTH_ENABLED`. assertRuntimeSecrets requires the two secrets + JWT_SECRET when the flag is on.
- **Flow**: SPA `GET /v1/auth/zoho/login` → `{authorizeUrl, state}` (state = short-lived signed JWT, CSRF)
  → browser to Zoho → back to the SPA origin with `?code&state` → SPA relays to `POST /v1/auth/zoho/callback`
  → backend verifies state, exchanges the code (server-side w/ client_secret), reads CRM `CurrentUser`
  (id/name/email/profile/role), and mints a Bearer session (`integrations/zohoOAuth.ts`,
  `modules/auth/zohoAuthService.ts`).
- **Session-authoritative identity (the security win)**: the access token carries a verified
  `worker` claim (`jwt.ts` `WorkerIdentity`); `contextFromClaims` builds a ctx with `sessionVerified:true`,
  `userId=zoho:<id>`, and `allDepartmentAccess` derived from the VERIFIED Zoho profile — never from the
  request body. `buildCallerContext` short-circuits on `sessionVerified`: ALL client-supplied identity
  (zoho_user_id/user_name/profile/role/allDepartments) is ignored; only the department VIEW
  (`department_scope`) is honored, and only for non-all-access workers. Closes the self-escalation hole
  the old "advisory URL identity" model had. `refresh` re-issues worker sessions from the token (no
  users-table row for a `zoho:<id>` principal).
- **Guard**: new `plugins/combinedAuth.ts` decorates `sessionOrApiKey` (Bearer session → verified ctx,
  else falls through to the static API_KEY → system identity). Backward-compatible with
  `Authorization: Bearer <API_KEY>`. All caller routes (chat/agent/tasks/files/approvals/knowledge/scope/
  money-codes/automation) switched `apiKeyAuth` → `sessionOrApiKey`. `/auth/me` returns the worker
  identity for verified sessions (no user lookup).
- **Frontend** (`apps/mytrion-crm`): `api/session.ts` (token store), `api/auth.ts` (begin/complete/logout),
  transport sends `Authorization: Bearer` with a deduped refresh-on-401 retry (`stream.ts` too);
  `UserContextProvider` rewritten as an auth boot state machine (complete callback → resume session →
  dev-mock → login gate); `LoginGate` "Sign in with Zoho"; TopBar sign-out. Identity now derives from
  the verified session, not spoofable URL params. Dev bypass: `VITE_DEV_MOCK_AUTH=1`.
- Tests: `tests/unit/zoho-oauth.test.ts` (worker-claim round-trip, oauth-state sign/verify + negatives,
  contextFromClaims worker branch, startLogin URL) + session-authoritative cases added to
  `caller-identity.test.ts`. Full suite green: 312 tests. lint/typecheck/build clean.

## 2026-07-03 — Chat → agent runtime, Sales agent hardening, admin "act as agent"

Fixed the "typing hi does slow RAG" report + made the Sales agent capable/grounded (commit 612d887).

- **Root cause**: chat UI posted to single-agent `/v1/chat/stream`, which ran `retrieveGrounding`
  UNCONDITIONALLY every turn (planner + multi-query embeds + hybrid SQL + judge) — even for "hi".
- **Fix (Part A)**: chat now streams through `/v1/agent` (orchestrator runtime) where RAG is the
  model-invoked `knowledge_search` tool → a greeting does ZERO retrieval. Dept Mytrions send
  `agent:<key>` (direct-to-child); admin sends none (orchestrator). `stream.ts` generalized
  (`streamAgent`, `agent`/`elicitation` events, token `delta ?? text`); `agentKeyFor(id)` maps
  Mytrion→AGENT_KEY (admin→null; fixes management→manager). `/v1/chat` kept as fallback (`VITE_USE_AGENT=0`).
  Verified live: "hi" → no tool_call; policy Q → `knowledge_search` fires, grounds, cites docIds.
- **Sales agent (Part B)**: enriched byte-stable persona (`OCTANE_CONTEXT`/`OWNER_SCOPE_RULE`/
  `RAG_USAGE_RULE` in shared.ts + a Sales capability catalog). `RAG_USAGE_RULE` now MANDATES grounding
  policy/procedure via knowledge_search (no answering from memory → cites or says "not documented").
  Model = `gpt-5.4-mini` (manifest.model, Sales only). `FF_AGENTIC_RAG=0` → single-pass kNN over
  Global∪Sales. `docs/knowledge/sales/sales-playbook.md` ingested to the `sales` namespace (7 chunks).
- **Admin "act as agent" (Part C)**: `GET /v1/admin/agents` (allDepartmentAccess-gated) lists active
  Sales-profile CRM users via `zohoCrm.listActiveUsers` (Zoho Users API, `?type=ActiveUsers`, env
  `SALES_AGENT_PROFILE_NAMES`/`_ROLE_NAMES`, `?all=1` bypasses filter). `buildCallerContext` honors
  `x-act-as-*` headers for a verified admin → runs AS the rep (owner-scoped), records
  `impersonatorUserId` for audit. Frontend: `ImpersonationProvider` + TopBar `ActAsPicker` + transport
  attaches `x-act-as-*` on every request (`impersonate:false` for the picker fetch itself).
- **Note (local env)**: `.env` has DUPLICATE `API_KEY` and `OPENAI_API_KEY` entries — worth cleaning up.
- 313 tests green; lint/typecheck + backend & frontend builds clean.

## 2026-07-03 — Apply the MytrionPolish design system (colors, app shell, AI chat, admin)

Applied the delivered design system (`~/Desktop/MytrionPolish`: DESIGN_SYSTEM.md + .dc.html mockups)
to `apps/mytrion-crm`. Commits e20f14a → f3d7945 → ec2172c.

- **Tokens (e20f14a)** — `theme.css`: softer "Soft Midnight" surfaces (bg #12161e / surface #1b212c /
  rails #13171f) + NEW scales: type (`--text-2xs…3xl` + `--lh-*`/`--fw-*`), spacing (`--space-*` 4px),
  status tints (`--tint-*` via color-mix), motion (`--dur-*`/`--ease-*`), z-index, `--radius-xs`.
  `global.css`: bridged tints/radius into `@theme`; reconciled per-module accents (sales→blue #4d9dff,
  verification→indigo #6d7cff, admin cyan + manager teal); global `:focus-visible`, `::selection`,
  `prefers-reduced-motion` killswitch. `mytrions.config`: collection/retention/verification → `ported`.
- **Shell + chat (f3d7945)** — MytrionShell rail active state = soft accent square + 2px inset accent
  bar; TopBar tokenized + sign-out danger hover; ChatPanel/Composer/MessageList/MessageBubble tokenized
  (composer pill radius-lg + focus glow + 30px accent send; tool-chip tone recipe; gem thinking dots).
- **Admin (ec2172c)** — new shared `admin/admin.module.css`; rail now switches panels (was a dead TODO):
  Knowledge Base (stat tiles + grid table + status pills), Train (sources + run form + active-run),
  Knowledge Browser (search + filter chips + scored result cards), Octane-Scope (lifecycle stepper +
  stage detail w/ Blueprint/Departments/Automations/Details). All mock data.
- Design extracted from the (large) mockups via two read-only sub-agents; exact token CSS pulled
  verbatim from `Design System.dc.html`. Fonts still CDN (self-hosting deferred — no font files).
  Remaining for the full "polish every page" brief: the 8 non-admin module pages + shared primitives.

## 2026-07-06 — Agentic-core hardening pass (backend + web + evals) — branch feature/agentic-hardening

Full review/hardening of the agentic core per the approved plan (~/.claude/plans/please-review-and-harden-golden-spark.md).
Five commits: cf3c65e (llm reliability) → b0a5457 (RAG/stream) → 8bd9797 (RBAC) → b916125 (evals) → 1473d50 (web).

- **LLM reliability (P1)** — new `modelParams.ts` (reasoning-tier detection: gpt-5*/o* get
  `max_completion_tokens`, NO temperature — fixes the live Sales `gpt-5.4-mini` + `temperature:0`
  rejection); output caps + client timeouts everywhere (`OPENAI_TIMEOUT_MS`/`AGENT_MODEL_TIMEOUT_MS`/
  `*_MAX_OUTPUT_TOKENS`); wall-clock budget is now a REAL abort (AbortController → streamEvents
  `config.signal`); `computeCost` charges unknown model ids at conservative gpt-4o rates (warn once)
  instead of silently disabling `AGENT_MAX_COST_USD`; `gpt-5.4-mini` pricing corrected to $0.75/$4.50;
  `fetchWithTimeout` on serverCrm/zohoCrm/zohoOAuth (cmp/telegram/desk/people = follow-up chore).
- **Agentic RAG + stream contract (P2)** — sufficiency judge is strict (`=== true`; parse failure ⇒
  insufficient — a dead judge can no longer certify coverage); embed batching (`EMBED_BATCH_SIZE`);
  post-hoc citation validation (`citationCheck.ts`): hallucinated `[Sn]` markers are stripped from the
  canonical `done.message`, validated sources returned. SSE additions: `agent` events carry `label`,
  live `context {passages, citations}` from knowledge_search, `done` carries `ragPassages` + `citations`
  (+ agentKey/agentPath as before), Composio construction failures emit `status {state:'degraded'}` +
  audit. Brief window 3 turns/3600 chars; unused tiktoken dep dropped (char heuristics documented).
- **RBAC role model (P3)** — role is DERIVED from the verified Zoho profile. New `worker` role (read
  scopes only) for non-admin-profile workers — the registry write gate is now real for them; derivation
  applied at mint/verify/refresh so STALE pre-fix `role:'admin'` tokens re-verify as worker on deploy
  (no re-login). Act-as targets verified server-side against a cached CRM directory
  (`actAsDirectory.ts`) — `x-act-as-profile/role/user-name` headers ignored, impersonation runs with
  the TARGET's authority, fail-closed + audited. `FF_CUSTOMER_SCOPE_STRICT` default flipped to 1 (env
  override = rollback until the Telegram shim stops sending worker fields). New `FF_WORKER_DEPT_STRICT`
  (default 0) bounds worker departments by profile — enable after validating the profile→department
  mapping against the live Zoho roster. Residual: the static API_KEY path stays role admin
  (trusted-frontend anchor) — next hardening target once all worker traffic is on sessions.
- **Evals (P4)** — `scripts/evalLive.ts` finally exists (was the deferred follow-up): 38 golden tasks
  (routing/greeting/refusal/grounding/tool-selection/delegation/rbac) through the REAL `runAgentTurn`
  against real OpenAI + a dev DB; deterministic checks (routes/tools/agentPath⊆RBAC) outrank the
  gpt-5.4-mini judge (byte-stable rubrics, reference passages in-context, 3-vote majority on
  grounding/rbac); thresholds gate exit (rbac/greeting 1.0, routing ≥0.9, grounding ≥0.8); ~$0.2-0.3/run,
  suite cap `EVAL_MAX_COST_USD`. **Refuses non-localhost DBs** unless `EVAL_I_KNOW_THIS_IS_NOT_PROD=1`
  (it writes conversations/agent_runs + ingests fixtures) — local `.env` points at Render prod, so the
  BASELINE RUN IS STILL PENDING: point `MYTRION_OPS_DATABASE_URL` at a scratch DB and run
  `pnpm eval:live`, then record per-category rates here. CI-safe subset `agent-scripted-turn.test.ts`
  drives the real graph with a `ScriptedChatModel` (greeting short-circuit, delegation round-trip incl.
  the ToolStrategy `extract-N` handshake, runtime tool-binding golden, budget/recursion trips, pre-model
  RBAC) — runs in `pnpm test`, no key/DB.
- **Web chat (P5)** — vitest+jsdom+RTL inside `apps/mytrion-crm` (37 tests, now in CI); Stop generation
  (composer morph + Esc, partial kept); typed 429/5xx/network errors + per-message Retry; scroll
  anchoring (no mid-read yank + jump button); sanitized markdown (react-markdown/remark-gfm/
  rehype-sanitize); ErrorBoundaries (root / per-Mytrion keyed with chunk-reload / chat dock);
  history overlay in the dock + restore-last-conversation per user; persistent answered-by chip with
  handoff trail + expandable sources (degrades to count-only against older backends); aria-live status,
  role=log/alert, elicitation focus mgmt + real multiSelect; mobile dock height bound (70dvh) + 16px
  composer font (<640px).
- Housekeeping: `.env` duplicate `API_KEY`/`OPENAI_API_KEY` removed (identical values; dotenv used the
  first anyway); CI also typechecks+tests the web app.
- **State: 363 backend + 37 web tests green; lint/typecheck/builds clean.** Live smokes pending (need a
  non-prod DB): eval baseline (above), and a manual streamed turn to verify the gpt-5.4-mini param fix +
  citations end-to-end. Rollout order for prod: P1/P2 are safe immediately; before deploying P3, audit
  `tool_calls` for non-read calls by non-admin workers (they lose write access BY DESIGN) and confirm
  the Telegram shim sends only carrier_id/chat_id (or set FF_CUSTOMER_SCOPE_STRICT=0 temporarily);
  enable FF_AGENT_CHECKPOINTS=1 in staging when convenient (multi-turn agent context).

## 2026-07-07 — Admin wired live (agent-scope port) + Carrier User Management + client login

Ported ALL functionality from the Zoho "Agent Scope" widget (~/Desktop/Octane-Project/zoho-octane/app/agent-scope)
into the Mytrion Admin, wired to our own API (prod: same-origin session Bearer; dev: VITE_API_URL + VITE_API_KEY —
same key model as the widget's MYTRION_OPS_API_URL/KEY org variables). Branch build.

- **Admin tabs now LIVE** (were all mock): Knowledge Base (GET /knowledge/stats + /docs; row click →
  detail modal with metadata + embedded-chunk inspector via /docs/:id/chunks — the widget's "JSON
  contents" view; Mark verified; Delete), Train (dropzone .md/.txt/.json ≤1MB ≤20/batch → POST
  /knowledge/embed per file with normalized department tag + preset chips; idempotent skip; paste-text
  card; result tally; KB remounts after a run), Knowledge Browser (POST /knowledge/query with
  department chips incl. Global; doc-title resolution; latency), Octane-Scope gains a live "Risk
  Items" sub-tab (Blockers/Red Flags/Manual CRUD on /scope/risks; intake nodeIds match the widget's —
  lead-generation/lead-cycle/wex-cycle/deal-cycle — so both UIs edit the SAME records). AI Chat: the
  docked ChatPanel already covers the widget's chat (streaming + conversations) — nothing to port.
- **Carrier User Management (new tab)** — carrier_users table (migration 0016; separate from internal
  users on purpose), carrierUserRepo, /v1/carrier-users CRUD (role-admin gate: static API key +
  admin-profile workers pass, 'worker'-role sessions 403; bcrypt via hashPassword; audited
  admin.carrier_user.*; password never echoed/logged). UI: table (Carrier Id, Application Id, Login,
  Agent (Zoho user via /admin/agents datalist w/ manual fallback), Profile, Status, Last login) +
  create form with password generator (shown once), reset-password / disable / delete actions.
- **Carrier-client login** — POST /v1/auth/client/login (FF_CLIENT_LOGIN_ENABLED, default 1) mints a
  LOCKED-DOWN customer session: audience 'customer', viewer role, NO scopes, departments = carrier/
  application tags from the signed client claims; buildCallerContext returns the base ctx untouched
  for customer sessions (body identity/act-as fully inert); refresh re-checks the row is still active
  (disable kills sessions within one access-token TTL). /client page wired (own localStorage session,
  octane.clientSession.v1) — ready for the Telegram mini-app.
- **Adversarial review workflow (3 reviewers → 14 findings → 13 confirmed, all fixed)**. Highlights:
  (1) SECURITY: conversation CRUD trusted body zoho_user_id / fell back tenant-wide — a client session
  could read/rename/delete ANY conversation. Fixed: verified non-admin sessions are owner-locked to
  the token identity (conversationOwner helper); admin/API-key behavior unchanged. (2) SECURITY:
  knowledge + scope routes were reachable by customer sessions → audience gate (internal/partner).
  (3) /knowledge/query now honors departmentAccess as a NARROWING filter (admin sessions carry
  allDepartmentAccess, so the browser chips were a silent no-op in prod). (4) Train's 10MB cap lied —
  /knowledge/embed caps content at 1M chars / 2MB body → 1MB + honest copy. (5) 'ceo' added to
  ADMIN_PROFILE_MARKERS (frontend admits CEO to Admin; backend derived 'worker' → 403s). Plus React
  fixes: modal Escape/focus/role + drag-close guard, browser titles ref→state, RiskItems error/draft
  reset, agent-picker id resolution at submit time, dropzone keyboard/running guards.
- **Tests: 384 backend (21 carrier: admin gate, hashed create, no-hash echo, audit redaction, login
  lockdown incl. buildCallerContext spoof matrix, refresh-after-disable, containment: client session
  403 on knowledge/scope + owner-locked conversation read/delete for clients AND non-admin workers)
  + 37 web green; lint/typecheck/builds clean.**
- Deploy notes: run `pnpm db:migrate` (0016_carrier_users) on deploy; FF_CLIENT_LOGIN_ENABLED=0 is the
  kill switch; ADMIN_PROFILE_MARKERS env override wins over the new default if set in Render.

## 2026-07-07 (2) — Enriched audit trail + Audit Log tab in Mytrion Admin

"Which user (name/id/profile/role) — or which carrier COMPANY — pressed what, when", for internal
workers and client users alike, visible in the Admin.

- **audit_log identity columns (migration 0017)**: user_name, profile, caller_role (Zoho role),
  role (internal RBAC role), company (carrier/application tags for customer-audience actors),
  impersonator_user_id (promoted from detail jsonb). `auditFromContext` now stamps ALL of them from
  the session context automatically — so every existing call site (toolDispatcher tool.call,
  orchestratorService agent.turn/select, chatService, approvals, knowledge.embed, carrier_user.*)
  got the enrichment for free. Client sessions carry `profile` in their token claims now
  (ClientIdentity.profile, set at login from the carrier_users row) → ctx.profiles → audit.
- **New audit coverage**: automation.log (who triggered which automation — the /automation/logs
  route only wrote its own table before), knowledge.delete (single + bulk), knowledge.verify,
  scope_risk.create/update/delete. Logins were already audited (auth.login / auth.zoho.login /
  auth.client_login) — now enriched with userName/profile/role/company columns.
- **GET /v1/admin/audit upgraded**: guard switched from JWT-only adminOnly to sessionOrApiKey +
  role-admin (same gate as /carrier-users, so the dev API-key transport works); filters action
  (PREFIX match — 'auth.' = all auth events), audience, status, user_id + limit/offset; returns
  {entries (tenantId stripped), total}.
- **Admin → Audit Log tab (new)**: action-preset chips (Logins / Chat / Tools / Knowledge /
  Automations / Carrier users), audience + status chips, client-side text filter, table
  (When · User (+as-agent-by) · Profile·Role · Company · Action · Status), row click → detail
  modal (full identity grid + pretty-printed detail JSON), Load more pagination.
- Tests: 390 backend green (6 new: worker/client/impersonator identity stamping; endpoint filter
  forwarding + no-tenantId DTO; RBAC worker/client 403, admin ok) + 37 web.
- Deploy: run `pnpm db:migrate` (0017 audit columns; additive, no backfill — old rows show '—').

## 2026-07-07 (3) — Client management: Owner/Driver profile model + application-first provisioning

The carrier client setup, done properly (backend + Mytrion Admin):

- **Profile model (migration 0018)**: carrier_users.profile is now a typed enum — 'owner' (fleet;
  RBAC tie = carrier_id OR application_id; sees every card of the carrier) and 'driver' (CHILD of an
  owner via parent_user_id; RBAC tie = card_id — the card carries the limits). carrier_id is NULLABLE:
  an account can be provisioned with just login/password/profile + the application id (the unique
  key), and the carrier id is populated later. New columns parent_user_id + card_id, indexes on
  (tenant, application_id) and (tenant, parent_user_id).
- **Typed RBAC descriptor**: TenantContext gains `client?: ClientAccess {profile, carrierId?,
  applicationId?, cardId?, parentUserId?}` derived from SIGNED claims — card-/carrier-scoped tools
  (the future mini-app surface) read this to bound what a session sees. ctx.profiles = ['Owner'|'Driver']
  → audit rows show the profile automatically.
- **Driver inheritance + lockout**: at login (and on every refresh) a driver's company scope is
  INHERITED from its parent owner (clientIdentityFor); a missing/disabled parent denies the driver
  with the same generic message. Refresh re-derives the whole identity from the row, so a back-filled
  carrier id, a newly assigned card, or a disabled parent takes effect on the next rotation.
- **Populate-later, automatically**: POST /v1/carrier-users/populate-carrier {application_id,
  carrier_id} back-fills carrier_id on EVERY account under that application whose carrier is still
  empty (audited: admin.carrier_user.populate_carrier). Callable by the admin UI today and by a
  conversion automation/webhook with the API key tomorrow (servercrm has no app→carrier endpoint yet
  — checked). Owner delete is blocked (409) while drivers point at it; drivers require an ACTIVE
  owner parent at creation.
- **Admin UI rework**: Owner/Driver toggle in the create form (owner: carrier + application with
  "at least one" rule; driver: parent-owner select + optional card), table shows Login · Profile pill ·
  Carrier Id (or a "Set carrier…" action that uses populate-carrier for application families) ·
  Application · Card/↳Parent · Agent · Status, plus per-row Card assignment for drivers. /client page
  shows profile + card/company on sign-in.
- Tests: 399 backend green (+9: application-only owner, neither-id 400, driver parent matrix
  (missing/driver-parent/disabled-parent), driver create with card, owner-delete 409, populate-carrier
  back-fill + audit, driver login inheritance + ctx.client descriptor, parent lockout, refresh picks
  up back-filled carrier) + 37 web. Deploy: `pnpm db:migrate` applies 0018 (carrier_id nullable,
  profile enum default 'owner' w/ backfill guard, parent/card columns).

## 2026-07-07 (4) — Client provisioning from the DWH directory (octane.intm_zoho_deals)

Carrier accounts are now provisioned FROM the already-defined clients in the data warehouse.

- **pnpm dwh:inspect (new script)** — DWH metadata explorer: schemas / tables (--schema, --like) /
  columns + row counts (--table) / sample rows (--sample) / ad-hoc read-only SQL (--query). Session
  is enforced read-only. Used it to map octane.intm_zoho_deals: 79-column SCD view, 20,294 active
  rows (is_active=true → exactly one row per deal), with deal_name, carrier_id, application_id,
  application_date, stage, owner_id (Zoho agent id).
- **GET /v1/carrier-clients (admin-gated)** — the client directory: active deals ordered by
  application_date DESC. Searchable exactly as asked: company name (deal_name ILIKE contains) OR
  carrier id / application id (numeric q → prefix match on both, still also matching names).
  DWH failures map to 502 DWH_ERROR; unconfigured → 503. Integration in src/integrations/
  dwhClients.ts over the existing read-only dwh.ts pool.
- **carrier_users.company_name (migration 0019, applied)** — stored on pick/create, shown as a
  Company column (drivers inherit the parent's for display), and included in the local account
  search — so accounts are searchable by company name too.
- **Admin UI** — the Owner create form gains a "Find the client" search (debounced, min 2 chars,
  newest applications first; rows show company · carrier/app id · application date · stage);
  picking one fills carrier id, application id, company name, and the agent (deal owner_id matched
  against the Zoho agents list, raw id fallback).
- Tests: 407 backend green (8 new: browse/text/numeric query construction incl. is_active +
  ordering, DTO mapping, limit cap, route gate worker-403, DWH 502 mapping) + 37 web. Live-smoked
  against the real DWH: 'grant' → GRANT EXPRESS LLC (newest first); '5837' → carrier-prefix hits.

## 2026-07-08 — Octane Scope: full RnD-widget UI/UX port (React Flow) in Mytrion Admin

- **Why** — the admin tab's Octane-Scope was a compact stepper+card sketch; the real design lives in
  the Zoho RnD widget (`zoho-octane/app/agent-scope`, octane-business-panel). Ported that UI/UX 1:1
  into `apps/mytrion-crm/src/mytrions/admin/scope/` (13 files, all under the 600-line cap), and
  upgraded the blueprints from the widget's static dagre board to interactive **React Flow** graphs.
- **Scene** — parallax far grid + ambient flood + vignette; horizontally draggable/zoomable camera
  (0.5–1.8×); Catmull-Rom gradient road with flowing dash + offset-path particles; pulsing stage
  orbs; floating glass stage cards with scroll-linked opacity/active detection; WEX ⇄ Deal
  interconnect arc; bottom progress rail; keyboard (←/→ stages, Esc closes). After lifecycle =
  Client hub with edge-trimmed gradient spokes (Collection hangs off Billing). Clicking the
  terminal Client Stage switches to the After hub, same as the widget.
- **Drill-down** — sub-tabs Blueprint / Departments / Automations / Details. Blueprints are
  @xyflow/react + @dagrejs/dagre (same layout params, kind-colored bezier edges + arrowheads +
  label pills, dept chips + tools lines + simple-icons logos on nodes, side-hint and note-column
  handling) with fitView, pan/zoom, drag, Controls (bottom-left) and a MiniMap on graphs > 8 nodes.
  Lead-Gen keeps its custom Distribution-Engine diagram under Automations.
- **Risk items** — Details tab hosts the widget's editable Blockers / Red Flags / Manual sections
  (icon picker form, hover row actions, spinners, toasts) against the existing /v1/scope/risks API.
  Node ids now match the widget exactly (`lead-generation`… + After cycle ids `verification`,
  `retention`, `customer-service`, `billing`, `collection`) — the old `after-*` ids were a split
  brain with the Zoho widget; both UIs now edit the same records.
- **Theme** — scene runs the widget's cinematic palette keyed off `<html data-theme>` via a
  MutationObserver hook, so the TopBar toggle re-themes it live (verified both modes headlessly).
- Deps: apps/mytrion-crm + @xyflow/react 12.11.2, @dagrejs/dagre 3.0.0. Removed the old
  OctaneScope.tsx + its now-orphaned admin.module.css blocks.
- Verified: web typecheck + 37 tests, root lint/typecheck + 407 tests, vite build, and a headless
  Chrome walkthrough (road, modal tabs, After hub, Verification blueprint, light mode).

## 2026-07-08 (2) — Fix: blueprint canvas flicker on zoom

- Blueprint nodes (`.oct-bpnode`) flickered constantly while zooming the React Flow canvas.
  Cause: `backdrop-filter: blur(6px)` on nodes inside `.react-flow__viewport`, whose CSS
  transform updates every zoom tick — Chromium/Safari re-rasterize the filtered backdrop per
  frame (known React Flow gotcha), and every node was its own backdrop root.
- Fix: replaced the node blur with the same glass tint composited over an opaque base —
  `background: linear-gradient(var(--glass), var(--glass)) var(--bg1)` — visually equivalent in
  both themes. Controls/MiniMap keep their blur (they sit outside the transformed viewport).
- Verified: mytrion-crm typecheck + vite build.

## 2026-07-08 (3) — Retention setup: single entity, CRUD, auto-generation from the DWH

- **Entity** — `retention_cases` (migration `0020`): ONE table carrying the whole workflow.
  Phase ladder `sales → retention → open_pool → citi` (citi = final; the sales rep gets the
  first window per the future-workflow flowchart), SOP stage classification
  (`inactive_no_reason | inactive_reason_noted | out_of_reach | pending | assigned_to_agent`),
  outcome, inactivity reason + note, out-of-reach attempt counter, open-pool assignment state,
  and DWH frequency metrics (class/threshold/last-tx/days-inactive/tx-count/gallons/cards).
  Partial unique index: one OPEN case per (tenant, carrier); closed rows keep episode history.
- **Auto-generation** — `src/integrations/dwhRetention.ts` scans `octane.dim_company` (active,
  non-debtor, has swiped — debtors excluded at the source per the flowchart) joined with 90-day
  aggregates from `octane.mart_transaction_line_items`. Frequency classes high/medium/low =
  expected tx every 2/5/7 days (classified from avg 90-day gap); a carrier BREACHES when
  days-inactive exceeds its threshold. Query validated read-only against the live DWH via
  `pnpm dwh:inspect` (returns high-volume carriers 3–7 days quiet — exactly the SOP priority).
- **Sync** — `src/modules/retention/retentionSync.ts`: breach without an open case → create
  (phase `sales`, source `auto`); breach with an open case → refresh metrics; open case whose
  carrier transacted after creation and is back inside threshold → close `returned` ("Returned"
  branch). `citi` cases are never auto-closed. Runs nightly (`automation.retention.case-sync`,
  cron 05:00, no LLM) and on demand via `POST /v1/retention/sync` (admin).
- **CRUD** — `/v1/retention/cases` list/get/create/patch (+ POST `:id/delete` alias). Reads +
  case-work writes need the retention department (x-department-access honored for INTERNAL
  callers only — a customer session can never claim a department; a test caught that hole and
  the gate now audience-checks first). Delete + sync are admin-only. All writes audited.
- Frontend: `apps/mytrion-crm/src/api/retention.ts` typed client (module UI still on fixtures —
  wiring Cases/OpenPool to the API is the next step; blueprint TBD).
- Verified: root lint + typecheck + 425 tests (18 new), web typecheck, live-DWH query smoke.
- NOT yet applied: `pnpm db:migrate` (app DB is the live Render Postgres — run at deploy time).

## 2026-07-08 (4) — Migration 0020 applied + Retention UI design prompt

- Applied `pnpm db:migrate` against the app Postgres (Render). Verified live: 29 columns,
  5 indexes incl. the partial open-case unique, 0 rows. DWH untouched (drizzle never sees it).
- Added `docs/RETENTION_UI_DESIGN_PROMPT.md` — self-contained prompt for the Claude Design
  session that will redesign the Retention Mytrion UI against the live /v1/retention API.

## 2026-07-09 — Retention case-sync cadence: every 5 minutes

- `automation.retention.case-sync` cron changed 05:00 nightly → `*/5 * * * *`. Rationale:
  cases and returned-closures surface near-real-time; singleton queue policy means runs never
  overlap, and the DWH scan is one seconds-fast read-only query. 30s would be pointlessly
  heavy on the warehouse. Design prompt copy updated to match (5-minute freshness).

## 2026-07-09 (2) — inbox_events entity + native WebSocket pub/sub

- **Entity** — `inbox_events` (migration `0021`, APPLIED to the app Postgres; DWH untouched):
  priority (low/medium/high), tag, type (dot-namespaced slug), owner as owner_kind + owner_id
  ('worker' → Zoho user id, 'client' → carrier_users id), plus title/detail/read_at.
  Owner-feed composite index; the table is the durable feed behind the realtime push.
- **Realtime** — our own native WebSocket (@fastify/websocket 10 / `ws`, no Redis):
  `GET /v1/realtime?token=<jwt|API_KEY>` (token lifted from query → same sessionOrApiKey
  guard). In-process hub (`src/modules/realtime/hub.ts`) with topic grammar
  `inbox:<worker|client>:<id>` + `inbox:all` firehose. Sockets auto-subscribe to their OWN
  topic from the verified session; foreign topics/firehose are admin-only; subscribe /
  unsubscribe / ping over JSON frames.
- **REST** — POST /v1/inbox/events (admin; persist FIRST, then publish live), owner-scoped
  GET list (+unread count; admins may inspect any owner), :id/read (owner-or-admin),
  read-all, :id/delete (admin). Writes audited.
- Caveat noted in hub docs: hub is per-process; in a split send-only worker deploy, worker-
  created events persist but need a pg NOTIFY bridge for live push (not built).
- Verified: lint, typecheck, 440 tests (15 new) incl. a LIVE ws end-to-end (real listener,
  real ws client: hello/auto-subscribe, denied foreign subscribe, REST create → socket frame).

## 2026-07-09 → 07-10 — Touchpoints layer (Deluge + servercrm) for the Sales Mytrion

- **Reusable wrappers.** `src/integrations/zohoFunctions.ts` — `executeZohoFunction(name, args, {accessToken?, unwrap})` (managed token by default, ported from the servercrm ref: body-less POST to `{origin}/crm/v2/functions/<name>/actions/execute?auth_type=oauth&arguments=<json>`, `details.output` parse w/ numeric-key repair, 401 invalidate+retry-once, casing fallback pairs). servercrm wrapper already existed (`serverCrm.ts`); added `ServerCrmHttpError` (status + body) for 4xx-passthrough vs 502 mapping.
- **Catalog + dispatcher.** `src/modules/touchpoints/` — 48 declarative entries (22 Deluge, 26 servercrm) split by domain, each with a zod schema + risk class + identity/carrier annotations. One dispatcher: internal-audience + `sales` dept gate (destructive tier behind `FF_TOUCHPOINT_DESTRUCTIVE_SALES`, default on = widget parity), session-authoritative identity injection (`serverCrmScope`), `assertCarrierOwned`, path templating + query/body split, error mapping. Route `POST /v1/touchpoints/:key` + `GET /v1/touchpoints` discovery; writes/destructive audited (PAN masked), reads not.
- **Sales Automations tab is LIVE** (was a setTimeout stub): DWH client typeahead (`CarrierPicker` over `searchClients`), 12 flows wired (balance, account-status, payments w/ Deluge fallback, tracking, billing-form, invoices + signed-url download, transactions, wex-tasks, card-activation, card-replacement, fraud-hold, efs-login link), inline result views, per-run `automation_logs` post. money-code stays `comingSoon`.
- **Adversarial review (partial workflow) — fixes applied:**
  - Range vocab: `/api/agent/dwh/*` uses `day|week|month|…|custom` (NOT `last_*`); only `/api/salesMytrion/fetchInvoices` uses `last_7|last_30|last_90`. Split into `dwhRange`/`salesRange`; transactions default was `last_30` (would 400 every run) → `month`. VERIFIED live (`range=month` → 200).
  - `efs.cards` returns camelCase `cardNumber` (card-replacement read `card_number` → all '—') → read both. VERIFIED live.
  - `cards.status`/`cards.limits` → new `cardAction` unwrap (throws on explicit EFS failure flag; permissive was silently succeeding).
  - Crashed-Deluge envelope (`code!=success`, no output) now throws instead of null-success; `mytrionfetchannouncements` bracket-less list wrapped to array.
  - Dot-segment (`..`) path params rejected (URL normalization redirect); billing-form null-crash guarded; CarrierPicker stale-results seq bump; invoice-download error toast; card fields trimmed.
- Accepted (widget-parity, not regressions): `invoice_signed_url` has no per-carrier ownership check and `fraud.hold_release` takes a caller `agentEmail` — both match the legacy widget's static-key behavior; servercrm itself doesn't enforce them. Audit logs the client-sent params (actor identity is separate) rather than post-injection values.
- Read-only live smoke: `scripts/touchpointsSmoke.ts` (`pnpm tsx`), verifies token flow + parsing against real Zoho + servercrm, no writes.
- Verified: root lint + typecheck + 486 tests; web typecheck + 51 tests; live smoke green.

## 2026-07-10 — Sales Mytrion goes LIVE (widget UI/UX port) + admin user switching

- **All six Sales panels wired to the exact widget touchpoints** (fixtures gone):
  Home (mytrionhomesnapshot groups + trends, mytrionfetchannouncements w/ priority modal,
  /api/agent/activity KPIs w/ Today/Week/Month, live inbox preview + real greeting name);
  Inbox (mytrionfetchinbox, widget filter tabs All/Unread/Tasks/Alerts/Reminders, localStorage
  read-state, optimistic mytriondeleteinboxmessage, sourceUrl CTA for tasks/reminders);
  Data Center (clients: /api/clients/by-agent w/ CMP debt + LOC/Prepay filters + widget sort;
  leads: mytriondatacenterleads grouped by lead status w/ UTM pills); Dashboard (Sales:
  mytrionAgentSalesDashboard cycle KPIs/donuts/utilization/cards-by-company/activity chart/tx
  table w/ totals; Company: gauges vs widget targets 15/105/450 fills + 6.7M gal; Debtors:
  mytriondbdebtorsinfo cards w/ hard-debtor pills + invoice drill; Performance: activity KPIs +
  /api/agent/activity/leaderboard w/ metric toggle + YOU highlight); Carriers (live
  /api/sales/carriers/search + status chips + per-row mytrioncreatelead w/ DUPLICATE_DATA →
  "Exists" link, widget payload building); Create (lead form w/ 10-digit phone validation,
  escalation w/ the widget's 10 reasons → createescalationticket; Desk-first support ticket
  deferred). ClientDetailModal: live clients/:id/recent-transactions.
- **Admin user switching = ActAsPicker (already in TopBar) + module remount**: SalesMytrion
  keys on actingAs.zohoUserId — switching agents refetches every panel AS that agent (backend
  act-as rewrites identity; server-injected userId/agentName follow). Widget parity with
  selectImpersonatedUser + currentUser.id watchers.
- `sales/live.ts` — the mapping layer (useLoad hook + fetchers per touchpoint, widget response
  parsing: snapshot grouping/tones, inbox type map task/assignment→reminder/warning/critical,
  HTML stripping, by-agent sort, lead-outcome DUPLICATE_DATA parsing). leads.create unwrap →
  permissive (backend) so the UI can link the existing lead.
- **Tested every feature one by one, LIVE** (scripts/salesPanelSmoke.ts): 15/15 as a real
  sales agent (Franklyn Jobs — the act-as path), 13/14 as admin (agent_sales needs a carrier
  book → now a friendly "no carriers" state). Caught + fixed: leaderboard rows under
  `leaderboard` (not `data`); agent_sales dim_company-miss handling. Writes validated to the
  schema boundary only (no junk in prod CRM).
- Removed dead fixtures (dashboardData.ts, CarrierDetailModal, DashboardInvoices).
- Verified: root lint (0 errors) + 486 tests; web typecheck + 51 tests; live smoke 15/15.

## 2026-07-10 (2) — Sales Mytrion end-to-end re-audit (live browser + multi-agent code audit)

- **Drove the real app headlessly (Playwright + minted JWT session)** through every tab/block/modal, as admin then acting-as a real agent (Franklyn Jobs): Home (snapshot/announcements/activity + range toggle), Inbox (list + item modal), Data Center (clients + leads tabs + client modal w/ live recent fuel), Create (lead + escalation + 10 reasons + ticket placeholder), Automations (Balance Check end-to-end vs live EFS), Dashboard (Sales/Company/Debtors/Performance + leaderboard YOU badge), Carriers (live search 200 rows + lead buttons). Act-as verified: greeting + inbox(1 unread)/clients/dashboards all switch to the agent. 22/23 steps (the 1 miss = a transient servercrm 502 on agent_sales; verified 2/2 OK via backend, and the panel shows a Retry).
- **7-panel adversarial code audit** (vs the widget reference + live shapes). Fixes applied:
  - HIGH: `leads.create` schema rejected blank firstName/phone the widget legally sends (broker rows) → made optional; `sales.carriers_search` limit capped at 100 but UI sends 200/500 → raised to 500; `Carriers.createLead` had no catch → added; ClientDetailModal fuel amounts all showed **$0** (net_total is 0 on fuel rows; charge is in funded_total) → fallback net_total→funded_total→line_item_amount (verified live: now $232/$338/…); duplicate React keys on multi-grade fuel rows → indexed key.
  - MEDIUM: salutation `Mr.`/`Ms.` → `Mr`/`Ms` (CRM picklist); single-word owner name kept in BOTH first+last (was empty firstName); LOC filter `/loc|line of credit|credit/`, prepay `/pre.?pay/`, credit_limit>0 gate for limitText; duplicate-lead id parse handles string OR object `response`; inbox delete-by-id (not the upstream recordId) + error toast; inbox/announcement titles use `||` (empty subject fallback); Home inbox-preview error state; DashboardCompany label shows true % (bar caps at 100); DashboardSales discount total column; Money-Owed tone (hard→warn, debt→bad).
  - Skipped as cosmetic (documented): errored-metric "—" vs 0, 48h announcement badge, live clock ticking, 91-bucket sparkline slice, WS live-push.
- Verified: backend lint 0 errors + typecheck + touchpoint tests; web typecheck + 51 tests; live re-walkthrough green.

## 2026-07-10 (3) — Finance Mytrion backend migration + Deluge prod/sandbox switch

- **Deluge env switch**: executor now targets PRODUCTION by default and flips to the CRM
  sandbox with env only — `ZOHO_FUNCTIONS_ENV=sandbox` + `ZOHO_FUNCTIONS_SANDBOX_BASE_URL`
  (default https://sandbox.zohoapis.com/crm/v2/functions) + `ZOHO_CRM_SANDBOX_REFRESH_TOKEN`
  (falls back to the prod CRM token). New 'crm_sandbox' token service (own cache slot) so
  prod/sandbox tokens never mix. Zero code change to switch.
- **Finance touchpoints (backend only, UI later)** — 21 new catalog entries, dept-gated
  to 'finance': 3 Deluge (`finance.balance_run` = mytrionfinancebalancerun (the only write,
  fire-and-forget), `finance.parent_snapshot` = mytrionfinanceparentsnapshot (status unwrap),
  `finance.smart_events` = mytrionfetchsmartevents {limit,offset}) + 18 servercrm reads
  (main-transactions ±count, smart-balance audits ±count, clients ±count, payments ±count,
  debtors ±count, analytics fueling-patterns ±per-carrier, segments aggregate/clients,
  clients-fueling-on, and finance-scoped client drilldowns invoices/payment-transactions/
  recent-transactions — deliberately org-wide, NO per-agent carrier ownership, matching the
  widget's org-wide static-key access; the sales entries keep their owner gate).
  List endpoints take a bounded `looseFilters` map (identifier keys, scalar values, ≤20) —
  the widget forwarded panel filters verbatim and servercrm owns the vocabulary.
- **Tested every finance touchpoint one by one, LIVE** (scripts/financePanelSmoke.ts):
  21/21 — both Deluge functions against PROD (real EFS snapshot + smart events) and all 18
  servercrm reads; balance_run schema-validated only (no write fired). One catch during
  smoke: clients-fueling-on requires date|dayOfWeek (upstream rule, widget always sends it).
- Verified: lint 0 errors, typecheck, 490 tests (5 new incl. the sandbox-env suite).

## 2026-07-11 — Sales Mytrion redesign: bespoke shell + all tabs ported (branch feature/SalesMytrion)

- Ported the full new Sales Mytrion UI/UX from the reference prototype (~/Desktop/SalesMytrion/
  Sales Mytrion.dc.html — a self-contained React design export) into apps/mytrion-crm/src/
  mytrions/sales/redesign/. FAITHFUL, till-the-minute detail: verbatim theme tokens (dark+light),
  Rajdhani/Inter/JetBrains fonts, inline-style fidelity via a `s()` css-string→CSSProperties helper.
- Bespoke self-contained shell (replaces the shared MytrionShell for Sales): boot loader, sidebar
  with nav badges, top bar + live clock, dark-mode toggle, user card (session/act-as name), floating
  AI copilot (streaming canned replies), toast, shared detail + client-drilldown modals.
- 9 tabs (Loaders showcase intentionally dropped as a nav item — its loaders live inline in the
  real tabs): Home (hero/snapshot/activity/quick-actions/recent-inbox), Inbox (filter tabs + row
  actions), **Tickets** (NEW — two-pane Desk console: list + conversation thread + reply),
  **Open Pool** (NEW — claimable-deals table w/ multi-select, filters, assign modal), Data Center
  (clients/applications/money-codes), Create (dept/priority ticket form), Automations (catalog +
  full run modal: deal/card pickers, limits/invoices/txn/form/simple variants, progress→result),
  Dashboard (donuts, cards-by-company, activity chart, tx table + sub-tabs), Carriers (search→card).
- Built via a design-canvas MVVM split: template.html ({{ }} markup) + renderVals() (view-model).
  Foundation (theme/helpers/data/ctx/shell) hand-built; the 9 tab components fanned out to a
  parallel workflow (9/9, 0 errors) then integrated. Registry entry (sales/index.tsx) now points at
  the redesign; old MytrionShell-based tabs + live.ts retained for the live-wiring pass.
- Verified: web typecheck + lint clean, 51 web tests pass, and a headless Chrome walkthrough of
  every tab in LIGHT + DARK — pixel-faithful to the reference (Home, Tickets, Open Pool, Dashboard,
  automation modal all confirmed).
- NOTE: this pass uses the reference's mock data to lock the exact visual. Next pass wires the six
  already-live tabs (Home/DataCenter/Dashboard/Carriers/Create/Automations) onto the existing
  touchpoints, Tickets→Zoho Desk, Open Pool→retention — per the "re-skin, keep data live" decision.

## 2026-07-11 — Sales Mytrion redesign: LIVE data pass (mock → touchpoints + Zoho Desk + servercrm WS)

- Removed all mock/fake data from the redesign. Every tab now reads real backend data; the only
  remaining fixture is `redesign/mock.ts` → `DEALPOOL`, kept solely for the Open Pool tab, whose
  live flow is being rebuilt separately (per the user's "Open Pool connection not needed — we'll
  re-do" decision). When Pool is wired, delete mock.ts + its PoolTab import.
- New adapter layer `redesign/live.ts` (+ `autoLive.ts` for the Automations run flows) exposes
  `useLoad(fn)` → {data,loading,error,reload} and typed loaders over the touchpoint client:
  Home snapshot/announcements/activity/inbox, Inbox list+delete, Records clients.by_agent,
  Dashboard dashboard.agent_sales, Carriers sales.carriers_search, Tickets via the new /v1/desk
  client. Same view-model shapes the mock arrays had, so tab JSX changed minimally; each tab gained
  loading skeletons + error + empty states.
- Data source per tab: Home/Inbox/Records/Dashboard/Carriers → Deluge/servercrm touchpoints;
  Create → tickets.create_escalation; Automations → 11 real touchpoints (dwh.*, cards.*, efs.*,
  fraud.hold_release, wex.application, dwh.money_code) via autoLive; Tickets → Zoho Desk
  (list creator-scoped w/ recent-tickets fallback, conversation, reply). Pool → DEALPOOL (fixture).
- Real-time: `redesign/useServerCrmSocket.ts` reconnecting hook (ports the self-service widget's
  socket + ticket-dashboard subscribe protocol; default `wss://servercrm-wyhh.onrender.com`,
  override VITE_SERVERCRM_WS_URL). Wired in Home (inbox notifications refresh snapshot/inbox),
  Inbox (crm_inbox_notification → reload), Tickets (subscribe {userId,ticketIds};
  ticket_comment_added/attachment → reload thread/list).
- Backend added for Desk: `integrations/zohoDesk.ts` searchTicketsByCreator / getTicketComments /
  postTicketComment; `routes/v1/desk.routes.ts` (GET /desk/tickets [session-authoritative creator
  scope, admin ?zoho_user_id; SCOPE_MISMATCH/403 → listTickets fallback `scoped:false`],
  GET .../comments, POST .../reply [audited desk.ticket.reply]); registered in app.ts.
- Verified: web typecheck clean, backend typecheck clean, redesign lint 0 errors/0 warnings,
  vite widget build succeeds, and all 22 touchpoint keys the UI calls exist in the backend catalog
  (no runtime 404s). Live Desk smoke (listTickets + comments) confirmed earlier.
- Rewiring fanned out one agent per tab via a workflow (8/8, 0 errors), then integrated by hand.

### Live-verify hardening (same day) — killed the last mock/fake surfaces

A headless Chrome walkthrough with a real minted worker session (act-as a real agent so the
DWH agent lookups resolve) surfaced leftover fabricated content the tab rewire hadn't touched.
All fixed:
- **Identity was hardcoded.** salesData `USER = {name:'Marcus Reyes', role:'Senior Sales Agent'}`
  drove the Home greeting ("Good morning, Marcus"), the user-card role, and the copilot opener.
  New `redesign/sessionUser.ts` → `useSessionUser()` derives name/first/initials/role from the real
  session + act-as. Shell + HomeTab now show the signed-in worker (verified: "Good morning, Adam" /
  "Adam Johnson" when acting as that agent). USER remains only for the mock Pool filter.
- **Client drilldown modal Cards/Activity were static reference rows** (card ••4471, J. Alvarez,
  fake transactions). Wired to live `dwh.cards` (card_number + Active/Inactive status) and
  `dwh.transactions` (recent line items → gallons/amount/card/date) via new `live.ts`
  loadClientCards/loadClientActivity, with loading/empty/error states.
- **The AI copilot returned canned `pickReply` strings** inventing carrier balances ("Coastal Haul
  owes $4,280"). Replaced with the real department agent: `useChat(useUserContext(), 'sales',
  agentKeyFor('sales'))` — the same /v1/agent streaming runtime the shared ChatPanel uses, in the
  bespoke floating-copilot chrome. Verified a real grounded reply streamed back. Suggestion chips
  degenericized (no fabricated carrier names).
- Live walkthrough result: every /v1 call 200 (touchpoints, /desk/tickets, /agent,
  /chat/conversations, dashboard.agent_sales), Dashboard renders real carrier transactions,
  servercrm WS connects + subscribes (generic + ticket-scoped frames). NOTE: dashboard.agent_sales
  502s for a worker who isn't in the DWH dim_company (expected — real agents resolve fine).

### Admin "View as" + Sales-Agent direct routing

Two access/UX features on top of the live redesign:
- **Admin "View as" picker** (`redesign/ViewAsPicker.tsx`) — ports the self-service reference's
  top-bar impersonation control into the bespoke shell's visual language. Admin-only (shell gates on
  `isAdmin(useUserContext())`); reuses the existing `useImpersonation` store + `listAgents`
  (/v1/admin/agents). Picking an agent shows an "ADMIN VIEW · <name> · EXIT" banner and the whole
  shell runs as that rep (the impersonation store attaches x-act-as-* headers the backend already
  honors). The tab panels are keyed on the acted-as zohoUserId, so switching remounts + refetches
  every tab (and the copilot) under the new identity. Verified live: greeting/user-card switch,
  panels reload, Exit restores admin.
- **Sales agents land straight in Sales Mytrion.** Every rep's CRM profile is exactly "Sales Agent"
  (region is in the ROLE). Added substring profile matching to the frontend access resolver:
  `MytrionAccessRule.profileContainsAny` + a `containsAny` helper in resolveAccess.ts; sales now
  grants `profileContainsAny: ['Sales Agent']` (mirrors the backend's sales-agent detection). A
  profile containing "Sales Agent" resolves to ONLY sales, so the existing Landing (1 accessible →
  auto-enter) navigates them straight to /m/sales — no picker, no View-as control. Admins still get
  the multi-Mytrion picker. Covered by `src/access/resolveAccess.test.ts` (6 tests) + live-verified
  (agent from `/` → /m/sales; admin from `/` → picker).

### Home-tab data audit fixes

Live audit of the Home tab (acting as a real agent) surfaced snapshot/inbox gaps — all fixed:
- **Volume Trend showed "—".** `loadSnapshot` declared `volume_trend` but never populated it. Now it
  computes the week-over-week gallons change from `gallons_this_week` vs `gallons_last_week` (new
  `pctChange` helper) → e.g. "-47%", colored by direction (up=green/down=red/flat=accent). The
  "This Week / Fuel Transactions" caption now shows the swipes trend ("↓ 29% vs last week") instead
  of a static string. Added `gallons_last_week`/`swipes_last_week` to `SnapshotFields`.
- **Today's Snapshot metrics** (swipes/gallons/new-cards today) were already correctly mapped from
  `snapshot.*_today`; they read 0 only because the test agent genuinely had no activity *today* (the
  This Week row shows real 12 tx / 807.97 gal / 1 card). No code change needed there — the wiring is
  correct; Volume Trend was the real bug.
- **Inbox detail modal had an empty grey pill.** The badges array always included `badge(i.tag, …)`
  even when the inbox item's `tag` was "" (it usually is in real data). Made the tag badge/pill
  conditional in HomeTab + InboxTab (modal + row) — now only the priority badge shows.
- Verified live (act-as Adam Johnson): snapshot renders real week data + Volume Trend −47%; inbox
  list + modal populated with a single clean MEDIUM/HIGH badge; activity 13 calls; servercrm WS
  OPEN→subscribe→subscribed ("● LIVE").

### Tickets audit + real nav badges

- **Ticket cards showed Agent N/A / Company — / Contact —.** The Desk route falls back to
  `listTickets` (search scope missing → `scoped:false`), and `toSummary()` strips
  account/contact/assignee/department. Added `listTicketsDetailed` (raw objects,
  `include=contacts,assignee,team,departments`) and pointed the fallback at it. `mapTicket` now
  reads the real nesting the reference uses — company = `contact.account.accountName`, contact =
  `contact.firstName+lastName`, department = `department.name` (object), owner = escalation `team.name`
  else `assignee.firstName+lastName` (null = genuinely unassigned → "N/A"). Live: "AZAEL TRANSPORT
  SERVICE", "BEKA STAR LLC / Bekzod Musinov", "Customer Service", etc.
- **Ticket conversation was empty.** Auto-created Rejection Reports carry their body as a THREAD
  (threadCount 1, commentCount 0), but `loadTicketMessages` only fetched comments. Added
  `getTicketThreads` + the `/desk/tickets/:id/comments` endpoint now returns `{threads, comments}`;
  the adapter merges them oldest→newest ('in' thread = requester, 'out' = us). Live: the
  "Error Code: 787 … INACTIVE CARD … SAN ANTONIO … LOVES #242" thread renders.
- **Nav badges were hardcoded (4/2/7).** Removed the literals from `salesData.NAV`; the Shell now
  computes them from real data — Inbox = `loadInbox().length`, Tickets = open (non-closed) count —
  keyed on the acted-as agent so they refetch on "View as". Open Pool has no badge until its data
  flow is rebuilt (no fake number). Live: Inbox 24, Tickets 43.

### Tickets layout (full-bleed) + collapsible sidebar + conversation correctness

- **Full width/height Tickets.** `#ss-panels` centered every tab under `max-width:1180px`, cramping
  the Tickets two-pane console. Added a `FULL_BLEED` set (currently `tickets`): those drop the
  centering — `<main>` overflow hidden, `#ss-panels` `height:100%;padding` with no max-width, tab
  root `height:100%` (border-box under `.ss-root`). Other tabs still center. Verified Tickets
  1442×946 flush-left; Home/Dashboard stay centered; switching restores.
- **Collapsible sidebar.** `navCollapsed` state (persisted `ss.nav.collapsed`) + a topbar toggle
  (PANEL icon). Collapsed → 68px icons-only (logo, centered nav icons with badge OVERLAYS, theme +
  avatar); expanded → 238px, width-transitioned. Verified 238↔68.
- **Ticket scoping is org-wide until the Desk token gets the search scope.** The list is creator-
  scoped via `/tickets/search?customField1=cf_crm_created_by_id:<crmUserId>` (correct, matches the
  reference), but the Desk refresh token lacks `Desk.search.READ` → 403 SCOPE_MISMATCH → falls back
  to recent org tickets (`scoped:false`). Neither the DWH table nor servercrm has a creator column,
  so there is NO scope-free path. Added a visible amber banner in the tab when `scoped:false`.
  FIX (user action): re-mint `ZOHO_DESK_REFRESH_TOKEN` with `Desk.search.READ` added — then
  `searchTicketsByCreator` scopes per-user with zero code change.
- **Conversation correctness** (adversarial code-review workflow → 7 confirmed findings, all fixed;
  verified against live Desk data, which also caught a bad `include=commenter` I'd added that 422s
  the whole comments request):
  - Sidebar Tickets badge counted Resolved/Cancelled as open. Extracted canonical `isTicketClosed`
    (Closed/Cancelled/Resolved) into live.ts; Shell badge + TicketsTab share it.
  - `useLoad` didn't reset `data` on deps change → badges showed the PREVIOUS agent's count after a
    View-as switch (stuck on error). Now clears data when the deps key changes.
  - Comments rendered every writer as "Support": Desk exposes the writer as `commenter` (name/email),
    NOT `author`, and `commenterId` (Desk agent id) ≠ CRM zohoUserId. Now reads `commenter.name` and
    detects "me" by EMAIL match. Live: "Leo Isaac" / "You" render correctly.
  - Empty (attachment-only) comments no longer render blank bubbles.
  - Thread bodies were truncated (list returns only `summary`); the conversation route now fetches
    each thread's full `content` via `getTicketThread` (recent 15, parallel, falls back to summary).

### Inbox — real-time events matched to the user id (self-service parity)

Made the Inbox tab behave exactly like the reference `self-service/js/components/inbox-panel.js`:
- The fetch was already right — `inbox.list` = the reference's `mytrionfetchinbox` Deluge, with
  `identityParam:'userId'`, so it's server-scoped to the effective (act-as) user.
- **The gap was the WebSocket.** We reloaded on EVERY `crm_inbox_notification`. The reference's
  `_handleWsMessage` only reacts when `data.ownerId === currentUser.id`. Now the InboxTab computes
  `currentUserId = actingAs?.zohoUserId ?? worker.zohoUserId` and, on a `crm_inbox_notification`,
  toasts the subject + refetches ONLY when `ownerId === currentUserId` — otherwise ignores it.
  (The socket still sends the generic `{type:'subscribe'}`; matching is receive-side, as in the ref.)
- Added the toast on a matching new message, and a real Live/OFFLINE indicator driven by the socket
  open/close (`wsReady`) instead of a static "LIVE".
- Aligned `mapInboxType` to `_mapType` exactly (only `assignment`→reminder; else→info). Real inbox
  data (types Info/Task/Assignment/Update, priorities medium/high only) renders identically.
- Verified by mocking the WebSocket in-browser and injecting notifications: a non-matching ownerId
  is ignored (no reload, no toast); a matching ownerId (the acted-as agent's id) fires the toast +
  a refetch. Live indicator shows LIVE when connected.

### Tickets ARE now scoped to the current user — WITHOUT the Desk.search scope

The reference dashboard filters `/tickets/search?customField1=cf_crm_created_by_id:<crmUserId>`, which
needs `Desk.search` (our token lacks it → 403). Rather than showing org-wide tickets, discovered a
scope-free path: **Desk's `fields` query param returns any named custom field inline in the list
`cf` object** (verified: `?fields=…,cf_crm_created_by_id&include=contacts,assignee,team,departments`
returns full display data + the creator id, HTTP 200, no search scope).
- New `zohoDesk.listTicketsByCreator(crmUserId, {maxPages})` pages the recent tickets (parallel,
  bounded to ~6×99 = a recency window), keeps only rows whose `cf.cf_crm_created_by_id === crmUserId`,
  de-duped. `TICKET_FIELDS`/`TICKET_INCLUDE` constants define the exact projection mapTicket needs.
- Desk route: still tries `searchTicketsByCreator` first (complete + fast when the scope exists);
  on SCOPE_MISMATCH it now uses `listTicketsByCreator` and returns `scoped:true` (+ `windowed:true`).
  So BOTH paths are creator-scoped — the org-wide banner never shows.
- RBAC: the desk route requires `sales` dept, read from `x-department-access` (a worker session
  carries no dept by default; only admins passed via allDepartmentAccess). Added a `headers` option
  to the web `request()` transport and the desk client now asserts `x-department-access: sales` on
  all three desk endpoints — so a signed-in Sales agent clears the gate.
- Identity: the route resolves the caller from the SESSION (not act-as headers), so a real agent gets
  their own tickets. For an admin using "View as", `loadTickets` now passes the acted-as id as
  `?zoho_user_id` (admin-honored override) so it scopes to that agent too.
- Verified live: real agent session (id 6227679000135957001) → 8 tickets, ALL theirs (0 not theirs),
  no banner; `?zoho_user_id=<agent>` as admin → 7 tickets, all theirs. Limitation: the fallback only
  covers a recency window (~600 recent org tickets); adding `Desk.search.READ` to the Desk token
  removes the bound (search returns ALL of the caller's tickets) with zero code change.

### Real-time UNREAD sidebar badges + collapse button + Open Pool "Coming soon"

- **Sidebar collapse button.** Moved the collapse toggle INTO the sidebar (header, right of the
  brand when expanded; a centered button when collapsed) and removed the topbar one. Verified 68↔238.
- **Open Pool = "Coming soon".** Restored the nav entry with `comingSoon: true` (NavItem flag):
  disabled/greyed with a "SOON" tag, not navigable. The PoolTab render stays wired.
- **Both nav badges are now UNREAD counts that decrement when read** (the user's ask), driven by ONE
  shell-level servercrm socket (`sidebarBadges.useSidebarBadges`) so they update from any tab:
  - `inboxRead.ts` — shared persisted read-set; the InboxTab mark-read / mark-all-read / open write
    to it, so the Inbox badge (= items not read) drops immediately. Verified 25 → none after "Mark
    all read". A new `crm_inbox_notification` (ownerId match) refetches → +1 unread.
  - `ticketUnread.ts` — shared persisted per-ticket unread counts. The shell socket bumps a ticket on
    `ticket_comment_added`/`ticket_attachment_added` (subscribe `{type:'subscribe', userId,
    ticketIds}` — the reference's exact frame; filtered to the caller's ticket ids). The TicketsTab
    clears on select/open (and reactively for the open ticket) + shows a per-row unread badge.
    Verified: WS comment → badge 2 → open the ticket → badge 0, store `{}`.
- One shell socket handles both event types; tabs keep their own sockets for tab-specific needs.
  Stores are `useSyncExternalStore` so shell + tabs stay in lock-step.

---

## 2026-07-14 — Data Center via Zoho CRM COQL + Tickets enhancements

### Data Center (RecordsTab) — five sub-tabs, real data, updated-reference styling

Ported the updated reference's `isRecords` slice (`~/Desktop/SalesMytrion/project/Sales
Mytrion.dc.html`): **Clients / Leads / Deals / Rejection Reports / Money Codes**, each with a
per-tab search and a board/list toggle for the pipeline tabs. Lead & deal cards open detail modals.

**Data sources (per what actually owns the data):**
- **Leads / Deals / Rejections → Zoho CRM COQL**, owner-scoped (`Owner = '<zohoUserId>'` — the org's
  live COQL convention, verified against servercrm + probing `/coql`). New read-only path:
  - `src/integrations/salesDataCenter.ts` — `fetchAgentLeads/Deals/Rejections` build validated COQL
    (field API names + rejection-state values verified against live `/settings/fields` metadata; a
    single unknown column 400s the whole query). Owner id is `^\d+$`-guarded (no COQL injection).
  - `src/routes/v1/dataCenter.routes.ts` — `GET /v1/data-center/{leads,deals,rejections}`, modeled on
    desk.routes: internal + sales-department gate, `resolveZohoUserId` (non-admin locked to self,
    admin/act-as may target an agent via `?zoho_user_id`). Registered in `app.ts`.
  - Frontend: `api/dataCenter.ts` (client) → `redesign/dataCenterLive.ts` (VMs + loaders + bucket
    maps; Lead `Status`/Deal `Stage` picklists bucketed into a clean 5-col pipeline) →
    `dataCenterViews.tsx` (kanban/list) + `dataCenterModals.tsx` (lead/deal drilldowns, wired through
    `ctx`/`Shell`). RecordsTab is the shell (sub-tabs + toolbar + Clients grid + Money empty state).
  - **Rejections** come from the Deals module (`Stage in ('Closed Lost',…)` OR `Application_Status in
    ('Disqualified','Closed/Lost','Closed/Fraud')`) — the Applications module carries no Owner, so it
    can't be agent-scoped; Deals mirror the application decision and do have Owner.
- **Clients → servercrm `clients.by_agent`** (unchanged): the DWH is the only source with
  balance/cards/gallons, so "every field populated" requires it — CRM Accounts lack those.
- **Money Codes → styled empty state**: not a Zoho module (issued via EFS; only a Postgres
  `money_code_requests` table, which isn't agent-scoped) — honest empty state, no COQL source.

Live-verified (Playwright, as a productive CRM owner): leads=200, deals=200, rejections=106 rows
flowing COQL→route→UI; kanban columns, stats, rejection breakdown, and lead/deal modals all render.

### Tickets — more-visible loading, send-button fix, and reference enhancements

- **Send button no longer hidden by the copilot FAB**: the full-bleed composer reserves right padding
  (78px) so the send button clears the fixed FAB. Verified: send right=1583, FAB left=1598 (no
  overlap).
- **Skeleton loading** (`.ss-skel`): list shows 6 shimmer cards; the thread shows shimmer bubbles —
  replaces the small "Loading…" text.
- **Reference enhancements**: SLA badge (per-priority countdown; header + list), priority left-border
  on rows, an **Overdue** filter, canned **quick-reply** chips (keyed on ticket type), and a
  **Resolve/Reopen** action → new `POST /v1/desk/tickets/:id/status` (Desk `PATCH`, audited;
  `updateTicketStatus` in `zohoDesk.ts`).

Verified: `pnpm typecheck` + `pnpm test` (490) green (backend); web typecheck + build green.

---

## 2026-07-14 — zohoMetadataFetcher + Zoho API reference refresh

### Research

- Re-read CRM v8 [field-meta](https://www.zoho.com/crm/developer/docs/api/v8/field-meta.html), [COQL Overview](https://www.zoho.com/crm/developer/docs/api/v8/COQL-Overview.html), [COQL Get Records](https://www.zoho.com/crm/developer/docs/api/v8/Get-Records-through-COQL-Query.html), and Desk [OrganizationFields](https://desk.zoho.com/DeskAPIDocument#OrganizationFields).
- COQL Overview (current): SELECT ≤**500** fields, WHERE ≤**25** criteria, LIMIT ≤**2000**/call (default 200), same-criteria pagination ≤**100k**. Older error-message copy still cites 50/200 — skill now prefers Overview numbers.

### Script

- Added `metadataScripts/zohoMetadataFetcher.ts` + `pnpm meta:fetch`.
  - `pnpm meta:fetch -- crm <ModuleApiName>` → `GET /settings/fields?module=` (PROD `ZOHO_CRM_REFRESH_TOKEN`).
  - `pnpm meta:fetch -- desk <module>` → `GET /organizationFields?module=` + `orgId` (PROD Desk token).
  - Prints `api_name`/`apiName` + data type; `--json` / `--write` optional.
- Verified live PROD: **Leads** 103 fields · **tickets** 45 fields → `metadataScripts/output/zoho-{crm-Leads,desk-tickets}.{json,md}` (git-ignored).

### Cursor / Claude reference

- Updated `.claude/skills/zoho-crm-api` (COQL limits + meta:fetch), `zoho-desk-api`, skills README.
- Added `.cursor/rules/zoho-api-reference.mdc` (globs on integrations/tools/metadataScripts) so Cursor auto-applies the same conventions.

### RingCentral Embeddable in Sales Mytrion (2026-07-14)

- Env: `RINGCENTRAL_CLIENT_ID` / `CLIENT_SECRET` / `JWT` / `SERVER_URL` + `FF_RINGCENTRAL_ENABLED`.
- Backend: `GET /v1/ringcentral/embed-config` (sales/admin) returns Embeddable `adapterUrl` (JWT auth, shared extension).
- Sales UI: `RingCentralPhone` boots Embeddable on the Sales shell; Lead detail modal has **Call** → `rc-adapter-new-call` click-to-dial.
- Status updates / recording / AI transcript deferred.

---

## 2026-07-14 — Create Ticket wizard + Escalation Request (live Desk/CRM writes + attachments)

Rebuilt the Create tab from the updated reference (SalesMytrion222) as two modes (the legacy widget's
two tabs): a 3-step **Create Ticket** wizard (Department → Deal → Details) and an **Escalate Request**
form. Both file real work with an optional drag/drop attachment (≤20MB). Deluge/request reference:
`~/Desktop/Octane-Project/zoho-octane/app/createtickettab.html` (+ `js/const.js`).

- **Create Ticket** → `POST /v1/desk/tickets` (multipart). Server orchestrates the widget flow:
  `createDeskTicket` (Desk `POST /tickets` with an **inline contact** so Desk finds-or-creates the
  requester — the token lacks Desk contact-search scope, so we don't search) → `tickets.create_in_crm`
  (mirror into the CRM Tickets module) → attachment. Stamped `cf_crm_created_by_id` = caller so it
  shows in their ticket list. Depts resolve to this org's Desk dept ids (`DESK_DEPARTMENTS`, verified
  live). Ticket types are the real C-/Q-/V-/M- lists per department.
- **Escalate Request** → `POST /v1/desk/escalations` (multipart) → `tickets.create_escalation`
  Deluge (Escalation_Request record + Desk ticket) → attachment. Reasons = the legacy list.
- New backend: `zohoDesk.createDeskTicket` + `DESK_DEPARTMENTS`, `zohoCrm.attachFileToRecord` (CRM
  Attachments API), two multipart routes in `desk.routes.ts` (audited). Frontend:
  `transport.requestMultipart`, `api/desk.createDeskTicket/createEscalation`, `dataCenterLive` DealVM
  gains `email`/`carrierId` (COQL `+Email`), `createTicketForms.tsx` (wizard + escalation + AttachZone),
  thin `CreateTab.tsx` (mode toggle).

**Attachments — where they land (important, verified live):** the file uploads + links to the CRM
record (`attachFileToRecord` → Deals for tickets, Escalation_Request for escalations) — this WORKS
(HTTP 200, `attached:true`). Transferring it onto the **Desk ticket itself** is currently blocked in
this org: the Desk OAuth token 403s on every Desk attachment endpoint (`POST /tickets/{id}/attachments`,
comment `attachmentIds`, `/uploads`+comment all FORBIDDEN), and the `uploadticketattachment` /
`uploadescalationattachment` Deluge functions now require a `[FILE]`-typed argument (the widget's
`attachmentId` call → `INVALID_DATA`; the Functions REST API won't take a multipart file → INVALID_REQUEST).
So the ticket-transfer step is best-effort/silent — the file is safely on the linked CRM record. To also
land it on the Desk ticket, the org must grant the Desk token attachment scope OR fix/redeploy the
upload Deluge functions to the reference `attachmentId` signature; the wiring is already in place.

Verified live (self-cleaning): create ticket + escalation both HTTP 200 with ids + `attached:true`;
browser E2E — wizard step1 (dept cards) → step2 (real deals) → step3 (auto-filled contact/account/
email/phone + type/card/subject/description/attachment), and the escalation form all render. Backend
`pnpm test` (490) green; web typecheck + build green.

> NOTE (concurrent work): a parallel RingCentral integration is in flight in shared files (Shell.tsx,
> dataCenterModals.tsx, app.ts, config/env.ts, + `ringcentral*`). This commit is Create-ticket SOURCE
> ONLY and does not touch those. The vendored `apps/mytrion-crm/app` widget bundle was NOT re-committed
> (a local rebuild would bake in the in-flight RingCentral source) — rebuild + commit the bundle once
> the RingCentral work lands so the deployed widget includes both.

---

## 2026-07-14 — Sales Automations fully wired (self-service widget parity)

Ported the remaining Automations gaps in Sales Mytrion redesign so the Auto tab matches the
reference self-service widget end-to-end against existing touchpoints / Desk creates.

**Was missing / stubbed:** 6 catalog actions showed "not available"; money-code was preview-only;
WEX name/MC search unused; invoice Download was a toast stub; limit types were display labels not
EFS product codes (ULSD/DEF/RFR/DSL); unit/driver prompts not sent on activation; catalog missing
payments, tracking, billing-form, card-last-used, wex-tasks, card-deactivation, efs-login.

**Wired:**
- Expanded `AUTO_LIST` to 22 reference-aligned actions; `RUNNABLE` = all of them.
- New `autoRunners.ts` — dispatch for every action (keeps `AutoTab.tsx` under the 600-line cap).
- Reads: invoices (+ per-row PDF/Excel via `sales_mytrion.invoice_signed_url`), transactions,
  payments (`dwh.payment_info` → Deluge fallback), billing-form, balance, account-status, tracking,
  card-last-used, wex-tasks, WEX search (`wex.application` + `wex.applications_search`).
- Writes: card activate (`dwh.card_activate` + optional `efs.card_info`), deactivate, limits,
  unit/driver, fraud release, override, money-code **draw** (preview on deal select → amount /
  reason / unit → `dwh.money_code_draw`).
- Ticket-style (widget used Zapier / browser-automation): card-replacement, reactivation, BOCA,
  close-app → `createDeskTicket` with matching C-* types (Ops-native path).
- EFS login → opens credentials PDF + logs usage.
- Tiny catalog fix: `dwh.money_code_draw` accepts optional `unit_number` (ServerCRM already did).
- Deal picker enriched with Zoho Deal ids from CRM (needed for Desk ticket creates) + app-only
  deals for BOCA / close / wex-tasks.

**Remaining gaps (blocked without new backends):** live Photon address autocomplete; direct Zapier
email webhook / browser-automation BOCA+close (Desk ticket is the substitute); money-code unit is
forwarded only after the catalog schema allow-list (done).

## 2026-07-14 — Automations export parity (txn PDF/Excel + invoice downloads)

Brought Sales Automations transaction reports and invoice downloads in line with
`zoho-octane/app/self-service` (automation-modal.js + pdf/excel/download-utils).

**Transactions Report (C-15):**
- Client-side PDF/Excel/CSV/Text via vendored `public/vendor/mytrion/{pdf,excel,download}-utils.js`
  (identical to reference) + jsPDF CDN.
- Fetch `dwh.transactions` limit 5000, group by `transaction_id`; merge invoice refs via
  `dwh.transaction_invoices` on first download.
- Full report options: Display Features, Group/Sort/Format, Match By filters, chain chips,
  live filtered totals; export uses `processTransactions` (same filter/sort rules as reference).
- Range presets match reference (`day`…`all_time` + `custom`); `half_year` → custom from/to.

**Invoices:**
- Presets Last 7/30/90 + Custom Range; status ALL / PENDING / PAID.
- Per-row + bulk PDF/Excel: signed-url → blob → `deliverBlob` (named file), sequential bulk with delay.

**Files:** `txnReport.ts`, `txnReportExport.ts`, `txnExportLibs.ts`, `AutoResultPanels.tsx`,
`autoRunners.ts`, `AutoTab.tsx`, vendor scripts under `apps/mytrion-crm/public/vendor/mytrion/`.

## 2026-07-14 — Automations UI: dropdown clip, txn filters, DnD catalog, categories

Follow-up after export parity commit (`792491e`):

1. **Deal/Card dropdown clip** — modal `overflow:hidden` was clipping absolute lists.
   Portaled floating dropdown (`AutoFloatingDrop.tsx`) with flip-up + Escape/outside close.
2. **Txn report filters** — widened results modal (820px); split layout so Display/Output/
   Match By stay in a dedicated scroll pane above the list (`splitLayout` on
   `AutoTransactionsPanel`). Download still runs `processTransactions` → `downloadTxnReport`.
3. **Catalog DnD** — HTML5 drag reorder; order in localStorage
   `sales-auto-catalog-order:<zohoUserId>` (else `sales-auto-catalog-order`). Default =
   `AUTO_LIST` order.
4. **Categories** — section headers with icons: C→Customer Service, Q→Billing, V→Verification,
   M→Management (`AutoCatalog.tsx` + `autoCatalogOrder.ts`).

## 2026-07-14 — Automations UI Polish (Modal-level Results)

- Replaced toasts with inline modal-level success/error banners in `AutoInvoicesPanel` and `AutoTransactionsPanel`.
- Moved general automation run errors (`autoRunErr`) from the config form to a dedicated full-screen error view in the `done` step (matching the success screen).
- Removed redundant toasts from `AutoTab.tsx` since results are now fully visible at the modal level.

## 2026-07-14 — Data Center / Create / Carriers / Tickets batch (COQL 2000, NY EST, Create Lead, paste-to-attach)

- **COQL bulk** — `salesDataCenter.ts` `clampLimit` + `fetchAgentLeads`/`fetchAgentDeals` raised
  200→2000 (verified live: `rows=2000, more=true`), so the Data Center pulls the full owner-scoped
  set instead of one page.
- **Workday clock in NY** — `salesData.ts` `timeParts()` now computes the workday % + clock in
  `America/New_York` via `Intl.DateTimeFormat`, regardless of the viewer's timezone (the floor runs
  on NY hours).
- **Carriers tab filters** — `CarriersTab.tsx` gained the self-service filter bar (status chips with
  live counts, Min-units, Load-limit select, Clear); `live.ts` `searchCarriers(query, limit)` +
  `CarrierSearchVM.unitsNum` back the filtering.
- **Create Lead** — new `CreateLeadForm` (`createTicketForms.tsx`) wired as the Create tab's 3rd mode
  (`CreateTab.tsx`); salutation/firstName/lastName*/companyName*/phone(10-digit) → `leads.create`
  touchpoint (mytrioncreatelead). DUPLICATE_DATA links to the existing lead instead of erroring.
- **Paste-to-attach** — `AttachZone` (Create/Escalation) grabs a clipboard file/image via a document
  paste listener while empty; the Tickets composer input gained `onPaste`. Drag-drop + click already
  existed; paste is the new path.
- Transactions PDF/Excel export parity (self-service) landed earlier via the concurrent Automations
  session (`792491e`/`62e4391`) — not re-done here.

## 2026-07-14 — Automations icons + light-mode picklists

- Mapped each automation to its reference Heroicon from zoho-octane `automations-catalog.js` (e.g. activate=check-circle, deactivate=ban, limits=arrows, fraud=lock, override=gear, txn=bar-chart).
- Svg renderer now splits multi-subpath icons (`z M…`) into separate `<path>` nodes so gear/invoice icons draw correctly.
- Light-mode picklist fix: form inputs/selects/textareas use `--surface` (white) instead of muddy `--alt`; custom chevron on selects; floating deal/card dropdown uses white surface + softer shadow; row hover uses `--surface-2` in light mode.

## 2026-07-14 — AWS MySQL integration (external DB access)

- New `src/integrations/awsMysql.ts` mirrors the DWH Postgres wrapper (`dwh.ts`): a lazy pooled
  `mysql2` connection from `AWS_MYSQL_DATABASE_URL`, exposed as `awsMysqlQuery(sql, params)` +
  `closeAwsMysqlPool()`. Exported from the integrations barrel as `awsMysql`.
- Added dep `mysql2@3.22.6`. Env: `AWS_MYSQL_DATABASE_URL` (URI/password auth) + `AWS_MYSQL_SSL`
  (default on; RDS certs chain to Amazon Root CA in Node's store) + `AWS_MYSQL_READONLY` (default on;
  pins `SET SESSION TRANSACTION READ ONLY` per connection — a read-only DB user is the real guarantee).
- Auth today is URI/password; IAM database auth (via `@aws-sdk/rds-signer`, SDK v3 already present)
  is documented but not wired. Placeholders differ from Postgres: mysql2 uses positional `?`, not `$1`.
- The `.env` URL is a placeholder — real connectivity is gated on RDS network reachability from Render
  (public access + security-group allowlist, or VPC peering), not on code.
- Full how-to in new skill `.claude/skills/external-databases/SKILL.md`. lint (my files) + typecheck +
  490 tests all green.

## 2026-07-14 — Finance Mytrion redesign + restricted FBAC

- Ported `FinanceMytrionDesign/Finance Mytrion.dc.html` into `apps/mytrion-crm/src/mytrions/finance/redesign/`:
  green `.mf-root` theme, boot loader, sidebar (Home / Transactions / Clients / Dashboard), live header,
  Home hero (balance + health ring + KPIs + attention list + live feed + AI insight), tx/client modals,
  dashboard sub-tabs (debtors / payments / fueling patterns). Replaces old `MytrionShell` finance module.
- FBAC: `finance` mytrion now grants **Administrator** profile OR `usernameContainsAny` substring match
  (`Azimov`, `Mirjalol`); `adminBypass: false` so CEO/other admins do not auto-enter unless profile/username
  matches. New field wired in `resolveAccess.ts` + tests.

## 2026-07-14 — Postgres metadata scripts (catalog + per-table)

- Added `metadataScripts/lib/pgCatalog.ts` shared introspection: schemas/tables/columns (incl. UDT),
  PKs/FKs/indexes, `pg_stat_user_tables` activity, deprecation hints from `pg_description` comments.
- `pnpm meta:pg-catalog` — full catalog export to `output/pg-catalog-{dwh|ops}.{json,md}` (`--target ops`
  for app DB). `pnpm meta:pg-table -- <name>` — single-table lookup with column API names + activity.
- `pnpm pg:inspect` — interactive CLI (schemas, table detail, samples). Refactored `meta:dwh` to use
  the shared lib (now includes activity/deprecation fields). typecheck green.

## 2026-07-15 — OpenAI ↔ dbt MCP agentic bridge (Claude parity)

### Goal
Wire the hosted dbt MCP server into Mytrion Ops the same way Claude.ai already uses it: OpenAI
function-calling → `toolDispatcher` → MCP `recall_similar_queries` / `query`, with Zoho worker
identity driving per-user query-memory RAG via **context**, not prompt stuffing.

### mcp-server
- `/` and `/mcp` accept optional `X-User-Email` from trusted `client_credentials` callers
  (mytrion-ops). Domain must match `ALLOWED_EMAIL_DOMAINS` (same gate as Claude OAuth login).
- Identity precedence: header email → JWT email → `client_id`.

### mytrion-ops
- `TenantContext.email` from Zoho OAuth claims (`contextFromClaims`) and optional body `email`
  (API_KEY path). Chat widget sends session worker email on stream body.
- `dbtMcp.ts` forwards `X-User-Email` on tools/call.
- New `dbtMcpTools.ts` + boot registration in `app.ts` behind `FF_DBT_MCP_ENABLED` (writes need
  `FF_DBT_MCP_WRITES`). Tools named `dbt_mcp.*`, admin-only via `applyDepartmentPolicy`.
- Agentic warehouse RAG is tool-driven (recall → live query), not schema stuffed into the system
  prompt; prompt only steers internal users to use those tools when present.
- Tests: `tests/unit/dbt-mcp-tools.test.ts` (identity header + read/write gating).

### Enable
```
FF_DBT_MCP_ENABLED=1
DBT_MCP_URL=https://…/mcp
DBT_MCP_CLIENT_ID=mytrion-ops
DBT_MCP_CLIENT_SECRET=…
# Redeploy mcp-server with the X-User-Email change first.
```

## 2026-07-15 (pm) — Warehouse gallons: id+role scoping via MCP

- Root cause of "agent name isn't found": agent.sales_snapshot resolves the caller by NAME
  (servercrm). Replaced for gallons with `warehouse.my_gallons` (definitions/warehouse_gallons.ts),
  keyed by the verified Zoho USER ID, executed through the dbt MCP `query` tool.
- Identity now forwarded to the MCP as context headers (dbtMcp.ts): X-User-Email, X-User-Id,
  X-User-Name, X-User-Role, X-User-Admin. mcp-server resolve_user_identifier falls back to
  zoho:<X-User-Id> when no email. `dbtIdentityFromContext(ctx)` centralizes the mapping.
- RBAC enforced server-side (SQL built by us): non-admin → LOCKED to own rows; admin → optional
  agentName override or company-wide. Model cannot widen a non-admin's scope. Tool granted to
  sales/manager/analyst manifests; registers only when FF_DBT_MCP_ENABLED.
- **Zoho id prefix gotcha (verified live):** a Zoho id is `<org/zgid prefix><12-digit record id>`.
  Warehouse zoho_users.id was loaded from a different org (prefix 6227679…) than the login session
  mints (6096698…); only the trailing 12 digits match. A plain `id =` join returns nobody — and even
  a suffix join to mart_transaction_line_items.agent yields 0 for most reps because that column
  attributes fuel to closers ("Justin Williams"), not the account owner.
- **DEFINITION (ratified w/ user):** "my gallons" = fuel pumped by the CARRIERS I OWN, not
  agent-attributed rows. Tool now: fetchAgentRoster (servercrm /api/clients/by-agent/<zohoId>, the
  live-CRM id → sidesteps the warehouse prefix mismatch) → sum
  octane.mart_transaction_line_items over those carrier_ids for the period. Non-admin roster is
  locked to self; admin may pass agentZohoUserId or omit for company-wide. Empty book → zeros, no
  warehouse round-trip.
- Tests: tests/unit/dbt-mcp-tools.test.ts (13). Full suite 515 green, typecheck clean.

## 2026-07-15 (pm) — Chat latency: tool routing + compiled-graph cache

Reported: analyst chat "very slow". Measured the flow — data layer is FAST (servercrm ~0.5s,
dbt MCP gallons query ~1s cold/0.5s warm, recall ~1.2s). The time is the LLM agent loop.

- **Root cause of the visible stall:** analyst/manager carry 3 overlapping metric tools
  (analytics.snapshot = cached org-wide, warehouse.my_gallons = per-rep, agent.sales_snapshot =
  name-scoped health) with NO routing in their bare personas → the model fished (called
  agent.sales_snapshot first, failed "agent name isn't found", then retried). Each wrong guess is a
  full LLM round-trip.
  - Fix: added byte-stable METRICS_ROUTING_RULE (shared.ts) to analyst + manager personas — company
    totals → analytics.snapshot (cached, fast); "my"/one-rep → warehouse.my_gallons; portfolio
    health → agent.*; never double-check a number. Byte-stable so it stays in the cached prompt prefix.

- **Compiled-graph cache (FF_AGENT_GRAPH_CACHE, default ON):** buildSingleAgent/buildOrchestrator
  recompiled every turn (admin orchestrator = all 10 subagents + Composio HTTP fetches, ~2.7s in the
  compiler test). Now cached (graphCache.ts) keyed by agent + full caller identity signature.
  - SAFETY: key encodes every identity/authority/VIEW field (tenant, user, role, scopes, departments,
    allDeptAccess, bypass, profiles, callerRole, userName, email, sessionVerified, impersonator,
    client) so no two callers ever share a graph — RBAC leakage suites still green. requestId is the
    only ephemeral field: EXCLUDED from the key and re-sourced from the run context (ALS) at dispatch
    (agentTools.ts) so a reused graph never stamps a stale requestId on audit rows. Promise-cached
    (concurrent callers share one build; failed builds evicted), 10-min TTL, 256-entry LRU bound.
  - Off in tests (vitest.config) so flag-toggling suites compile fresh; dedicated
    tests/unit/agent-graph-cache.test.ts (12) covers signature + cache behavior.

Tests: full suite 527 green, typecheck + lint clean.

## 2026-07-16 — Pre-merge security fixes, Sales-Mytrion cleanup, Wrapper Systems

Security (merge-blocking, all test-pinned):
- **Session-authoritative department access** (FF_SESSION_DEPT_AUTHORITATIVE, default ON):
  withDepartmentAccess no longer trusts x-department-access / x-all-departments for verified
  sessions — any authenticated user could self-elevate and read other agents' pipelines via
  ?zoho_user_id on desk/data-center (+ same gate on ringcentral/retention/knowledge, 5 call
  sites total). Non-admin workers now derive departments from their Zoho profile/role
  (deriveWorkerDepartments); ignored claims warn-logged for roster validation. ROSTER CHECK
  BEFORE PROD: confirm live sales reps' profile/role names substring-match 'sales'; flag=0 is
  the rollback.
- **Desk per-ticket IDOR closed**: comments/reply/attachment now assertTicketOwned
  (cf_crm_created_by_id vs verified CRM user id; 5-min creator cache; admin/act-as exempt).
- **Deal ownership on ticket create**: non-admins may only file tickets on their own deals
  (fetchDealOwnerId COQL check, denials audited); dealId schema tightened to numeric.
- **RingCentral**: embed-config no longer ships clientSecret/JWT to the browser by default;
  RINGCENTRAL_BROWSER_CREDS_ACK=1 knowingly restores Phase-1 JWT auto-login (audited).
- Known/left: servercrm public WS inbox subscription is a servercrm-side fix.

Sales Mytrion (apps/mytrion-crm):
- Deleted 22 dead MytrionShell-era sales/*.tsx files (~4k lines); data.ts/index.tsx/redesign kept.
- USER stub removed (PoolTab uses useSessionUser); HomeTab uses the shared inboxRead store;
  inboxRead/ticketUnread localStorage keys now user-scoped (act-as aware).
- Ticket list pages to ~495 tickets (limit 99 × ≤5 pages, dedup, stops on short/windowed page) so
  WS badges see the full open set; reply composer clears only on success; inbox delete rolls back.
- AutoTab split (616→556 lines; WEX panel → AutoWexPanel.tsx with a request-seq race guard);
  NY-calendar date helpers (nyToday/nyDaysAgo) replace UTC toISOString; export timeOnly is
  literal-first so date+time agree; jsPDF vendored (public/vendor/mytrion, pinned jspdf@2.5.1
  devDep) — no CDN at runtime. README rewritten (was the deleted SDK-widget model);
  ARCHITECTURE.md §2/§3/§6/§8/§9 updated to the OAuth-session reality.

Wrapper Systems (integrations/, facades kept — consumer migration is a follow-up):
- core/: BaseWrapper (health never throws) + HttpWrapper (fetchWithTimeout, 401-retry-once hook,
  overridable error factory) + SqlWrapper ('$n' vs '?' dialect + readOnly contract) + registry
  with lazy handles (Composio SDK never loads at boot via the registry).
- wrapper.ts → zohoAuth.ts (ZohoAuthService; adds in-flight dedup); zohoBase.ts ZohoWrapper;
  ZohoCrm/ZohoDesk/ZohoPeople wrappers (Desk+People gain timeouts — were bare fetch);
  ServerCrm/Dwh/CmpDatabase(awsMysql)/Cmp/Composio/InternalDb(health-only; repos stay the sole
  query path)/RingCentral (the Custom Wrapper exemplar; env left the route). Every old free
  function remains as a @deprecated 1-line facade — all pre-existing tests pass.
- New GET /v1/health/integrations (admin-gated; ?live=1 runs cheap probes). /v1/health untouched.

Tests: full suite 551 green (was 511), typecheck + lint clean. All commits on feature/MytrionSetup.

## 2026-07-16 — Mytrion Admin "CMP Database" schema tab

Live, read-only schema browser for the CMP MySQL (`cmpDb`/tss_db, via SSH tunnel) so developers
can see structure at a glance. Backend + frontend, gated to real admins.

- **Backend** `src/modules/cmpSchema/service.ts` — `getCmpSchema()` reads `information_schema`
  only (tables + columns), stitched into a nested `CmpSchemaSnapshot` (tables → columns). Surfaces
  data types, PK/UQ/FK keys, nullability, defaults/extra, engine-approx `table_rows`, and each
  table's `UPDATE_TIME`/`CREATE_TIME` (the "actively updated?" signal — verified live: 79/92 tables
  carry a real update time; views null as expected). Raw SQL lives in the module, NOT routes/
  (repo rule 2); runs through the read-only `cmpDb` session. DB name resolves from
  AWS_MYSQL_DATABASE else `SELECT DATABASE()`.
- **Route** `GET /v1/admin/cmp-schema` (`cmpSchema.routes.ts`, registered in app.ts) — internal
  audience + `allDepartmentAccess` (the same "true admin" bar as /admin/agents, since it reveals
  the full internal schema incl. sensitive table/column names). Audit-logged (ok/denied/error).
  503 when unconfigured, 502 when the DB/tunnel is unreachable. Never returns row data.
- **Frontend** new Admin tab "CMP Database" (DatabaseIcon): `api/cmpSchema.ts` client +
  `admin/CmpDatabase.tsx` + scoped `CmpDatabase.module.css` (admin.module.css already 919 lines,
  over the 600 cap — didn't grow it). Search over table AND column names (column-only matches
  auto-expand the table + show an "N col match" hint); All/Tables/Views + "Active (<24h)" filters;
  per-table Live/Recent/Idle activity pill from update_time; expand/collapse (+ expand-all); stat
  tiles (tables, columns, updated<24h, views); Refresh.
- Verify: backend typecheck+lint+build clean; frontend typecheck + vite build clean; live probe
  through the real service OK (92 tables / 948 columns). Test suite 550 green; the 1 red
  (approvals.test.ts telegram send) is pre-existing + env-driven (real TELEGRAM_* in local .env) —
  fails identically on a clean stash, unrelated to this change. On feature/AdminSetup.

## 2026-07-16 — Onboarding / context refresh

- Reviewed the project entrypoints and guardrails: `src/server.ts` boots migrations, jobs, and graceful shutdown; `src/app.ts` builds the Fastify app with shared plugins, static widget/mini-app serving, optional MCP discovery, and all versioned routes under `API_PREFIX`.
- Confirmed the core invariants that shape the codebase: strict TypeScript ESM with explicit `.js` imports, DB access only through `src/repos/*`, and every tool flowing through `ToolManifest` + `toolDispatcher` for input validation, RBAC, audit logging, and tool-call persistence.
- Re-read the runtime config and tests that matter most for safety: env parsing lives in `src/config/env.ts`, and `tests/unit/agent-rbac-leakage.test.ts` protects the department-scoped retrieval/tool binding rules that prevent cross-tenant or cross-department leakage.
- Current mental model: Octane is a typed internal AI backend for employees and partners, centered on chat/RAG plus a curated tool catalog for Zoho, analytics, files, Telegram, and related integrations.

## 2026-07-17 — Mytrion Admin "Data Warehouse" schema tab (+ shared SchemaBrowser)

Added a DWH tab mirroring the CMP Database tab, covering ALL schemas. Refactored the CMP tab's guts
into a shared component so the two are literally the same UI.

- **Backend** `src/modules/dwhSchema/service.ts` — `getDwhSchema()` reads pg_catalog only (not
  information_schema, which is privilege-filtered AND omits matviews). 4 parallel queries: relations
  (pg_class+pg_namespace+pg_stat_all_tables), columns (pg_attribute+format_type+pg_attrdef +
  col_description), PK/UNIQUE (pg_index), FK (pg_constraint). Postgres has no UPDATE_TIME, so
  `updateTime` = greatest(last_vacuum, last_autovacuum, last_analyze, last_autoanalyze) — a real
  "recently active" signal (autoanalyze fires on dbt rebuilds). Row estimate = reltuples/n_live_tup.
  Column key role emitted as PRI/UNI/MUL to reuse the FE keyTag as-is. Returns the SAME snapshot
  shape as cmpSchema + `schema` per table and a `schemas` list. Raw SQL in the module, not routes/
  (rule 2); runs through the enforced read-only `dwh` pool.
- **Route** `GET /v1/admin/dwh-schema` (`dwhSchema.routes.ts`, registered in app.ts) — identical
  gate to cmp-schema (internal + allDepartmentAccess), audit-logged, 503/502.
- **Frontend** refactored `CmpDatabase.tsx` → shared `SchemaBrowser.tsx` (+ `SchemaBrowser.module.css`,
  renamed from CmpDatabase.module.css). `CmpDatabase`/`DwhDatabase` are now thin wrappers passing
  title/subtitle/fetcher/icon. Shared types in `api/schema.ts` (`DbSchemaSnapshot`); `api/cmpSchema.ts`
  + new `api/dwhSchema.ts` both return it. The schema dimension (a `<select>` filter, a per-row
  schema badge, a "Schemas" stat tile, schema-qualified expand keys) appears only when the source
  reports multiple schemas — so CMP is unchanged, DWH gains it. New `WarehouseIcon`; DWH tab wired
  into admin/index.tsx after CMP.
- Live probe (real DWH): **16 schemas, 1321 tables, 20,515 columns in 1.3s** — 366 tables with a
  freshness time, 76 with a PK, views null as expected. Note: pg_catalog surfaces 16 schemas vs
  information_schema's privilege-filtered 12 (bahodir/shohruh/octane_hr/… now visible) — the "all
  schemas" ask. Verify: backend+frontend typecheck, backend+frontend build, backend lint all clean;
  tests 550 green (same 1 pre-existing telegram-env failure as the CMP session). On feature/AdminSetup.

## 2026-07-17 — CMP tunnel automation (always-present, no manual ssh)

The CMP MySQL is AWS RDS in a private VPC (not publicly reachable like the DWH's public-IP
Postgres), so it needs an SSH tunnel through the bastion EC2. Made that automatic so the Admin →
CMP Database tab works without anyone running ssh by hand.

- `scripts/db-tunnel.sh` — auto-reconnecting tunnel (local 3307 → bastion → RDS 3306). Reads
  MYSQL_SSH_*/MYSQL_DB_* from env→.env; keepalive (ServerAliveInterval); self-heals on drop;
  no-ops cleanly (exit 0) if unconfigured or the key is missing (DWH-only/CI unaffected); reuses
  an already-open port instead of double-binding. `pnpm tunnel` runs it standalone.
- `scripts/dev-local.sh` — `pnpm dev:all` now starts the tunnel alongside API+web and stops it on
  exit (added TUNNEL_PID to the cleanup trap).
- `.env` MYSQL_SSH_KEYFILE repointed to `~/.config/octane/dbtunnel_key` (was a stale path from
  another machine). NOTE: the key must be placed there once — I could not relocate the credential
  myself (blocked), so it's a manual one-time step for the dev.
- CMP remains metadata-only + read-only: the tab only queries information_schema (never records),
  session is AWS_MYSQL_READONLY. Verified live: CMP fetch OK (93 tables, 949 cols, 1.5s).
- PROD ("direct like DWH", no tunnel) still needs a one-time AWS change (make RDS reachable: public
  + SG allowlist, or same-VPC). Code is already direct-ready — then it's config only
  (AWS_MYSQL_HOST=<rds endpoint>, PORT 3306, AWS_MYSQL_SSL=1). On feature/AdminSetup.
