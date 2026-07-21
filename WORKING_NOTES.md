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
- Ticket-style writes initially stubbed via Desk (later replaced — see 2026-07-18: real Zapier +
  browser-automation touchpoints for card-replacement, reactivation, BOCA, close-app).
- EFS login → opens credentials PDF + logs usage.
- Tiny catalog fix: `dwh.money_code_draw` accepts optional `unit_number` (ServerCRM already did).
- Deal picker enriched with Zoho Deal ids from CRM + app-only deals for BOCA / close / wex-tasks.

**Remaining gaps:** live Photon address autocomplete for card replacement (optional UX polish).

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

## 2026-07-17 — Internal User Management (DB-backed Mytrion access control)

Admins control which Zoho worker accesses which Mytrion, server-authoritative. Sales Agent
auto-routes to Sales; Administrator lands on the picker; per-user + per-profile overrides.

- **Data model**: two tenant-isolated tables — `mytrion_profile_defaults` (per Zoho profile:
  allowed Mytrions + home + all-access) and `worker_mytrion_access` (per-user override: allow
  replace/inherit, deny subtract, home, all-access). Hand-written migration `0024_mytrion_access.sql`
  + journal entry (drizzle `db:generate` is BLOCKED by a pre-existing snapshot fork on origin/build —
  0022/0023 both prevId f827055a + orphan 0024 snapshot; NOT ours, and runtime `migrate` ignores
  snapshots so the hand-written SQL deploys fine). Taxonomy in `src/lib/mytrions.ts` (MYTRION_IDS,
  MYTRION_DEPARTMENT, DEFAULT_PROFILE_SEED for the 8 profiles).
- **Resolver** `src/modules/access/mytrionAccessService.ts` — the single authority. profile default →
  per-user override → env-admin FLOOR (resolveAllDepartmentAccess; DB can never lower a real admin) →
  accessible set/departments/home. UNMANAGED workers (no profile default AND no override) fall back to
  legacy `deriveWorkerDepartments` → non-breaking rollout. Fails OPEN to legacy on DB error. TTL-cached
  (60s) keyed on the full identity (tenant+user+profile+role+name) so a profile change refreshes and
  tests don't collide; invalidateUser (prefix) / invalidateAll (profile edits).
- **Injection**: `authService.contextFromClaims` is now async → resolves departments +
  allDepartmentAccess from the DB (the ONE authoritative point; ToolRegistry/agentRegistry/knowledge
  all become DB-driven). `callerIdentity.verifiedWorkerDepartments` = body VIEW ∩ grant (narrow only,
  never widen; empty view-intersection = no access, NOT fallback-to-grant). `helpers.withDepartmentAccess`
  sources ctx.departments (DB grant). Retired FF_WORKER_DEPT_STRICT reliance. `/auth/me` + Zoho callback
  surface accessibleMytrions/homeMytrion/allDepartmentAccess.
- **Admin CRUD** `mytrionAccess.routes.ts` (allDepartmentAccess gate, Zod-validated vs MYTRION_IDS,
  audited): GET/POST users + profiles; profiles auto-seed on first read.
- **Frontend**: session/userContext/resolveAccess consume the server list (static mytrions.config is
  now dev-mock/legacy fallback only); Landing auto-routes to homeMytrion; UserContextProvider refreshes
  /auth/me on boot so admin edits apply on reload (not just re-login). New Admin tab "User Management"
  (UserManagement + UserAccessForm + ProfileDefaults + api/mytrionAccess + AccessIcon).
- **OAuth enforced now**: FF_ZOHO_OAUTH_ENABLED=1 (per decision). PROD: set it in the Render env group.
- Verify: backend typecheck+lint(0 err)+build + 562 tests green (incl. RBAC-leakage/header-elevation/
  IDOR/deal-ownership); frontend typecheck+52 tests+build green. Fixed a pre-existing BOM lint error in
  the merged apps/mini-app/src/lib/txnExport.ts. On feature/AdminSetup.

## 2026-07-17 (pm) — Access-control: RBAC review fixes + multi-Mytrion + non-admin "View as"

Adversarial RBAC review (4 lenses → verify): NO escalation/leakage found; all findings were
fail-safe (denial/lockout). Fixes applied to the resolver + auth path:
- deny-list exempt for env-admins (no-lockout end-to-end); non-admin all-access+denies DOWNGRADES to
  an explicit department grant so the deny actually enforces (allDept=true is a full bypass);
  "inherit" override with no seeded profile default falls back to the legacy floor (not empty);
  DB-error fail-open now serves LAST-KNOWN-GOOD (new lastGood map) + caches degraded results only
  5s (not 60s) so recovery self-corrects; act-as resolves the TARGET's DB grant (not the raw body
  view); seed invalidates the resolver cache; departmentsForMytrions drops the 'admin' placeholder.
- #4 (pre-existing HIGH): email/password JWT sessions were not sessionVerified → self-elevate via
  headers. Marked sessionVerified (they ARE signed sessions) → claims ignored; /auth/me guards the
  worker payload to `zoho:` sessions. FLAGGED (still open, pre-existing): #7 admin-marker SUBSTRING
  match in department.ts can over-grant ('manager' ⊂ 'Account Manager') — tighten ADMIN_PROFILE_MARKERS
  to exact names; doesn't bite the current profile set.

Multi-Mytrion: already supported (allowedMytrions is a set) — custom-list mode grants many; Landing
auto-routes to homeMytrion when set+accessible, else the picker shows all accessible.

"View as" for NON-admins (targeted impersonation): new `worker_mytrion_access.view_as_user_ids`
(migration 0025, applied to prod). Resolver → ResolvedAccess.viewAsUserIds → ctx.viewAsUserIds.
buildCallerContext act-as gate now allows admin (anyone) OR a non-admin whose grant includes the
target; actAsContext runs as the target's OWN resolved grant, with an ESCALATION GUARD — a non-admin
can never view-as an all-access (admin) target (fail-closed + audited). /auth/me + callback surface
viewAsUserIds + resolved viewAsTargets; TopBar shows the (renamed) "View as" picker for granted
non-admins with a scoped target list; UserAccessForm gains a "Can view as" multi-select (admin-only
targets excluded). Verify: 567 backend tests + FE typecheck/build green; migrations 0024+0025 on prod.
## 2026-07-16 (pm) — Customer Service Mytrion: full live port (branch feature/customer-service-mytrion)

Migrated the zoho-octane `app/mytrion-customer-service` widget onto the app, Sales-playbook style
(backend surface first, then a live-data pass over the existing CS scaffold UI — design unchanged).
Scope: Home, Applications, Citifuel, Analytics + Data Center (fully coded in the widget but
nav-disabled there); Inbox/Service Center stay "Soon" stubs; dept AI chat via MytrionShell.

Backend:
- `zohoCrmRecords.ts` — CRM v8 record CRUD/search/fields wrapper; every mutation checks the
  PER-ROW response code (Zoho 200s row-level failures and silently drops wrong-cased fields).
- `modules/customerService/fieldResolver.ts` — live `/settings/fields` metadata (15-min cache)
  resolves the org's ambiguous field casings (Limits_added/Limits_Added, Chain_policy/…); an
  unknown key is a 400, never Zoho's silent no-op. Verified live: the module's real casings are
  Limits_Added / Chain_Policy / Mobile_Driver_App.
- Touchpoints `cs.*` (csDeluge.ts): home.metrics / applications.list / analytics.maintenance /
  datacenter.deals — all `departments: ['customer-service']`; unwrap modes matched to each
  function's real envelope. Gotcha: the datacenter full-load sentinel is `lastSyncTime: ''` —
  shortText's min(1) 400'd it (found in browser verify).
- Routes: `/cs/applications/:id` + `/onboarding` (edit-modal save + tick-boxes with Edit_History
  APPEND, session-authoritative Who_Edited, DEAL_FIELD_MAP mirror best-effort with warning);
  `/cs/citifuel` list/meta/stats/lookups + CRUD (stats are server-built COQL — the widget's
  client-supplied-COQL `citigetstats` is deliberately NOT reproduced); `/cs/analytics/{tickets,
  calls}` DWH proxy with server-side scope forcing (non-managers locked to their own Desk
  assignee/owner email via the roster email join; unmatched ⇒ explicit flag, never org-wide),
  `/cs/analytics/roster` (manager-only), `/cs/analytics/tickets/team-open` (narrow team aggregate
  for Home — parity: every agent sees team totals, never per-agent detail), `/cs/context`
  (backend manager verdict), `/cs/data-center/deals/:id` (billing allowlist).
- Manager tier: CS_MANAGER_ROLE_MARKERS env (substring vs profile+role) replaces the widget's
  hardcoded name allowlist. RBAC facts verified against the live roster: there are NO
  'Customer Service'/'Support' profiles — CS staff are Zoho ROLES 'Customer Service Agent' (20)
  / 'Customer Service Manager' (2); dept derivation via deriveWorkerDepartments matches on role.
- `mytrionGetDeskAgents` Deluge is NOT_ACTIVE in the org (verified live) — roster now sources
  from Desk REST `GET /agents` (new zohoDesk.listAgents, 133 agents) with Deluge as fallback.

Frontend (apps/mytrion-crm):
- `api/cs.ts` (dept pinned to customer-service — `callTouchpoint` defaults to sales, footgun),
  cs.* touchpointTypes, `useLoad` extracted to `mytrions/_shared/useLoad.ts` (sales re-exports).
- `customer-service/live.ts` maps real payloads onto the scaffold's view-model shapes:
  applications rows (alias-tolerant casing reads), citifuel rows (+raw record for the edit
  round-trip), analytics blocks (daily/byPriority/byStatus + email-join leaderboard),
  data-center deals with sessionStorage cache + COQL-timestamp delta sync (widget parity).
- Panels wired live with loading/error/empty states; Applications gets server-driven
  search/pagination + optimistic onboarding toggles + a full edit form; Citifuel gets live
  status tabs/stats + Accounts/user typeaheads + create/edit/delete; Analytics renders the
  leaderboard only on the `/cs/context` verdict; NEW DataCenter tab + billing edit modal.
- Improvement over the widget: "My Tickets (Month)" works (the widget couldn't — no Desk↔CRM
  id mapping; our backend joins by email).

Verified live in the browser (dev mock-auth, admin): all five panels render REAL data —
1203 team open tickets + priority histogram, 200+ applications from mytrionGetApplications,
515 Citifuel clients with live COQL stats, analytics KPIs/volume/leaderboard with real agent
names, 7,915 Data Center deals. Writes (Applications save/tick, Citifuel CRUD, Deal billing)
are wired but deliberately NOT exercised against prod CRM — verify with a real CS login on a
scratch record. 571 backend + 49 app tests green.

Left for follow-up: Applications Zip_Code/Address edit fields (not in the condensed view-model),
merged tickets+calls leaderboard (widget merged by email; we render per-tab boards), Inbox /
Service Center panels (mock-only in the widget too), Deluge home-metrics identity for admin
API-key callers (no zoho id → team cards only).

## 2026-07-17 — Customer Service Mytrion: re-skin to the zoho-octane widget design

The CS module (Home/Applications/Citifuel/Analytics + shell) was re-skinned from the app's
Tailwind chrome to the ORIGINAL widget's "Paper White / Royal Blue" design system — the whole
live backend + live.ts data layer is unchanged; this is presentation only.

- `styles/`: the widget's CSS (`zoho-octane/app/mytrion-customer-service/css/`) ported and
  machine-scoped under `.cs-root` (scripted; brace-aware, maps :root/body/#app-shell → .cs-root)
  so its globals can't leak into the other Mytrions. `overrides.css` (hand-written) holds the
  floating-copilot styles + SPA-hosting tweaks. Instrument Sans added to index.html fonts.
- `Shell.tsx`: 1:1 port of the widget shell (cs-sidebar/cs-body/cs-content + mobile bottom nav +
  light/dark toggle w/ the widget's localStorage key). Panels lazy-mount and stay mounted.
- Home / Applications (+ ApplicationsTable) / ApplicationModal: widget cs-* markup; single
  view+edit application modal with inline onboarding tick-boxes + copy-id toasts + colors.ts
  (widget picklist-color system).
- Citifuel: cs-citi-* summary cards + live status tabs + sortable cs-table + cs-badge cells +
  pagination. **CitiModal + CitiEdit merged into ONE** widget-style sectioned form (Client/
  Request/Contact/Notes/Audit) doing view+edit+create+delete with Accounts/user lookups
  (`CitiEdit.tsx` deleted).
- Analytics: cs-an-* KPI grid + SVG spark trend (areaPath/sparkPoints, sparkH=60) + donut
  breakdown (conic-gradient) + agent leaderboard (manager-tier only, backend also enforces);
  data sub-tabs + range select.

Product changes this session (per user):
- **Data Center is now a "Soon" stub** (disabled nav item like Inbox/Service Center);
  `DataCenter.tsx` kept on disk, unimported, for when it's re-enabled.
- **AI Chat is a floating launcher** (`CsCopilot.tsx`), not a nav tab — mirrors the Sales
  Mytrion copilot, CS-themed; streams from /v1/agent via useChat (customer-service dept).
- Local `.env` now points MYTRION_OPS_DATABASE_URL at the **Render production DB** (was local
  Docker); `FF_ORCHESTRATOR_ENABLED=1` so the copilot's agent endpoint works. Both are in the
  gitignored `.env` (not committed).

Verified live in-browser (Render DB, dev mock-auth admin, 1440px): widget shell + all panels
render in the Paper White design with real data — 1225 team open tickets, 515 Citifuel clients
(edit modal round-trips), analytics KPI/donut/leaderboard with real agent names, floating
copilot streams a tool-grounded answer. 571 backend + 49 app tests green; vendored bundle
rebuilt. Still unpushed on feature/customer-service-mytrion.
## 2026-07-17 — Mini-app: driver row scoping moved server-side (own card only)

Pre-presentation review of the carrier mini-app surfaced a live data leak in the three driver
services, fixed here. Service-catalog decisions (which services per role) are still open.

- **The bug.** `/carrier/mini-app/{transactions,last-used,status}` returned servercrm's CARRIER-wide
  rows and the mini-app filtered to the driver's card **in the browser** (`App.tsx` `rowIsOwnCard`).
  The driver's device therefore received the whole fleet's fuel history; only the render was scoped.
  Contradicted OCTANE_MINIAPP_SERVICES_SPEC §2 ("own card only") and §6 ("carrier resolved from the
  session"). Endpoints are also reachable directly with any valid initData, so the UI filter was not
  a boundary at all.
- **Worse: the filter was wrong.** `rowIsOwnCard` compared **last-4**, which is NOT unique within a
  carrier. Live DWH probe: carrier `5805408` has **11 active cards sharing last-4 `7593`** (5807078
  has 10 on `7547`). Those drivers saw each other's rows *as their own*.
- **Fix.** New `src/modules/carrier/driverCardScope.ts` — `scopeRowsToCard` matches on the **full**
  number (probe confirmed `octane.stg_cmp_card.card_number` and
  `octane.mart_transaction_line_items.card_number` are both bare 19-digit strings, so `=` is the
  correct join), plus `scopeTransactionsToCard` which also **recomputes `totals`** from the scoped
  rows — passing servercrm's carrier-accumulated totals through would have leaked fleet spend even
  with rows filtered. Routes call it for `profile === 'driver'` only; owners stay carrier-wide.
- **Fail-closed.** `requireDriverCardNumber` 503s (`DRIVER_CARD_UNRESOLVED`) when the DWH can't
  resolve the card, and throws *before* the fetch. `resolveDriverCardNumber` is best-effort/null
  elsewhere; here null must never degrade to carrier-wide rows.
- **Pagination trap.** The wrapper asked for `limit: 100` fleet-wide, so filtering after the fact
  could show a driver an empty list while page 1 held only other cards' rows. Driver reads now
  request servercrm's 5000 ceiling (`DRIVER_TXN_FETCH_LIMIT`) and set `scope_truncated: true` when
  upstream reports `more_records` — short lists are surfaced, not silently under-reported.
- **Considered and rejected: querying the DWH directly from mytrion.** `agentDwh.getCarrierTransactions`
  merges a **live EFS gap-fill** on top of the mart (~3h refresh lag), so a direct mart read would
  silently drop the newest transactions — exactly what a driver is checking on.
- Removed the client-side `rowIsOwnCard` filters (server is authoritative now) + a comment warning
  against re-adding one.
- **Follow-up (right long-term fix):** give servercrm's `/api/agent/dwh/transactions/:carrierId` a
  `cardNumber` filter so scoping happens at the source; the mytrion-side filter should stay as
  defense-in-depth regardless. Note `servercrm` local checkout is **98 commits behind origin/build**
  (money-code routes exist there, not locally) — pull before judging what's available.
- Verify: backend typecheck + lint clean (2 warnings, both pre-existing), backend build clean,
  mini-app typecheck + build clean, **558/558 tests green** (7 new, incl. an 11-cards-share-last-4
  regression test and a fail-closed test). On `build`.

## 2026-07-17 — Mini-app: progressive transactions + report delivered via the bot

Two changes, both driven by measurement. servercrm and zoho-octane are UNTOUCHED — the widgets'
endpoints and Deluge functions are byte-for-byte as they were.

### Why: the Transactions sheet was 3.4–24.5s

Measured against the real deployed servercrm (`/api/agent/dwh/transactions`):

| call | time | rows |
|---|--:|--:|
| carrier 5765985 month | 24.5s cold / **9.3s warm** | 21 (`live_merged=0`) |
| carrier 5776046 month | 11.1s / **3.4s warm** | 699 (`live_merged=3`) |
| same, `limit=100` (old default) | 3.6s | 103 |

The cost is the live EFS SOAP leg, NOT the DWH query or the row count — 5765985 merged **zero** rows
and still took 9.3s, and `limit=100` vs `limit=5000` differed by ~200ms. (That also retires the
"raising the limit adds load" worry from the earlier session: it doesn't.)

Three-way data audit first, carrier 5765985 / 30d — the sources AGREE, so this is purely a latency
problem, not a correctness one:
- `EFS ∩ mart = 29` (all of EFS), **`EFS \ mart = 0`**, `mart ∩ cmp_transaction = 30`.
- EFS *is* fresher at the tail: on busy carrier 5776046 it held **17 rows newer than the mart's max**.
  So the gap-fill earns its keep — it just must not sit in the request path.
- **`/api/companies/:id/billing-history` is NOT transactions** — it's a balance ledger
  (`amount`, `balanceBefore→balanceAfter`, `refNum`). No card, location, or fuel quantity. It suits
  "payment status" / "add funds", not the Transactions sheet.
- CMP REST `/api/transactions` does work, but only `carrierId` + `cardNumber` filter — `companyId`,
  `carrier_id`, `id` are silently IGNORED (Spring drops unknown params) and you get the unfiltered
  global feed at HTTP 200. Its date params don't work either and it caps at 2000 rows. Not usable.

### What changed (option A — mytrion merges, servercrm untouched)

- **`src/integrations/dwhTransactions.ts`** — reads `octane.mart_transaction_line_items` directly,
  skipping the EFS leg. **568–684ms** vs 3.4–24.5s. The ET range vocabulary and the `totals` key
  names are a faithful port of servercrm (`_resolveRange`, `countDwhTransactions`) ON PURPOSE: both
  phases must resolve the same window or rows would jump between paint and refresh.
- **`POST /carrier/mini-app/transactions` gained `live`** (default **false**, so an unaware caller
  gets the fast path). false → DWH-only + `live: {pending: true}`; true → servercrm's existing
  merged endpoint. Drivers are scoped in both — at the SQL level on the fast path.
- **Mini-app** paints phase 1, then folds in phase 2 with a quiet "checking for newer" line. A failed
  upgrade keeps the real rows rather than throwing an error screen.
- **Fixed my own bug from the earlier session:** `driverCardScope.scopeTransactionsToCard` was
  rebuilding `totals` with invented keys (`line_items_total`, `sum_amount`, …). Those are
  servercrm's SQL *aliases*; its returned object uses `transactions`/`line_items`/`funded_total`/
  `fuel_quantity`/`total_fuel_quantity`/`discount_amount`. Now shared via `totalsFromRows`.

### Report → Telegram document

The sheet's CSV/Excel/Text buttons no longer blob-download (a Telegram WebView can't reliably save a
file); the bot delivers the report to the user's chat instead.
- `sendDocument` (multipart) + `TelegramChatUnreachableError` in `telegramCarrierBot.ts`. A bot
  cannot message first, so a 403 is surfaced as 409 `TELEGRAM_CHAT_UNREACHABLE` → "open the bot chat
  first", not a generic failure.
- `src/modules/carrier/txnReport.ts` — server-side builder (port of the mini-app's `txnExport.ts`,
  which is now **deleted**: keeping two copies of the grid would only drift).
- `POST /carrier/mini-app/transactions/export` — reads the FAST path (a report is a record of a
  window, not a live view), driver-scoped, 404s an empty window instead of sending an empty file,
  audit-logged. Chat target is `telegramChatId ?? telegramUserId` — a private chat's id IS the user
  id, and `telegramChatId` is only populated when redeem happened to carry the header.
- **Real-data verification caught a bug the mocks didn't:** `pg` returns `transaction_date` as a
  Date, and `String(date).slice(0,10)` renders `"Thu Jul 16"` — the year is gone. The mini-app never
  hit it (JSON serialises Dates to ISO); this builder reads rows before that. Fixed via `dateCell`
  (local parts, not `toISOString`, which would shift the naive timestamp and can roll the day back).
  Pinned by a test.

Verify: report rendered from REAL DWH rows — dates `2026-07-16`, PAN masked to `****7549`, 0 full
PANs in the file, BOM present, totals match the DWH exactly (644.56 gal / $2824.46 / $360.51).
565 tests green (21 in this suite), lint clean (2 pre-existing warnings), backend + mini-app
typecheck and build clean. The bot's `sendDocument` leg is unit-tested but NOT exercised against
live Telegram — no test registration to send to. On `build`.

**Still open:** `carrierMiniApp.routes.ts` is now 1117 lines against CLAUDE.md's 600 cap (it was 960
before this work) — it wants splitting into admin / registration / self-service route modules.

## 2026-07-17 — Client-facing reports: real XLSX + branded PDF

The export files go to carriers, so they became branded documents. Formats are now **CSV / XLSX /
PDF** (the old `.xls` was an HTML table Excel merely tolerates, and plain-text is superseded).

- **No new deps** — `exceljs` ^4.4.0 and `pdfkit` ^0.19.1 were already in package.json.
- **Not built on `modules/files/generate/{excel,pdf}.ts`.** Those render agent-emitted specs with
  equal-width, left-aligned columns — fine for a data dump, wrong for a client document with 9
  columns and money in three of them. `modules/carrier/txnReport.ts` owns the column spec (per-column
  weight / alignment / Excel numFmt) and both renderers read from it.
- **Brand.** `DESIGN_SPEC.md` §8 says the accent is an amber→orange CTA — **stale**. `global.css` is
  authoritative: the v2 rebrand moved buttons to blue (`--primary: #2451ff`) but kept the logo
  gradient as the mark (`--brand-amber #ffd200` → `--brand-orange #ff5a00`, logo stops
  `#ffdd1e/#ffba18/#ff520a`). A document carries the mark, not a button, so it uses the gradient.
- **XLSX**: ink title band + gradient subtitle rule, frozen header, autofilter, per-column widths,
  `$#,##0.00` / `#,##0.00` number formats, zebra rows, and **real `SUM()` formulas** in the totals row
  so the sheet stays correct if a client filters or edits.
- **PDF**: landscape A4, ink header band + gradient rule, dark table header repeated on every page,
  zebra rows, right-aligned money, orange totals rule, footer with generated stamp + page numbers.
  Guarded at 2000 rows (413 `TXN_EXPORT_TOO_LARGE`, pointing at Excel/CSV).
- **Bug caught by rendering the PDF and looking at it:** `→` came out as `!'`. pdfkit's built-in
  Helvetica is WinAnsi-encoded and silently garbles anything outside that set rather than failing.
  `pdfSafe()` maps arrows to an en-dash and drops other unencodable characters (embedding a Unicode
  TTF would cost ~300KB per PDF for one arrow). `•` was fine — U+2022 is in WinAnsi.

Verify (real rows, carrier 5765985, 21 line items): `file` reports **"Microsoft Excel 2007+"** and
**"PDF document, 1 pages"** — a real xlsx, not the HTML hack. Build 21–29ms, Telegram upload
146–420ms. PDF rendered to PNG and visually checked: header/gradient/zebra/totals all correct, and
the arrow fix confirmed. All three sent to a real Telegram chat. 602 tests green, lint/typecheck/
build clean both sides.

Measured earlier the same session (real routes, carrier 5765985): FAST 287–1022ms vs LIVE
2038–11503ms — and `day` showed FAST rows=0 / LIVE rows=2 `efs+2`, i.e. the progressive split
earning its keep. Also note carrier **5836348 (MMB TRANSPORT INC) has zero transactions** and
inactive cards, so it cannot demo; **1825 carriers** have 30-day data, and the fast path holds at
242–810ms across a largest/median/small sample.

## 2026-07-17 — Mini-app session wrap: what shipped, and the two follow-ups

Branch `feature/mini-app-transactions`, 23 commits on top of `origin/build`. Not pushed.
Gate at every commit: 619 tests green, lint clean (2 pre-existing warnings), backend + mini-app
typecheck and build clean.

### Shipped

**Security** (all found by measuring, not by reading):
- Driver rows were filtered in the BROWSER — the device received the whole fleet's fuel history, and
  the match was on last-4, which is not unique within a carrier (live probe: carrier 5805408 has 11
  active cards ending 7593, so those drivers saw each other's rows as their own). Now scoped
  server-side on the full 19-digit number, fail-closed.
- `invoices` / `invoices/signed-url` / `payment-info` accepted any driver's initData (verified: 200,
  4 invoices). New `requireRegisteredOwnerUser` — NOT `requireRegisteredOwner`, which also demands
  fleet-manager because it guards driver management; an owner-operator still owns the account.
- Revoke bricked the Telegram account: the rebind guard fired on revoked rows AND the upsert never
  cleared `status`/`revokedAt`, so redeem returned 201 while every later request 403'd.
- The card number was FABRICATED when the DWH had not resolved it ('5412 7734 90' + a hardcoded
  '7549' fallback) and Copy put that fiction on the clipboard. Now skeletons.

**Correctness**
- pg returns `timestamp without time zone` as a local Date; JSON then emits UTC — the fast phase
  showed 16:59 for a 21:59 transaction while servercrm's phase showed 21:59, and the PDF showed a
  third answer. Normalised in `dwhTransactions.naiveTimestamp`.
- servercrm's EFS gap-fill reaches outside the asked-for window and its totals are DWH-only, so
  "Today" listed two of YESTERDAY's transactions above "$0.00 spent". `clampToWindow` fixes both.
- Owner `year` went 318 rows -> 100 when the live phase landed (the owner path let servercrm's
  default limit of 100 apply). One `TXN_FETCH_LIMIT` now.

**Performance** — transactions paint in ~600ms instead of 3.4–24.5s. The cost is the live EFS SOAP
leg, not the DWH: one carrier merged ZERO rows and still took 9.3s, and limit=100 vs 5000 differed by
~200ms. `live=false` reads the mart directly; `live=true` delegates to servercrm so the EFS
merge/de-dup stays in one place. Balance is cached (endpoint is 1.9–3.3s; Home unmounts on every trip
to Services/Inbox).

**Client reports** — CSV / real XLSX (exceljs) / branded PDF (pdfkit), delivered as a Telegram
document because a WebApp cannot reliably save a file. `apps/mini-app/src/lib/txnExport.ts` is gone;
`src/modules/carrier/txnReport.ts` owns it.

### Follow-up 1 — the invoice service (do this in a fresh session)

Give invoices the treatment transactions just got. The endpoint ALREADY accepts range/status/from/to.

- **The range is hardcoded**: `fetchInvoices(initData, { range: 'last_30' })` in App.tsx — the period
  chips are not wired to it at all, so a client cannot change the window.
- **`summary` is thrown away**, exactly as `totals` was: the backend sends
  `{total_invoices: 25, paid_count: 22, open_count: 2, cancelled_count: 0, sum_total_amount: 38453.43,
  sum_total_paid: …}`. Rows also carry `open_balance`, `days_overdue`, `total_paid`, `due_date`,
  `status` — plenty for the stat tiles (reuse the balance sheet's tile pattern, as the txns sheet does).
- **No Telegram export.** Mirror `modules/carrier/txnReport.ts`: same BRAND block, same ColumnSpec
  shape (`weight` for the PDF's proportional layout, `xlsxWidth` for Excel's character grid — they are
  different units), same `pdfSafe` (pdfkit's Helvetica is WinAnsi; `→` renders as `!'`), same
  `bufferPages: true` (or only the LAST page gets a footer), and a page-break check before the totals.
- **No progressive phase needed**: invoices are 462–1804ms with no EFS leg.
- Small bug: the sheet reads `invoice_ref ?? invoice_number ?? id`, but the response has NEITHER of the
  first two — it always falls back to `id`.
- Money: use `minimumFractionDigits: 2`, and do NOT put a currency symbol in an Excel numFmt — a
  locale-bound `$` renders as the VIEWER's currency ("US$327,37").

### Follow-up 2 — the card ribbon (separate session)

`CardWave` was removed (`git show 070d15f^:apps/mini-app/src/App.tsx` has it). It never matched the
physical card because of one ratio: 34 lines across a ~30-unit band = ~0.9 spacing, against a 1.15
stroke — every line overlapped its neighbour, so the band rendered as a solid blob instead of the real
card's separated line-art. Fewer lines with the stroke well under the spacing, and a band roughly twice
as thick (~30% of the card, not ~15%). It must stay in the upper-middle so the card's text keeps a dark
band to sit on.

### Still open

- **Push / PR** — branch is ready, rebased on `origin/build`.
- **Period filter redesign** ("B"): the chips still scroll horizontally; the code's own comment admits
  "too many presets to fit a fixed row on mobile". Proposal was a trigger pill + an in-sheet list.
- **The eye now masks the balance too**, and `revealed` starts false — so the balance opens masked. One
  boolean cannot both mask the PAN and show the balance on open; separate toggles if that matters.
- **`carrierMiniApp.routes.ts` is ~1030 lines** against CLAUDE.md's 600 cap (960 before this branch).
  Wants splitting into admin / registration / self-service modules.
- **servercrm local checkout is 98 commits behind `origin/build`** — money-code routes exist there, not
  locally.

---

## 2026-07-17 — Carrier User Management UI/UX audit + CRM-wide design pass

Started as "carrier management has no toasts", became a full audit of the surface and then three
CRM-wide consolidations. Everything below is verified in the running app (dev server on :5181
against the local backend), not just typechecked.

### Carrier User Management — the fixes that mattered

- **Toasts.** New `admin/toast.tsx` + host at the Admin root. The old inline `notice`/`error`
  banners had no clearing call anywhere — "Invite cancelled." sat on the page forever. Ported
  rather than reused from `scope/toast.tsx`: that stack is `position: absolute` inside the scope's
  own positioned root and styled with scope-local vars, so neither placement nor colour survives
  outside it. Split by lifetime: action outcomes → toast, load failures → inline banner + Retry.
- **`copyToClipboard` was lying.** `void navigator.clipboard?.writeText(text)` inside a `try/catch`
  cannot catch anything — `writeText` rejects *asynchronously*, so a blocked clipboard produced an
  unhandled rejection while the UI claimed "copied to your clipboard". Now returns whether the text
  landed, with an `execCommand` fallback; a failed copy hands the URL back in the toast, since that
  row is the only place the link exists.
- **Pagination dead-end.** Cancelling the only invite on page 2 dropped the list to one page →
  `Pager` returned null → `slice(10,20)` = `[]` → empty table, no pager left to escape. Both tables
  clamp to the last page that exists.
- **Errors rendered as data.** `listCards(...).catch(() => setCards([]))` made a network failure
  read as "this carrier has no cards" — and that drove both the company-type badge and the driver's
  card picker. Failures now stay `null` with their own error + Retry, so cardCount is undetermined
  rather than wrong. Same for the operator lookup.
- **Debounce + abort.** The cards effect fired one request *per keystroke* of a manually-typed
  carrier id. All three lookups now debounce at 300ms and abort on cleanup. Trap worth remembering:
  transport wraps an aborted fetch as `ApiError('NETWORK')`, so without an `aborted` guard every
  abort renders as "Couldn't read the card list" — the exact lying-error class above.
- **Symmetric confirms.** Cancel-invite had no confirmation at all while revoke double-confirmed —
  backwards, since revoke is a soft status flip (`registeredMiniAppCompanyRepo.revoke`) and cancel
  has no path back. New `ConfirmDialog` (built on AuditLog's modal pattern) focuses the *dismiss*
  button, not confirm.
- **Reissue.** A spent invite left a row with no action. No resend/extend endpoint exists, so
  "New registration link" seeds a fresh draft from the dead invite. The form's reset effects now
  guard on the *previous* value, otherwise a prefilled mount wipes its own draft.
- **Caught live, not by tests:** redeemed invites kept counting down ("in 7 days") next to their
  Redeemed pill, reading as still-live. Settled invites show `—`.

### CRM-wide

- **Icons → lucide.** `components/icons.tsx` keeps its 25 named exports and per-icon default sizes
  but each now renders lucide. The hand-drawn SVGs were tracing lucide's own paths (`HomeIcon` =
  `Home`, `DocIcon` = `FileText`, `ScopeIcon` = `Hash`) — the app was maintaining a near-duplicate
  of a library 33 files already import directly. `Sparkle` (FuelMark/Gem) and `MytrionGlyph` stay
  hand-drawn: brand, not UI furniture. Kept `aria-hidden`, which lucide doesn't set by default.
- **Radius → flat 6px.** `--radius-xs/sm/md/lg` all 6px; `--radius-full` deliberately untouched so
  pills/avatars/dots stay round. Swept 349 hardcoded px radii across 38 files to `var(--radius-md)`,
  leaving 56 pill values, 78 `50%` circles, and 6 asymmetric chat-bubble radii (speech-bubble tails).
  **`customer-service/styles/shared-theme.css` was shadowing the whole scale** with its own 8/10px —
  that module would have silently ignored the change, and is presumably how it drifted in the first
  place.
- **Skeleton primitive.** `components/ui/skeleton.tsx` (sheen only) + `components/mytrion/
  table-skeleton.tsx` (composed). Gradient is `from-muted via-accent to-muted`, which already map to
  `--surface-alt`/`--surface-raised` — no arbitrary colours. Animation registered as
  `--animate-shimmer` in the theme block, the first `--animate-*` in the codebase.
- **Nav nesting.** `NavItem.children` is opt-in, so the other nine Mytrions are untouched. A parent
  with children is a *section*, not a destination — it gets a quiet state and the selected child
  keeps the accent, because both wearing `navActive` left two identical "selected" rows.

### Gotchas worth keeping

- **`grid-template-columns` in a JSX `style` prop cannot be overridden by a media query.** That's
  why the carrier tables squashed instead of adapting; column ratios now live in CSS classes.
- **`position: sticky` anchors to the nearest scrollport.** `.table`'s `overflow: hidden` and the
  `overflow-x` wrapper both qualified, and both are exactly as tall as their content — a sticky
  header would silently do nothing. `.tableScroll` owns both axes with a height bound; `.table` is
  `overflow: visible`.
- **`.tRow:nth-child(even)` broke when rows moved inside a `role="rowgroup"`** — striping marked
  "2nd row of its group", so sibling drivers shaded differently. Zebra is scoped to direct children
  now; the tree separates *companies* instead.
- **`userEvent` deadlocks against fake timers** (its async wrapper awaits a real macrotask). Tests
  for debounced effects use `fireEvent`.
- CSS-module class lookups are `string | undefined` under `noUncheckedIndexedAccess` — annotating a
  prop as `string` rejects them.

### Still open

- **Two icons collide:** Knowledge Base and CMP Database both map to `Database` — their hand-drawn
  paths were both cylinders, so this is pre-existing. `Library`/`BookOpen` for Knowledge Base is a
  design call.
- **`.cs-root` still has its own shimmer** — consolidating means touching customer-service's styling.
- **The carrier tree now scrolls inside its own box** (Linear/Stripe pattern the brief cites). Drop
  `max-height` on `.tableScroll` to revert to page scroll.
- **`admin.module.css` is ~1000 lines** against CLAUDE.md's 600 cap.

## 2026-07-17 — mini-app: driver services, real tickets, and three capped-list bugs

Branch `feature/mini-app-transactions`, 43 commits, **not pushed** (push permission denied — run
`git push -u origin feature/mini-app-transactions` yourself). 660 tests green, typecheck clean, lint
0 errors (7 pre-existing warnings).

### Shipped

- **Driver catalog 3 → 7 real services.** `last-used` was already wired end to end (route, client,
  renderer, scoping) and unreachable purely for want of a catalog line. `reveal-code` renders the PAN
  the session already carries — no fetch.
- **Every fake "Request sent" is gone.** 8 catalog items called `sendGenericRequest()`, which wrote a
  local inbox row and made no network call. They now file real Zoho Desk tickets via
  `modules/carrier/serviceRequest.ts`. Departments mirror servercrm's own `departmentMap`
  (`routes/mobileAppRoutes.js`) so they land in the queue the mobile app already feeds.
  **Fake items remaining across both catalogs: 0.** Driver 7 of 9 real, owner 14 of 31; the other 19
  are `soon` and need upstreams that don't exist.
- **Driver name** is asked for at card-number sign-in (was silently taken from the Telegram profile,
  which is a nickname as often as a name — it lands in the owner's roster). Owners can correct it
  from the fleet screen.

### Security

- **`/tracking` leaked the whole fleet to any driver.** Every other driver-reachable read scopes to
  their card; tracking *cannot* — the upstream returns `{trackingNumber, startDate, cardsOrdered}`
  with no card identity. Now owner-only. Regression test confirmed failing (200, not 403) against the
  unfixed route. Nothing in 621 tests had caught it.
- Service requests: the card is resolved server-side from the caller's registration, never the body.
  `service` is an enum over a server-side map. Driver rename/owner rename key on `(tenant, carrier,
  card)` — the where-clause IS the authorization.

### Three bugs, one root cause: asking a capped list a question it can't answer

`listDwhCards` defaulted to 100 rows (hard cap 200). Measured on the live DWH across 7967 carriers:
p99 = 46 active cards, 16 carriers over 100, **max 510**. Three call sites scanned that list:

1. `assertDriverCardAvailable` — a driver past the cap got "That card is not an active card of this
   carrier" and **could not register at all**.
2. `resolveDriverCardNumber` — returned null → `requireDriverCardNumber` 503 → **every read that
   driver had was permanently dead**.
3. Fleet screen — owner of the 510-card carrier saw 100, and because the filter counts and search run
   client-side over that array, it **reported 100 as the total**.

Fixed with `findDwhCardById` / `countDwhCards` (exact queries) and `FLEET_CARD_LIMIT = 1000`.
Pagination was rejected deliberately: p99 is 46, the max payload is 53 KB, and paging would break the
counts and search it was meant to serve. Verified live: card 17385 of 230 went 400 → 201; fleet
returned 510/510 (68 KB, 450 ms).

**This also produced the first end-to-end proof that driver scoping filters.** Every carrier with a
registered driver had one card, or all its transactions on the driver's card — scoping was
indistinguishable from a passthrough. On carrier 5794015 (7599 line items across 95 cards, 230 active
cards) the driver's reads return 315 rows on 1 card.

### Test-suite trap (cost two debugging cycles)

`vi.clearAllMocks()` does **not** drain the `mockResolvedValueOnce` queue. A test whose path never
reached a queued value leaked it into the next test — silently swapping a 201 for a 409 and blaming
production code that was correct. `beforeEach` now uses `resetAllMocks()` and re-applies the factory
defaults. Do not revert it.

### Open — decisions needed, not mechanical work

- **Inbox is entirely fabricated.** `seedInbox()` invents "Payment due", "New invoice", "Payment
  received" for owners with no payment actually due. No backend route exists. A real `inbox_events`
  table, `inboxEventRepo` and a WebSocket topic (`inbox:<ownerKind>:<ownerId>`) DO exist — but
  `ownerKind: 'client'` keys on a `carrier_users` row id (`cu_…`) while a mini-app user is a
  `registered_mini_app_companies` row keyed by `telegram_user_id`. **They do not join.** Resolving
  that mapping is the first decision, before any Inbox work.
- **Re-login after a Telegram account change is a dead end** — "This card already has a registered
  driver", no path out but support. Deliberately not fixed: a card number is printed on the plastic
  and handed to fuel attendants, so "card = access" opens a takeover vector. Product decision.
- **Desk ticket creation has never been run end to end** — it would file into the live Customer
  Service queue. Needs authorization.
- `carrierMiniApp.routes.ts` is ~1220 lines against the 600 cap. Splitting it is overdue.
- 19 `soon` services; invoice status filter (endpoint takes `status`, UI never sends it); the
  `CardWave` redesign.

### Local DB

Demo rows (`DEMO-FLEET-1` / `DEMO-OWNEROP-1`, 5 registrations + 7 invitations) deleted — they made
every service 400 (`carrierId must be a positive integer`) for whoever opened them. 9 real
registrations, 46 invitations remain. Test with `?dev=1&uid=772010` (F 4 TRUCKING LLC, carrier
5747140) or `uid=567461899` (carrier 5836348).

### DECISION 2026-07-17 — Inbox owner mapping: extend `ownerKind`, don't mint carrier_users

**Chosen: add `ownerKind: 'mini_app'` to `InboxOwnerKind`; `ownerId` = `registered_mini_app_companies.id`.**

The mini-app's Inbox is fabricated (`seedInbox()` invents "Payment due" for owners with nothing due).
Backing it with the real `inbox_events` table needs an owner key, and the mini-app user is a
`registered_mini_app_companies` row (`telegram_user_id`), not the `carrier_users` row (`cu_…`) that
`ownerKind: 'client'` expects. Three options were weighed; this records why B won, so it isn't
re-litigated.

**Why B**
- `owner_kind` is plain `text NOT NULL` in the migration — no DB enum, no CHECK. `InboxOwnerKind` is
  a TypeScript `$type<>` union, so a third kind is a **type change with no migration**.
- `inbox_events_tenant_owner_idx` is `(tenant_id, owner_kind, owner_id, created_at)` — covers a new
  kind for free.
- `inboxEventRepo` is already generic over `ownerKind` (`list` filters on it, `create` takes it), and
  `hub.ts` topics are `inbox:<kind>:<id>` — the pattern generalises with no plumbing.
- The schema comment states the intent outright: *"One column pair covers both audiences."*
  `ownerKind` IS the extension point.
- Bonus: `registeredMiniAppCompanyRepo.upsert` conflicts on `(tenantId, telegramUserId)`, so the row
  id is **stable across revoke → re-register**. Inbox history survives a re-registration.

**Why not A (create a `carrier_users` row per registration)** — this is a security argument, not an
aesthetic one. `carrier_users.login` and `.passwordHash` are both `NOT NULL`, and a mini-app user
authenticates by Telegram initData HMAC — they have neither and never will. A would mean fabricating
credentials to obtain a notification key, producing a login account that someone who is not the
driver could authenticate as. New attack surface for no gain.

The `carrier_users` header comment says it is "consumed by /v1/auth/client/login (future Telegram
mini-app + the /client web page)" — that intent **predates the mini-app that actually got built**,
which uses Telegram identity, not login/password. That consumer never materialised. Honouring stale
intent by minting passwords is worse than extending the discriminator that exists for this.

**Why not C (separate mini-app feed table)** — duplicates the table, the repo, the unread logic and
the WS plumbing for no benefit.

**Caveat to handle when implementing:** `owner_kind` is unconstrained at the DB level, so a typo
writes silently — `'miniapp'` and `'mini_app'` would become two feeds nobody notices. Make the
`InboxOwnerKind` union the single source of truth and validate in `inboxEventRepo.create` (the
pattern `SERVICE_REQUEST_KEYS` uses for the Desk request enum).

**Still undecided, and the real work:** what actually publishes a client event. Nothing writes
`ownerKind: 'client'` rows today, so the mapping only makes the feed addressable — the events
themselves (invoice issued, payment received, card shipped, ticket replied) each need a real upstream
trigger. Until one exists, an honest empty Inbox beats the current invented one.

### Carrier client picker empty — is_active broken upstream (2026-07-17)

Driver/owner registration picker ("WHICH CLIENT") returned "No clients match" for everyone,
including registered carriers like ONZMOVE INC (carrier 5762018). Root cause is NOT app code:
`octane.intm_zoho_deals` is a view hard-filtered `where is_active = true`, but the upstream
dbt/Airflow SCD2 load is broken — all ~253k rows of `octane.stg_zoho_deals` carry
`is_active = false` AND a non-null `valid_to`, so the view yields zero rows for every carrier.
(Fuel cards are fine: `octane.stg_cmp_card` healthy, 20 cards for 5762018.)

Fix (`src/integrations/dwhClients.ts`): stop reading intm_zoho_deals; derive the current version
ourselves from `stg_zoho_deals` via `DISTINCT ON (zoho_deal_id) ... ORDER BY valid_from DESC`
(collapses 253k → ~21.7k deals), drop the `is_active` filter, exclude `Closed Lost`. DTO unchanged
→ no frontend change. Verified live: ONZMOVE found via text + numeric search, browse mode returns
rows. Tests updated (tests/unit/dwh-clients.test.ts). typecheck + lint + the suite green.

REVERT to intm_zoho_deals once the data team repairs the SCD2 current-flag load. Known quirk:
ONZMOVE surfaces as 2 rows (two distinct zoho_deal_id, same carrier) — left un-deduped; both
resolve to the same carrier so provisioning is unaffected. Separate prod-config issues found the
same session (not code): FF_ZOHO_OAUTH_ENABLED unset, ZOHO_OAUTH_REDIRECT_URI defaulting to
localhost:5173, and the stale /widget base URL (SPA now serves at root /).

## 2026-07-17 (pm) — Sales Mytrion Desk fixes: attachments, live owner/status/order/toast

Branch `feature/func`. Six reported bugs in the Sales ticket console (`TicketsTab.tsx` +
`/v1/desk/*`), all traced against the actual reference widget (`~/Desktop/Octane-Project/
zoho-octane/app/ticketdashboard.html`, the Vue prototype this tab was "ported verbatim" from) and
its servercrm WS backend (`~/Desktop/Octane-Project/servercrm`) — read for protocol/pattern
reference only, per the "never import from Mytrion" rule; nothing there was edited.

### Root causes (not guessed — read off the reference and the live webhook code)

- **Attachments as a comment, not the Attachments tab (#1) / Desk-side attachment invisible in
  Mytrion (#2):** the reply/create/escalation routes uploaded via `POST /uploads` then attached the
  id to a **comment** (`attachmentIds`) — Desk's comment-attachment path, not the ticket's
  Attachments tab. And `/desk/tickets/:id/comments` never called `GET /tickets/{id}/attachments` at
  all, so anything landed there (by an agent, or previously by us) never reached Mytrion. Fixed both
  ends: `uploadTicketAttachment` now hits `POST /tickets/{id}/attachments` directly (dropped
  `uploadDeskFile`, now dead), and the comments route fetches+merges the ticket-level attachments
  list, flagged `mine` like comments already are. Confirmed via the reference's own
  `fetchTicketAttachments`/`formatAttachments` — it never reads `comment.attachments` either; the
  ticket-level list is the sole attachment source there too.
- **Owner not shown (#6):** `searchTicketsByCreator`/`ticketsPage` can return a bare `assigneeId`
  with no embedded `assignee{firstName,lastName}` (Desk's `include`/`fields` behavior isn't
  consistent enough to trust here — the reference gets it embedded for free on `/tickets/search`
  with zero extra params, which is not reproducible with confidence). Added
  `modules/tools/deskOwners.ts::enrichTicketOwners`, joining `assigneeId` against the **same cached
  Desk agent roster CS analytics already uses** (`fetchDeskAgentRoster`, 10 min TTL) — zero new Desk
  calls in the common case.
- **New message doesn't reorder the list (#5):** tickets were paged from Desk sorted by
  `createdTime`, which never changes. The reference sorts client-side by a `lastActivityTime` it
  bumps on every WS event. Ported the sort (not the bump): `loadTickets()` now orders by
  `modifiedTime || createdTime` descending — Desk bumps `modifiedTime` on a new comment/thread, so
  the WS-triggered reload (already wired) naturally reorders. `modifiedTime`/`description` added to
  `TICKET_FIELDS` (the fallback `/tickets` path needs it named to come back at all).
- **No toast on new message (#4):** the WS handler reloaded silently. `InboxTab.tsx` already does
  `pushToast` + reload on its own WS event — `TicketsTab.tsx` was just missing the equivalent. Added
  it, gated the same way the reference gates its own notification: only when the event's ticket
  isn't the one currently open (and only reload the open thread when it IS — was unconditionally
  reloading `msgsLoad` before, a harmless but pointless extra fetch on every unrelated ticket's
  event).
- **Status not live, only on refresh (#3):** confirmed (webhook.js in servercrm) only
  `Ticket_Comment_Add`/`Ticket_Attachment_Add` are wired — **no push signal exists for a pure status
  change**, in the reference either. Fixing that for real means a new Desk webhook subscription +
  servercrm handler, a different repo/deploy entirely. In-scope fix: a 25s poll of the ticket list
  while the tab is mounted, alongside the existing WS-triggered reload. Flagging the bigger fix as a
  follow-up, not doing it silently.

### Also

- Removed the "📎 filename" caption-comment hack — the real attachment bubble (now correctly
  sourced) makes it redundant. Kept stripping it for **historical** comments that already have one,
  so old tickets don't show a doubled-up bubble.
- New tests: `zoho-desk.test.ts` covers the two new wrapper methods directly (right path, right
  query params); `desk-routes.test.ts` covers the route-level contract (file-only reply never calls
  `postTicketComment`; comments route merges + flags attachments). 29/29 green.

### Test status (repo-wide, not just this change)

Root: lint 0 errors (7 pre-existing warnings, none in touched files), typecheck clean, `pnpm test`
649/665 green. **The 16 failures are all in `cs-routes.test.ts`, pre-existing and unrelated** —
`vitest.config.ts` has an uncommitted `FF_ZOHO_OAUTH_ENABLED: '1'` default flip (working-tree change
found mid-session, not made here) that the CS-analytics RBAC tests haven't caught up with yet. Ran
this change's own files in isolation to confirm: clean before and after. `apps/mytrion-crm`:
typecheck clean, 17/17 test files green (116 tests).

### Follow-up same day — Inbox toast never fired outside the Inbox tab

Reported after the above shipped: "connected to the WS, no toast on a new inbox message." The
gate logic itself (`ownerId === currentUserId`) was correct and already reference-matched — per this
file's 2026-07-11 entry it was verified by **mocking the WebSocket and injecting a notification**,
never against a real live event. Re-reading the actual wiring found the real bug: the toast only
existed inside `InboxTab.tsx`'s OWN `useServerCrmSocket` call, which unmounts (tears down its socket)
whenever you navigate to any other tab. The sidebar badge count, by contrast, is driven by
`sidebarBadges.useSidebarBadges` — a **shell-level** socket that's always mounted — which is why the
badge can look "live" while the toast never appears unless you happen to be sitting on the Inbox tab
when the event lands.

Fix: moved the toast into `useSidebarBadges` (now takes an optional `pushToast`), called from
`Shell.tsx` (had to reorder `useSidebarBadges()` to after `pushToast`'s own `useCallback` — it didn't
exist yet at the call site). Removed the now-duplicate toast from `InboxTab.tsx` (kept its reload —
it still needs to refresh its own separately-fetched list while mounted). Also hardened the id
comparison to trim whitespace, and added a `console.debug` on a non-matching ownerId so a live event
that still doesn't toast is diagnosable from devtools instead of silently vanishing — the deeper open
question (whether Zoho's real `Owner_Id` payload shape/value even matches `zohoUserId` in production)
was never live-verified either, and isn't checkable from any repo I have access to.

Verified: `apps/mytrion-crm` typecheck clean, 17/17 test files green (116 tests), root lint clean on
the touched `.ts` file.

## 2026-07-17 — Create tab: ticket/escalation attachments + lead Deluge

- **Create ticket + escalation:** Desk attach first; on Desk 403/failure, fall back to CRM
  `attachFileToRecord` on Deals / Escalation_Request so the file still lands. Routes return
  `warnings`. Ticket create stamps `cf_submitted_by` from form `submitterName` (session/act-as)
  with server fallback to `ctx.userName`.
- **Create lead:** still `leads.create` → Deluge `mytrioncreatelead`. UI now parses
  `DUPLICATE_DATA` nested under `response.details.id` (widget parity) via
  `resolveCreateLeadOutcome`.
- Tests: desk-routes create/escalation + file (+ CRM fallback); CRM unit tests for lead outcome.

### Follow-up — Carriers tab filters + create-lead links (widget parity)

- Carriers Lookup now matches self-service `CarrierSearchPanel`: status chips, **Has phone / email**,
  min units, fetch 200/500, client pagination 50/100, per-row **Create Lead** via `leads.create`
  (`mytrioncreatelead`) with full carrier payload (dot/email/address/units/dates/status).
- DUPLICATE_DATA → **Already exists ↗** deep link; success → **Lead #xxxxxx ↗**
  (`crm.zoho.com/crm/octanefuel/tab/Leads/{id}`).
- Create tab Create Lead shows the same post-create / duplicate **Go to Lead** banner.

### Follow-up — Sales + Debtors dashboards (self-service parity)

- Dashboard sub-tabs: **Sales** | **Debtors** | Cards (replaced stub Invoices/Transactions).
- Sales: full `dashboard.agent_sales` payload (no top-8 truncation); hero gallons from TX volume;
  Card Swipes = `new_cards_cycle` (widget); Inactive/Stuck → bar filter; All/Active/New/Unique bars;
  company + TX search; activity Cycle/History + day click (shift-range); discount column + totals;
  refresh. Day drilldown uses `dailyTransactionsByCarrier` when present.
- Debtors: `dashboard.debtors` with 2+ day rule, Hard only, summary strip, expandable invoices,
  footer Active/Largest — matches Client Invoices block.

### Follow-up — Dashboard UX: cache, skeletons, Company tab, Debtors soon

- **5-min localStorage cache** for Sales (`mytrion_msd_*`) and Company (`mytrion_cdb_*`), keyed by
  act-as / session Zoho user id — tab switches and revisit are instant; Refresh bypasses cache.
- Skeleton loaders for Sales/Company/Cards; Debtors tab is **Coming soon** (no live fetch).
- New **Company** tab: Applications + Gallon Volume gauges (`dashboard.company`) with widget targets.
- Sub-tabs restyled with icons (Sales / Company / Debtors / Cards).

## 2026-07-17 (pm 2) — Data Center: Clients balance/debt/gallons + Rejection Reports disabled

Admin feedback on Data Center, six items — three fixed, two deferred pending a design the admin is
sending, one blocked on the first two (now unblocked):

### Fixed

- **Clients showed $0 balance/debt on every card.** Traced `clients.by_agent` (servercrm
  `GET /api/clients/by-agent/:zohoUserId` → `services/dwhClients.js` + `services/cmpClients.js`) end
  to end: `balance`/`efs_balance`/`prepay_balance` — the three fields `mapRecord()` read — **never
  appear in this endpoint's response at all** (exhaustive grep of the servercrm repo, zero hits;
  those names only exist on a separate, per-carrier live-EFS endpoint in `agentDwh.js`), so the
  figure was always 0 regardless of the client. `computed_debt` IS real and live (`dwhClients.js`'s
  `COALESCE(d.debt, 0)`, reconciled against a live CMP overlay) and matches the reference widget's
  own debtor detection (`records-panel.js`) field-for-field. Fix: `bal = debt > 0 ? -debt : 0` —
  shows the real debt as a negative (red) balance; a clean account now reads $0 for the honest
  reason (no debt), not because of a dead field reference.
- **"Gallons (cycle)" was wrong on every card.** `total_volume`/`gallons_90d` — the fields
  `mapRecord()` read — don't exist anywhere in servercrm either; no cycle-gallons aggregation is
  joined into `clients.by_agent` at all. Rather than inventing a new backend query (a separate
  repo/deploy), sourced it from data already flowing through this app: `dashboard.agent_sales`'s
  `transactions` array is documented by the reference `dashboard-panel.js` itself as "full-cycle
  per-carrier totals" by default, keyed by `carrier_id` per row (`byId[String(r.carrier_id)] = r`,
  same file). Added `loadCycleGallonsByCarrier()` (parallel fetch alongside `clients.by_agent`,
  builds a `carrier_id → volume` map) and pointed `mapRecord()`'s gallons at it. Best-effort — a
  failed fetch just means $0 gallons, not a broken tab.
  - **Disclosed residual risk** (an adversarial review agent flagged this independently, same
    conclusion I'd already reached): this joins a Postgres-DWH carrier_id (`clients.by_agent`)
    against a Zoho Deluge-function carrier_id (`dashboard.agent_sales`) — a pairing with no prior
    precedent anywhere in this codebase, and no test or smoke check confirms the two actually share
    the same id format/values live. `scripts/salesPanelSmoke.ts` already calls both touchpoints but
    never cross-checks their carrier_ids. Neither repo I have access to contains the Deluge
    function's source, so this could not be verified further than "well-evidenced, not yet
    live-tested." **Please open the Clients tab and confirm gallons actually populate for a client
    you know has cycle activity** before treating this as fully closed — if it's still 0 across the
    board, the join is the first thing to re-check.
- **Rejection Reports disabled**, per instruction ("current version is not usable, will send
  redesigned version"). Added `disabled?: boolean` to `DcTabDef`, set on the `rejections` entry only;
  mirrors the exact "Coming Soon" pattern already used for Open Pool in `Shell.tsx`'s NAV (real
  `disabled` attribute, `opacity:.5`, `cursor:default`, a warn-colored "SOON" pill, a title tooltip).
  Confirmed via a research agent that no other page deep-links into this sub-tab, so gating the one
  button fully closes it off. Underlying code (`RejectionsView`, `loadRejections`, the backing route)
  is untouched — it's still real Zoho Desk data (confirmed: `dataCenter.routes.ts`'s rejections route
  calls `zohoDesk.listRejectionReportTickets()`, the SAME function the Desk ticket-dashboard's own
  rejection listing uses — not CRM Deals, contradicting an older, now-corrected assumption).

### Deferred (no code change — waiting on the admin)

- **Leads**: full rework requested, design incoming. Left as-is.
- **Deals**: list/kanban confirmed fine; detail-view field spec incoming.
- **Money Codes**: blocked on Clients fetching per the admin's own note — unblocked now that balance/
  debt/gallons are fixed; ready for the admin to test.

### Process note

Used a background research workflow (2 parallel agents: trace the balance/debt/gallons data path
across mytrion-ops + servercrm + the reference widget; confirm the Coming-Soon disable pattern +
resolve a stale "rejections = CRM Deals" note against current code) before writing any fix, then an
adversarial code-review agent against the diff afterward — it independently surfaced the same
DWH↔Deluge carrier_id join risk noted above and ruled out several other hypotheses (comma-formatted
volume strings, RBAC-based silent zeroing, multi-row-per-carrier double counting) with concrete
evidence rather than assumption.

**Known pre-existing issue, not touched**: `apps/mytrion-crm/.../live.ts` is now 611 lines against the
600-line cap (partly this change, partly unrelated concurrent work in the same file this session).
Flagging, not splitting it here — a structural refactor isn't part of this bug-fix task and this file
is currently being edited by another process in parallel.

Verified: `apps/mytrion-crm` typecheck clean, 21/21 test files green (128 tests, up from 116 — other
concurrent work added its own tests, none of which regressed).

### 2026-07-18 — Sales Mytrion icon pass

Fixed misrendered / misaligned outline icons across Sales redesign:
- Hardened shared `Svg` (block + flex-shrink) and added `SvgPaths` for multi-stroke glyphs
- Replaced broken KPI / nav / automations path strings with Heroicons 24 outline `d`s
- Routed Create + Dashboard tab icons and Company dash section icons through `Svg`
- Cleaned Shell chrome icons (sun/moon/sparkles/bolt) and department picker icons

Verified: `apps/mytrion-crm` tsc clean.

### 2026-07-18 — Sales dashboard reference parity

Aligned Sales Mytrion Dashboard → Sales with zoho-octane self-service MSD:
- Hero KPIs: fuel-can + card icons, gold/blue strip styling
- Donuts: crimson active arcs + amber inactive track; Inactive/Stuck alert chips with icons
- New Cards card: stacked teal stats with plus/calendar icons
- Cards by Company: status dots, days-since-tx, All/Active/New/Unique bars + chips
- Card Activity: Tx/Active/New multi-line chart, Cycle/History, day value rows
- Tabs: Debtors disabled (Soon), Cards removed, Power BI iframe added (same embed URL)

Verified: apps/mytrion-crm tsc clean.

### 2026-07-18 — TX Volume column + dash e2e hardening

- Replaced broken Volume (Gallons) grid cell (wrapped SVG + pill chips) with a real `msd-tx-table` matching self-service: sticky header, gold full-cell wash, no icon
- Day-filter chip on Transaction Details; empty-state copy matches widget
- Expanded `dashSalesData` tests (map payload, All-mode bars, day-drill TX aggregate) — 8/8 green

Verified: CRM tsc + dashSalesData vitest.

### 2026-07-18 — Tickets UI / UX polish

Reworked Sales Mytrion Tickets two-pane console for clearer hierarchy and less chrome noise:
- Extracted `tickets.css` (`ss-tk-*`); `TicketsTab` markup uses classes instead of mega inline styles
- Quieter New Ticket (tool button next to refresh, not a full-width gradient CTA)
- Cards: subject + meta + status chip; SLA only when overdue / nearly due (not on every card)
- Canned replies behind a toggle; composer keeps FAB clearance
- Details drawer uses shared `ss-scrim`; dropped redundant Is Escalated / Is Overdue rows

Verified: TicketsTab under 600 lines; CRM tsc — TicketsTab clean (pre-existing `IconName` error in salesData.ts unrelated).

### 2026-07-18 — Tickets pagination, status picklist, full comments

Aligned Sales Tickets with zoho-octane `ticketdashboard.html`:
- Infinite-scroll creator-scoped paging (`loadTicketsPage` / `useTicketsFeed`, page size 50); sidebar `loadTickets` pages up to ~2k
- Desk search now `include`s contacts/assignee/team/departments; windowed fallback `maxPages` 6→20
- Status segmented control → picklist; status chip colors match reference (incl. Closed / review states)
- Comments/threads: limit 99, expand last 40 thread bodies, bubble `pre-wrap` so realtime replies show fully

Verified: TicketsTab + feed hook typecheck clean.

### 2026-07-18 — Hotfix: Desk tickets 502

Cause: `searchTicketsByCreator` briefly passed `include` + `sortBy` — Desk `/tickets/search` rejects those (422) and `deskError` maps to HTTP 502.
Fix: reverted search query to `customField1` + `from` + `limit` only; widened search→windowed fallback to also catch 422/UNPROCESSABLE.

Note: `/v1/ringcentral/embed-config` 404 is unrelated (route missing / RC not wired here).

### 2026-07-18 — Realtime inbox toast + ticket comments

Hardened Sales realtime to match ticketdashboard / self-service:
- Shell `useSidebarBadges` owns one WS subscribe (`userId` + ticketIds): inbox toast+reload, ticket comment/attachment toast+unread (skip when that ticket is open)
- `ticketLiveBus` bridges shell → Tickets tab (reload open thread + soft list refresh)
- Tickets tab no longer opens a second toasting socket; uses act-as-aware open-ticket focus
- Inbox/Home reload keyed on currentUserId + ownerId match

Verified: CRM tsc clean for touched files.

### 2026-07-18 — Tickets unread, scroll page, promote-to-top

- Unread badge clears immediately on select (card + sidebar); open-ticket WS frames stay read
- Scroll/sentinel loads next Desk page (page size 20); removed “N tickets loaded” footer
- New comment/attachment promotes that ticket to the top of the list

### 2026-07-18 — Sales Mytrion icons → lucide-react (ready-made)

Replaced every hand-authored SVG path-string icon in the Sales redesign with ready-made
`lucide-react` glyphs (the dep was installed but unused). New single source of truth:
`redesign/icons.tsx` — a typed `ICON_REGISTRY` (semantic name → lucide component) + an `<Icon
name=… size strokeWidth color style className />` wrapper mirroring the old `Svg` API (same
`.ss-icon` class, 24×24 grid, block/flex-shrink) so layout/weight is unchanged.

- Data maps now carry `IconName` keys, not path `d`s: `salesData.ICO` + `NAV`, `autoLive.ICO`,
  `autoCatalogOrder`, `live.ANN_META`, `RecordsTab` DC tabs/views, `HomeTab` ICON_OF + VMs,
  `ctx.DetailVM`, `createTicketForms` dept glyphs, `DashTab` TAB_ICONS, `CreateTab`, `InboxTab`.
- All `<Svg d=…>`, `<SvgPaths>`, and inline `<svg>` icon markup → `<Icon name=…>` across Shell
  (nav/detail/chrome/toast/send), AutoTab/AutoCatalog, Tickets/Pool, createTicket*, dashboard
  panels, dataCenterModals, ViewAsPicker, Carriers. `Svg`/`SvgPaths` removed from `dc.tsx`.
- Data-viz SVGs left untouched (SalesDashPanel donuts, CompanyDashPanel sparkline) — only icon
  glyphs were swapped.

Verified: `sales/redesign` typechecks clean (0 errors; remaining tsc errors are pre-existing
TS6133 unused-var warnings in other teammates' in-flight files — MytrionPicker, components/icons,
SchemaBrowser, UserAccessForm — not touched here), 17/17 redesign vitest tests green, and
`vite build` succeeds (lucide icon chunks emitted).

### 2026-07-18 — Tickets chat sides + scroll paging fix

- Chat: you/mine on the left, agent on the right; removed Canned toggle + “Click to download”
- Pagination aligned with ticketdashboard.html: `from=0`, page 20, `from += limit`
- List cards `flex-shrink:0` + explicit overflow so scroll actually pages
- Restart API required for Desk `from=0` zod/search change

### 2026-07-18 — Ticket attachment Download hover + toast

- Attachment cards show a Download button on hover (always visible on touch)
- Toast “Downloading” + filename when download starts; failure toast unchanged
- Added `download` lucide icon to redesign registry

### 2026-07-18 — Load more sticky + promote old tickets

- “Load more tickets” pinned in a sticky list footer (not buried under scroll)
- Live comment on an old / not-yet-paged ticket: pull from shell ticket directory, pin to top,
  scroll list to top; softReload keeps pinned rows above page-0 so they don’t drop again

### 2026-07-18 — Faster ticket send / render

- Optimistic chat bubbles (clear composer + show “Just now”) before Desk POST returns
- Background thread reconcile only — dropped per-send ticket-list softReload
- useLoad soft-reload no longer flips loading when data already present
- Desk reply: parallelize comment + attachment upload when both present
- Restart API for the parallel reply path

### 2026-07-18 — WS promote old tickets via realtime fetch

- On `ticket_comment_added` / attachment for a ticket not in loaded pages: pin from shell
  directory instantly, then `GET /desk/tickets/:id` and put the fresh card on top
- New Desk route + `getDeskTicket` / `loadTicketById`; softReload keeps pinned rows above page 0
- Restart API required for the new GET-by-id route

### 2026-07-18 — Load more always visible

- Footer button was gated on `hasMore`; short-list auto-paging flipped that off → button vanished
- Load more is always pinned under the list (solid accent button + “N loaded” meta)
- Removed silent short-list auto-fetch; manual click can retry past a false “done”

### 2026-07-18 — Load more = next 20 (reference paging)

- Match ticketdashboard.html: from=0, limit=20, from += 20 after each non-empty page
- Windowed Desk dump is sliced client-side in pages of 20 so Load more still appends +20
- Removed IntersectionObserver auto-chain; scroll-near-bottom + button only
- Ensure client query keeps `from=0` (numeric zero) on /desk/tickets

### 2026-07-18 — Why only ~16 tickets (“All loaded”)

Root cause (live probe): `ZOHO_DESK_REFRESH_TOKEN` lacks `Desk.search.READ` →
`/tickets/search` 403 SCOPE_MISMATCH → old fallback dumped one shallow creator scan and set
`hasMore:false` (UI: “All tickets loaded” at 16). Widget works because CRM CONNECTION has search.

Fix: `pageTicketsByCreator` progressive scan (up to ~10k org tickets) returns real hasMore + next
20; `scoped:false` warning; client trusts server paging. Re-mint Desk token with Desk.search.READ
for true ticketdashboard search parity.

### 2026-07-18 — Hide Sales AI chat (not ready)

- Removed floating Mytrion AI launcher + panel from Sales redesign Shell
- Removed Home “Ask Mytrion AI” CTA; Automations “Run an action” stays

### 2026-07-18 — Tickets Coming soon; Data Center Leads redesign

- Nav: Tickets marked `comingSoon` (same SOON chip as Open Pool); openTicket / TicketsTab gated
- Leads COQL now selects Cell, MC, DOT, Referral_Source, Referred_By, Registration_Time,
  Web_Registration_Date (probed live against `/coql`)
- LeadVM + list/kanban/modal aligned to Desktop “Sales Mytrion Leads redesign”:
  - Kanban: contact + Lead_Source badge, company, email, phone, created
  - List: Name | Company | Status | Source | Email | Phone | Cell | Created (+ hover copy/call)
  - Modal: contact hero, fleet/source/MC/DOT/referral, Phone+Cell dial, dates, Description notes
- Status order includes Unaccounted / No Status from real Lead Status picklist


### 2026-07-18 — Leads utm_source + Clients balance/gallons/activity

- Leads Source (kanban badge, list, modal) = Zoho `utm_source` with redesign sourceColor palette
- Status `-None-` normalized to No Status
- Clients: removed Balance from card + modal overview tiles
- Cycle gallons via dashboard.agent_sales volume, formatted with up to 2 decimals (galFmt)
- Client Activity: all_time feed + Load more (growing limit); helpers in clientDrilldown.ts


### 2026-07-18 — Sales nav search, Call Hub/Cases SOON, client Manage links

- Sidebar: "Search tabs…" filters NAV (+ Cases children); Call Hub + Cases (Billing/Retention) SOON at end
- Data Center client modal: Manage tab — owner/driver Telegram registration links (Admin CarrierUserForm flow)
- Backend: `POST /carrier-invitations` + `GET /carrier-users/dwh-cards` auth-gated for workers (not admin-only)


### 2026-07-18 — Cases removed; sidebar nav groups

- Removed Cases + Billing/Retention sub-tabs
- NAV_GROUPS: Workspace / Pipeline / Tools with section labels (+ dividers when collapsed)


### 2026-07-18 — Retention nav (Cases + Open Pool in-page)

- Removed standalone Open Pool from sidebar
- Added Retention (SOON); RetentionTab scaffolds Cases + Open Pool (PoolTab) sub-tabs


### 2026-07-18 — Client Manage: driver under owner + card

- Driver invite requires active owner registration (inviteService + UI gate)
- Sales: GET /carrier-registrations/for-carrier; Driver picks available card number


### 2026-07-20 — Mini-app: wire C-code automations (Faza 1 backend)

Telegram-guruh tahlili (Analitika/) asosida agent widgetining avtomatlashtirilgan bloklarini
mini-app'ga ulash — backend qismi:

- **modules/carrier/miniAppAuth.ts (yangi)** — carrierMiniApp.routes.ts'dagi auth/scoping
  helperlar (verifyTelegramUser, requireRegistered*, requireDriverCardNumber, resolveDriver*)
  ko'chirildi, endi ikkala route fayl bitta gate to'plamini ishlatadi.
- **routes/v1/carrierMiniAppActions.routes.ts (yangi)** — C-16 override, C-1/C-3 set-status,
  C-4/5 limits (delta MINIAPP_LIMIT_CHANGE_MAX bilan cheklangan), C-26 card/info, C-10
  fraud-request, C-17 money-code preview/draw, + /card/efs diagnostika o'qishi. Hammasi:
  DWH orqali karta egaligi tekshiruvi (owner cardId → findDwhCardById; driver → o'z kartasi,
  fail-closed), carrier-boshiga 5/min rate-limit, audit, FF_MINIAPP_* flaglar (default OFF).
- **wrappers**: efsWrapper += setCardStatus/setCardLimits/fraudHoldRelease;
  serverCrmWrapper += getMoneyCodePreview/drawMoneyCode (widget bilan bir xil body).
- **C-15**: txnReport priceMode ('discount'|'retail') — retail: Amount=funded+discount,
  Discount ustuni bo'sh; export route driverni har doim retail'ga majburlaydi
  ("driverga discount kursatish shart emas" — BILLAD chat talabi). Caption ham mos.
- **serviceRequest**: 'account-reactivate' (C-7) ticket spec (owner).
- **apps/mini-app/lib/api.ts** — barcha yangi endpointlar uchun typed client funksiyalar.

Qolgan (keyingi sessiya): App.tsx sheet UI'lari + i18n kalitlari + serviceCatalog'ni real
actionlarga o'tkazish; RBAC cross-tenant testlar (rule 9) yozish.

## 2026-07-20 (davomi) — RBAC testlar + driver self-register owner'dan decouple

**T2 — RBAC/security testlar (carrierMiniAppActions.routes.ts):** tests/unit/carrier-mini-app.test.ts
+16 test. Gate tartibi: feature-flag(503) → auth/role(403) → rate-limit(429) → card-egaligi(404).
Har biri rejection kodi + wrapper chaqirilmagani. Baseline fix: carrier-mini-app mock'ida
findActiveOwnerByCarrier stub yo'q edi (build branchdan) — 11 test qulagan, tuzatildi.

**Driver self-register owner-gate'dan decouple (mahsuliy talab):** 60 kartali kompaniyada
60 link generatsiya og'ir → har driver o'z card# bilan self-register qiladi, owner ro'yxatdan
o'tmagan bo'lsa ham.
- `CreateCarrierInviteArgs.allowWithoutOwner?` qo'shildi (inviteService.ts). Faqat card-possession
  self-register uzatadi; admin/owner-issued invite'lar hali DRIVER_NEEDS_OWNER talab qiladi.
- `findDwhCardByNumber` (dwhCards.ts): `limit 1`→`limit 2` + ambiguity guard — bir card# ikki
  carrier'ga chiqsa fail-closed (null + warn log), noto'g'ri carrier'ga bog'lamaydi. `is_active=true`
  allaqachon faqat AKTIV kartalar login qilishini ta'minlaydi.
- Testlar: self-register owner'siz 201 + findActiveOwnerByCarrier chaqirilmaydi; yangi
  tests/unit/dwh-cards.test.ts (is_active + ambiguity, 6 test).

**Audit natijasi (mini-app user mgmt):**
- Admin "Registered companies" (CarrierUsers.tsx) driverlarni owner ostiga ALLAQACHON nest qiladi
  + driver Revoke tugmasi bor. Screenshot'da driver ko'rinmasligi = ma'lumot yo'q (driver yo'q).
- Ochiq risk (keyingi): one-driver-per-card DB unique constraint yo'q (faqat pre-insert query,
  concurrent race mumkin) — migration kerak bo'lsa alohida.

Holat: typecheck toza, 695 test yashil.

### 2026-07-20 — Self-register hardening (audit follow-up)

- `findDwhCardByNumber`: bitta carrier ichida duplikat aktiv raqam → warn-log (carrier bog'lash
  bir ma'noli, shuning uchun fail-close EMAS; card_id tanlovi arbitrar ekani ops uchun surfaced).
- `/carrier/mini-app/driver-self-register`: verified Telegram user boshiga 3 urinish/daqiqa
  (takeToken, `SELF_REGISTER_RATE_LIMITED` 429) — karta-raqam enumeration oracle yopildi.
- Testlar: same-carrier duplikat birinchi qatorga bog'lanadi; 4-urinish 429 va DWH'ga yetmaydi.

### 2026-07-20 — Txn report detailed + stations/dispute/override UI (SelfService filtri)

- txnReport: `detailed` rejim — to'liq PAN + Driver/Unit/Driver ID ustunlari (12 ustun, uch
  renderer dinamik ustunlarga o'tkazildi, totals endi header bo'yicha). Route/api `detailed` param.
- Stations sheet (statik, 814 so'rov): yangi ServiceKey, katalogda unpark (owner+driver), 4 tilda.
- Dispute-txn: real Billing ticket (owner+driver), katalogda unpark.
- Export panel: "Chegirmasiz" (owner-only ko'rinadi) + "Batafsil" toggle'lari.
- Driver override: generic sheet ustida bir-bosishlik real C-16 tugmasi; flag o'chiq bo'lsa
  ticket-fallback saqlangan (503 → xabar).

### 2026-07-20 — Owner write-action UI (T3 yakuni)

- `moneycode` sheet (C-17): preview (available/drawn) → summa+unit+sabab (sabablar backenddan)
  → draw → muvaffaqiyat ekrani (kod QIYMATI hech qachon ko'rsatilmaydi — widget qoidasi).
  Flag o'chiq (503) → xuddi shu sheet ichida money-code TICKET fallback formasi.
- `cardops` sheet (C-1/C-3/C-4-5/C-26): fleet'dan karta tanlash → per-card EFS holat →
  Activate/Deactivate · kunlik limit (ULSD/DEF, +/− delta) · Unit/Driver/ID saqlash.
  MINIAPP_WRITES_DISABLED → katalog so'roviga yo'naltiruvchi toast.
- Katalog: fin-money-code → 'moneycode'; card-activate/card-limit → 'cardops'.
- Stations sheet OLIB TASHLANDI (owner qarori: mobil appda bor) — katalogda yana 'soon'.
- i18n: mc.*/co.* to'plami 4 tilda; 2 noto'g'ri kalit tuzatildi.

### 2026-07-20 — Override sheet tozalash + driver PIN/Unit info sheet

- Driver override sheet: ticket-forma va uning intro matni YASHIRILDI — faqat direkt tugma;
  MINIAPP_WRITES_DISABLED bo'lsa forma fallback sifatida ochiladi (ovrFallback). ovr.hint qo'shildi.
- drv-change-pin unpark → 'pinunit' READ sheet (analitika: 62 PIN so'rovi, deyarli hammasi
  "PIN nima/ishlamayapti"): o'z kartasining EFS'dan unit/driver_id/driver_name + PIN yo'riqnomasi
  (Driver ID yoki last-4; bo'lmasa Override/so'rov) + "unitni owner o'zgartiradi" izohi. 4 tilda.

### 2026-07-20 — Override UX yakuniy: bitta tugma + Home timer + bot xabari

- Override sheet: ticket forma/tugma/intro BUTUNLAY yashirildi (driver) — bitta tugma. Ticket
  fallback olib tashlandi (owner qarori: agent widgetda ham override direct, ticket ochilmaydi);
  flag o'chiq → faqat xabar.
- Home (driver): muvaffaqiyatli override'dan keyin yashil countdown-karta (~30 daq, sekundlab),
  localStorage orqali app qayta ochilganda ham saqlanadi; tugagach o'zi yo'qoladi.
- Backend override: muvaffaqiyatdan keyin best-effort bot xabari (karta last-4 bilan) — pump
  oldida WebView yopilsa ham chat xabari qoladi. Hech qachon override'ni bloklamaydi.

### 2026-07-20 — Product rule: fuel karta LAST 6 raqam bilan ko'rsatiladi (last-4 emas)

- App.tsx: last4() -> tail6() (barcha •••• ko'rinishlar), maskedCardNumber ham 6 xonaga.
- txnReport: tail6 (Card ustuni), meta.cardLast4 endi 6 xona saqlaydi (nom tarixiy, izohda).
- Export caption + override bot xabari: slice(-6).
Sabab: last-4 fleet ichida unikal emas (bitta carrier'da 11 karta bir xil last-4 — DWH o'lchovi).

### 2026-07-20 — PIN/Unit endi EDITABLE + sheet cache + copy + driver funds check

- pinunit sheet endi TAHRIRLANADI: driver o'z unit/driverId'sini o'zgartiradi (C-26 orqali,
  updateCardInfo cardId'siz — o'z kartasiga pinned). Dirty-check Save, saqlangach
  cardops/pinunit/status cache invalidatsiyasi. Hintlar 4 tilda yangilandi ("unitni owner
  o'zgartiradi" → o'zi o'zgartira olishi; UZ ikki string birinchi urinishda anchor xato ketgan,
  keyin tuzatildi).
- SHEET_CACHE (60s TTL): barcha service sheetlar cache-first ochiladi (cacheId = service +
  ko'rinishni o'zgartiruvchi paramlar); txns fast-phase cache'dan chiqsa ham live-merge davom
  etadi. invalidateSheetCache(prefix...) yozuvlardan keyin chaqiriladi.
- manualcode: copy tugmasi (clipboard + toast). svc.manualcode va boshqa yetishmagan kalitlar
  4 tilga qo'shildi (missing-key scanner bilan tekshirilgan).
- YANGI: driver "available balance" tekshiruvi — /carrier/mini-app/card/funds (owner ham
  chaqira oladi). Har karta carrier'ning umumiy EFS pool'iga bog'langani uchun javob FAQAT
  boolean: hasFunds (efs_balance>0), accountActive, driver uchun o'z kartasi statusi. Summa
  ATAYIN qaytarilmaydi — kompaniya puli owner'ning ishi (owner'da to'liq /balance bor).
  EFS outage → hasFunds null = "hozir tekshirib bo'lmadi" (hech qachon "pul yo'q" emas).
  UI: drv-funds katalog itemi (driver ro'yxatida birinchi, default-pinned), uch holatli sheet
  (✓ yashil / ✗ qizil / … neytral) + karta-status va account-inactive ogohlantirishlari. 4 tilda.

### 2026-07-20 — Txn report: owner uchun karta filtri (company ↔ driver level)

Telegram tahlili (txn_report_tahlili.md): 41 ta "bitta unit/driver/karta kesimida report"
so'rovi. Yechim: owner txns sheet'ida chip-qator — "All cards" (company level) yoki bitta karta
(driver level); tanlov ro'yxatga HAM exportga HAM ta'sir qiladi.

- Backend: txnRangeSchema/txnExportSchema += optional cardId (opaque). resolveOwnerCardFilter():
  faqat owner, findDwhCardById bilan O'Z carrier'i ichida resolve (fail-closed 404 CARD_NOT_FOUND).
  Driver'da body.cardId e'tiborga olinmaydi — scope'i requireDriverCardNumber'ligicha (hech qachon
  kengaymaydi). Fast (SQL) va live (scopeTransactionsToCard) fazalar bir xil filtrda.
- Frontend: txnFleet lazy fetch (owner, sheet ochilganda bir marta), chip-qator •••• last6 + ism;
  1 kartali fleet'da yashirin. cacheId va live-upgrade cache kalitiga cardId qo'shildi; doExport
  ham o'tkazadi. i18n: txns.allCards ×4.
- Test (Mac'da): owner cardId → faqat shu karta qatorlari; begona/noto'g'ri cardId → 404;
  driver + cardId body → o'z kartasi (ignor).
## 2026-07-18 — UI/UX Redesign
- Seeded the skills for modern web guidance. Any future agent must consult the `modern-web-guidance` skill before modifying UI/UX.
- Emphasized glassmorphism, dynamic thematics, and removal of double loading indicators.

### UI Polish & Theming (2026-07-18)

- Standardized themes across all Mytrion apps using a global ThemeProvider and React Context.
- Updated MytrionLoader to match Sales' 'Rocket' loader style but without generic text.
- Fixed dark mode visibility for Admin logo.
- Upgraded sign-in and sign-out UI components.
- Replaced favicon.ico with a beautiful unique 'M' vector logo in SVG format.
- Resolved TypeScript compilation errors caused by legacy unused loader code.

### 2026-07-18 — Black screen / 404 after theme rename

- Root cause: `useTheme.ts` was renamed to `.tsx`; Vite's module graph kept importing
  `/src/hooks/useTheme.ts`, which fell through to `index.html` → failed module load → blank app.
- Fix: split provider into `themeContext.tsx` and keep a stable `useTheme.ts` re-export entry.
- Also: drop dead `/favicon.ico` link from `index.html` (file removed; SVG-only now).
- `--rocket` hue token must be a solid color (not a gradient) for `color-mix` / `color:` usage.

### 2026-07-18 — Coming soon: Collection / Verification / Manager / Analytics

- Parked those four on `COMING_SOON_MYTRION_IDS` → picker Coming soon tiles (with HR).
- `resolveAccessibleMytrions` / `canAccess` exclude them so they are not enterable.

### 2026-07-18 — Coming soon badge color

- Replaced muted gray SOON chip with a per-tile gradient pill (tile hue → accent).

### 2026-07-18 — Sales Home hover / empty values / loader

- Removed `translateY` from `.ss-card-h:hover` (cards no longer jump up).
- Money Owed / volume trend empty → `$0` / `0%` (no `$-0` or em-dash).
- Homepage: one below-fold skeleton until first loads settle; no stacked “Loading…”.

### 2026-07-18 — Sales workday / soon tabs / titles / no double boot

- Workday bar phases: morning→midday→afternoon→closing→overtime (distinct gradients + status).
- Removed Sales shell `MytrionLoader` boot; Home skeleton is the only first paint loader.
- Coming soon nav: colorful SOON chips; click opens `ComingSoonPanel` in main.
- Top-bar `NAVLABEL`s renamed so they don’t echo in-page H1s (e.g. New Entry vs Create a Lead).

### 2026-07-18 — Automations: txn report → CS + unique icon colors

- Transactions Report (`C-15`) category `dept: 'C'` (Customer Service).
- Each automation has a `color` CSS var (`--accent`, `--cyan`, `--ok`, …) via `autoIconColor`
  so catalog + runner icons stay unique and track `.ss-root` / `.ss-root.light`.
- Code badges (`C-15`, `Q-1`, …) use the same per-action color (`deptStyle(code, autoIconColor(a))`).

### 2026-07-18 — Automations: standardized deal picklist + loaders

- New `AutoPicklist.tsx`: shared `AutoDealPicklist` / `AutoCardPicklist`, `DealPickOption`
  (company title + contact · App · phone), `PicklistMicroLoader`, `AutoMacroLoader`.
- `AutoTab` uses those for every deal/card-needing action + the run-phase “waiting” UI.
- `.ss-pick-row` hover: accent wash + left rail (light/dark, reduced-motion safe).

### 2026-07-18 — Automations: standardized result states (success / error / empty)

- Ported zoho-octane `showActionResult` + `.automation-empty` language into
  `AutoActionResult.tsx` (`AutoStatusResult`, `AutoEmptyState`).
- Modal done-step: error → “Couldn't complete that”; empty invoices/txns/messages → empty
  tone; writes → success. Shared Done / secondary actions.
- Picklist / WEX / catalog / invoice+txn panels use `AutoEmptyState` for empties.

### 2026-07-18 — Automations: deal chip X + tracking + WEX tasks

- Select Deal clear (X): `align-items:flex-start` / top-right (`.ss-deal-chip`), matching
  zoho-octane `.automation-selected-deal` — was vertically centered on 2-line chips.
- Tracking (C-22): rich `DonePayload.kind: 'tracking'`; numbers link to parcelsapp status
  (hoverable). Deluge `mytriontruckingnumberrequest` unchanged.
- WEX tasks (C-2/C-19): Deluge `application.update` only (stop merging empty WEX SF status
  table). Rich task cards + summary; empty → “No WEX tasks found” in the modal.

### 2026-07-18 — Automations: picklist loaders + App/Carrier + card status badges

- Root cause of white-block loaders: `AutoFloatingDrop` portaled to `document.body`,
  outside `.ss-root` → CSS vars / shimmer broke. Portal now mounts under `.ss-root`.
- Micro-loader: spinner label + `.ss-pick-skel` accent shimmer (light/dark).
- Deal rows: `App ####` + `CR-####` badges; meta line is contact · phone.
- Card status: ACTIVE green, INACTIVE orange (`--warn`), FRAUD red.

### 2026-07-18 — WEX tasks empty-under-summary fix + single (non-double) picklist loader

- `AutoWexTasksPanel`: only show the "No WEX tasks found" empty state when BOTH
  `wexTaskField` (summary) and `wexTasks[]` are empty. Deluge frequently fills only the
  summary text (e.g. "Approved prepay") with an empty task array — that summary IS the
  result and was being contradicted by an empty state rendered right under it.
- `PicklistMicroLoader`: dropped the spinner-row header — shimmer skeleton rows alone are
  the loader now (spinner + skeleton together read as two competing loaders).

### 2026-07-18 — Full automations-catalog audit vs zoho-octane self-service (22 blocks)

Reviewed every `AUTO_LIST` block's dispatch in `autoRunners.ts` against the reference
widget's per-block transport table (function/endpoint, validation, merge behavior).
Confirmed correct for 21/22 blocks — endpoints, required-field validation (carrier/app/card
presence, money-code eligibility, unit-driver "at least one field", address completeness),
Deluge function-name casing fallback (`executeZohoFunctionWithFallback`), and unwrap modes
(`status`/`cardAction`/`successFlag`/`permissive`) all match the widget's contract. Card
pickers for `fraud-hold-release` / `override-card` already filter to fraud-status cards
only (`cardPool` in AutoTab), matching "card picker, fraud-eligible only".

**Bug found + fixed — Check Payment Information (C-18/Q-2):** the reference fetches DWH
`payment-info` and live CMP `check_payment` **in parallel** and merges both into one view.
Our `payments` case was calling them **sequentially with fallback-on-error only** — if the
primary succeeded, the CMP invoices call was never made, silently dropping half the
reference's result. Fixed:
- New `DonePayload` kind `'payments'` (`autoLive.ts`): `{ summary, cmpInvoices, cmpError }`.
- `autoRunners.ts`: `Promise.allSettled` both touchpoints; only throws if BOTH sources
  fail (previously any primary failure with no CMP fallback swallowed the real error).
- New `AutoPaymentsPanel` (`AutoRichResults.tsx`): summary stat grid + CMP invoice cards
  with status badges, independent empty/error state per source.

**Retracted (was wrong):** earlier notes claimed BOCA/close/replacement/reactivation route to
Desk tickets because Ops had no browser-automation/Zapier path. That was incorrect — those
actions must hit the same real backends as the Zoho widget (see 2026-07-18 entry below).

## 2026-07-18 — Real BOCA / Zapier automations + WEX search parity + Ops logging

Corrected Sales Automations so write actions match zoho-octane self-service, not Desk substitutes.

**Browser automation (BOCA C-27 / Close Application C-14):**
- New integration `src/integrations/browserAutomation.ts` + env
  `BROWSER_AUTOMATION_URL` / `BROWSER_AUTOMATION_KEY` / `BROWSER_AUTOMATION_TIMEOUT_MS` (5m default).
- Touchpoints `browser.boca` → `POST /wex/boca/{appId}`,
  `browser.close_application` → `POST /wex/application/{appId}/close`.
- CRM UI: Assigned To locked to WEX SF owner (`wex.application`), priority, due date, fixed comment.
- `autoRunners` calls those touchpoints; success/skipped messaging matches the widget.

**Zapier (Card Replacement C-6 / Account Reactivation C-7):**
- New integration `src/integrations/zapier.ts` + env `ZAPIER_TICKET_WEBHOOK_URL`
  (same catch-hook the widget posts to).
- Touchpoint `zapier.ticket_email` proxies `{ companyName, carrierId, agentEmail, ticketType, … }`.

**Automation logs:**
- `logAutomation` now mirrors `_logOpsAutomation`: hyphen→underscore type, `triggerDate` /
  `triggerTime`, agent name; still fire-and-forget on every successful `runAuto`.
- WEX field search also logs `wex_apps_application` after a successful search.

**WEX search (C-29):** `AutoWexPanel` exposes all 8 fields (appId, firstName, lastName, company,
email, phone, mc, dot) — same contract as `wex.applications_search`.

**Deploy note:** set `BROWSER_AUTOMATION_*` and `ZAPIER_TICKET_WEBHOOK_URL` on the Ops service
or these four actions will 502 as unconfigured.

## 2026-07-18 — Carriers tab: Fetch 200/500, filters, lead create/duplicate

Fixed Carrier Lookup so it matches zoho-octane `CarrierSearchPanel` end-to-end.

**Fetch 200/500 (was broken):** changing the Fetch select only updated React state and never
re-queried. Widget does `@change="search"`. Now `onFetchLimitChange` re-runs the search and
passes the new limit explicitly (avoids the setState race that would still POST `limit: 200`).

**Search meta:** `searchCarriers` returns `{ rows, total, moreRecords }` from
`sales.carriers_search`; UI shows the widget “X of Y matches — refine…” hint when truncated.

**Filters / pagination:** status chips, has-contact, min-units, Clear, client page 50/100 —
page state clamped when filters shrink the set.

**Create Lead + already-exists:** hardened `resolveCreateLeadOutcome` — string success flags,
walks nested / JSON-string / `data[]` DUPLICATE_DATA for the existing lead id, and no longer
treats a bare failure `leadId` as a duplicate. Shared by Carriers row actions + Create tab form.

## 2026-07-18 — Sales Inbox refresh + live toast/badge verification

**Inbox tab:** refresh button (spinning icon, same pattern as Home/Tickets) calls `inbox.list`
and keeps the existing list visible while reconciling. Initial load uses shimmer rows (no plain
"Loading…" text). `inboxLiveBus` publishes manual refresh so shell `useSidebarBadges` reloads too
— nav unread count stays aligned after a pull-to-refresh style click.

**Live toast (verified):** `Shell` → `useSidebarBadges(currentUserId, pushToast)` owns the
servercrm socket app-wide. On `crm_inbox_notification` for the current user it reloads inbox data
and fires a toast (subject as title, matching zoho-octane InboxPanel). Toast shows on every tab,
not only when Inbox is open.

**Nav badge (verified):** sidebar Inbox pill = `countUnread(inbox messages, localStorage read set)`.
WS push + manual refresh both reload the badge source; marking read in the tab drops the count
immediately. Task-type rows (`type: task`) increment unread like any other message — the WS frame
does not carry message type, so the toast uses the notification subject until the list fetch lands.

## 2026-07-18 — RingCentral softphone: sign-in unblocked + call-event capture

Got the Sales Mytrion Embeddable softphone actually working end-to-end.

**Sign-in was blocked (root cause):** `ringcentral.isConfigured()` required `RINGCENTRAL_JWT`, but
the `.env` is set up for per-agent OAuth (redirect URI = Embeddable's hosted `redirect.html`, no
JWT). So `/v1/ringcentral/embed-config` 404'd and the widget never loaded. Fix: `isConfigured()`
now needs only `FF_RINGCENTRAL_ENABLED` + `CLIENT_ID`; the shared secret+JWT are gated behind a new
`canEmbedBrowserCreds()` (`BROWSER_CREDS_ACK && secret && jwt`) — auto-login stays opt-in/audited.

**Adapter URL:** now passes `redirectUri` (new `RINGCENTRAL_REDIRECT_URI` env, defaults to the
Embeddable callback) so authorization-code sign-in is explicit (avoids OAU-113).

**Call-event capture:** rewrote the frontend event handling into `ringcentralEvents.ts` — normalizes
`rc-active-call-notify` / `rc-call-end-notify` / `rc-ringout-call-notify` / `rc-login-status-notify`
into one event (dedup per session+phase, talk-duration from connect→end), tags outbound calls with
the Data Center lead/deal via `setDialContext()`, and POSTs each to new `POST /v1/ringcentral/call-events`
(zod-validated, sales-guarded, audit-logged as `ringcentral.call_event`). `RingCentralPhone.tsx` now
shows direction-aware toasts (dialing / incoming / connected / ended+duration) + sign-in status.

**Deals dialing:** `DealModal` had no `onCall` — wired it (phone call-row + footer Call button), Shell
passes `onCall` for both Lead and Deal modals, and Leads list dials now tag `leadId`.

**Contacts/messages:** native Embeddable tabs — appear once the RC app token carries Read Contacts /
Read Messages / SMS scopes (documented in `.env.example`). No app code needed.

**Still needs (RingCentral Developer Console, can't do from code):** app = client-side web app,
3-legged OAuth; redirect URI must match `RINGCENTRAL_REDIRECT_URI`; scopes VoIP Calling + WebSocket
Subscriptions (+ Read Contacts/Messages/SMS/Call Log for those tabs).

**Verify:** `pnpm typecheck` + `pnpm lint` (RC/DC files) clean; `data-center-routes.test.ts` 11/11
green incl. 4 new (JWT-less embed-config, call-events RBAC/audit/validation). NOTE: this branch has
pre-existing unrelated failures (cs-routes, carrier-mini-app, touchpoints count 84≠81) and web
`tsc` unused-import errors in admin/icons — none touched by this work.

## 2026-07-18 — Design audit pass 1: P0 accessibility (contrast + keyboard)

Implemented the "P0 now" slice of the Sales Mytrion design audit (claude.ai/design project "Sales
Mytrion design audit"). Scoped to the highest-priority, lowest-risk findings; the P1 color/type
unification and the gamification "prize" are deferred as follow-ups.

- **Contrast (WCAG AA):** the accent cyan→violet gradient carried `color:#fff` (~2:1 on the cyan
  end — fails AA). Added `--on-accent` to `.ss-root` (dark `#04131c`, light `#ffffff`) and swapped
  all 16 gradient buttons across 9 redesign files to `color:var(--on-accent)` — dark label in dark
  theme, white kept in light (already AA there).
- **Keyboard a11y:** Home's announcement / quick-action / inbox cards were `<div onClick>` (no
  focus/role/Enter). Added a `clickable()` helper in `dc.tsx` (role=button, tabIndex, Enter/Space)
  and one global `.ss-root :focus-visible` ring in `theme.css`; existing input/picklist focus
  styles still win via equal specificity + source order.
- **Type tweak:** snapshot KPI numerals 600→500 weight at 23px (audit: "reads a touch heavy").

Verify: web `tsc` clean for every file this touched. Remaining tsc noise (icons.tsx, admin/*, and
the concurrent inbox-live-reload WIP in sidebarBadges/InboxTab) is unrelated. Not committed — left
in the working tree for review.

Follow-ups (not done): P1 — unify the forked `.ss-root` palette + duplicate accent (`#4cc2f5` vs
app `#38bef0`), collapse the ~15 ad-hoc font sizes onto the app `--text-*` scale, de-rainbow Today's
Snapshot (neutral numerals, status hues only). Then the habit loop: goal bar → streak → celebration.

## 2026-07-18 — Design audit pass 2: P1 unification + the habit-loop "prize"

Finished the rest of the audit (orchestrated: a 5-agent understand workflow to map data/tokens, then
implement, then a 3-dimension adversarial review workflow — 16 agents, 7 confirmed findings all fixed).

- **Habit loop (the "prize"):** new `streakStore.ts` — client-side, user-scoped localStorage (mirrors
  `ticketUnread.ts`; no backend day-history exists so it accumulates per NY-calendar day). Home now has
  a **goal bar** ("X / N apps · M to go") wired to the real, previously-unrendered `dailyAct.data?.apps`
  vs `DAILY_APPS_GOAL`; a **🔥 streak / ⭐ best-day / week-total** strip; and a **celebration** overlay +
  toast on a fresh goal hit / new personal best (guarded against re-fire via persisted day record +
  `lastCelebrated`). Honest limitation: the streak begins the day it ships (no backfill possible).
- **De-rainbowed snapshot** (cells live in `HomeTab.tsx`, not salesData): 8 vanity hues → neutral
  `--text`; 4 status cells keep a hue **paired with a glyph/sign** (warn triangle, clock, `-$`, ▲/▼);
  fixed the two same-metric color contradictions. Number weight already 600→500 (pass 1).
- **Wayfinding:** top bar now leads with the clicked nav label + descriptive title as a muted secondary
  ("Data Center · Pipeline Hub"), Shell.tsx:304. (Coming-soon nav grouping was already done.)
- **Typography:** added a documented `--ss-text-*` scale to `.ss-root`; normalized ~170 off-scale sizes
  (12.5→13, 11.5→12, 10.5→11) across tsx/css + a JSX numeric prop, leaving the badge micro-sizes.

**Review fixes (all 7 confirmed defects):** (1) `nyDaysAgo` DST bug — fixed-24h subtraction skipped/
duped a calendar day twice a year, corrupting the streak; rewrote to UTC calendar math. (2–4) three
light-theme WCAG-AA failures — added text-grade `--ok-text`/`--accent-text` tokens (dark reuses base;
light darkens) for the goal-bar + celebration text, and `--text2` for the label on the tinted hero.
(5) celebration overlay was a second `role=status` live region duplicating the toast → made it
`aria-hidden` (toast is the sole SR announcement). (6) hardened `streakStore.load()` to coerce nested
day records (a corrupted value would `NaN`-poison the week total). (7) finished the size normalize.
Two review findings were adversarially rejected as false positives (a View-as unmount concern — Shell
keys panels on `actAsKey`; and a reduced-motion claim).

**Verify:** web `tsc` clean for every touched file (remaining errors are unrelated pre-existing/
concurrent WIP: icons.tsx, admin/*, sidebarBadges). Not committed — left in the working tree. Live
visual check still blocked by the pre-existing tsc errors on `build` (use `vite dev`, which skips tsc).

## 2026-07-20 — Retention workflow data model v2 (migrated to prod)

Replaced the flat `retention_cases` shape (0020/0023) with the evolving-workflow model:

- **Lookups (not enums):** `retention_phases`, `retention_statuses` (`is_terminal`, `phase_code`) —
  statuses grow via INSERT, no `ALTER TYPE`.
- **Native enums (fixed picklists only):** `communication_channel`, `dissatisfaction_reason`,
  `transaction_frequency`, `agent_outcome`.
- **Core + audit:** `retention_cases` (timers, assignment caps, DWH metrics, Zoho text ids) +
  `retention_case_events`. Partial unique open case per `(tenant_id, carrier_id)`.
- **Ops adaptations vs sketch:** no local `deals`/`agents` tables → `zoho_deal_id` /
  `assigned_agent_zoho_user_id` / actor text; `tenant_id` isolation; open = `closed_at IS NULL`.
- **Seed:** 3 phases, 22 statuses (7 terminal). Open pool lives as phase-1 statuses.
- **Migration:** `0027_retention_workflow_v2` applied to Render app Postgres (`MYTRION_OPS_DATABASE_URL`).
  Old episode rows dropped (regenerate via DWH sync job).
- **Code:** schema, repo, `/v1/retention` routes (+ `/phases`, `/statuses`), sync, unit tests updated
  to `phase_code` / `status_code` / `transactionFrequency`.

Verify: `pnpm typecheck` clean; `retention-cases` unit tests 21/21; prod tables/enums/indexes/seeds
confirmed (4 tables, 22 statuses, 4 enums, open-carrier unique + deadline index).
Not committed — left in the working tree for review.

## 2026-07-20 — Sales UI feedback: table z-index, refresh confirmation, Home metric color

Three fixes from user feedback (with screenshots):

- **Dashboard → Sales → Transaction Details z-index (msd.css):** the sticky `.msd-tx-table th`
  for the Volume column overrode the solid header bg with a *translucent* gold (`rgba(...,.08)`),
  so scrolled body rows bled through the sticky header. Made it opaque via
  `color-mix(#f59e0b 8%, var(--surface-2))` (dark) + a light-theme background, and bumped the
  sticky-header `z-index` 1→3 so the header always sits above the details.
- **Refresh confirmation:** the Dashboard `SalesDashPanel.fetch(true)` and Home's snapshot Refresh
  updated silently. Dashboard now `pushToast('Dashboard refreshed' | "Couldn't refresh", …)` on the
  forced fetch (tone auto-derives green/red from the title). Home snapshot: added a `snapRefreshPending`
  ref + a `snap.data`-watch effect (reload() is fire-and-forget and useLoad doesn't flip `loading` on
  reload) → toasts "Snapshot refreshed" once the fresh data lands.
- **Home metric coloring (partial revert of the de-rainbow):** user found the all-neutral snapshot
  too grey. Restored a *curated, consistent* palette — each metric owns ONE hue across groups
  (Active=accent, Fuel Tx=cyan, Gallons=violet, New Cards/Tasks=green), which keeps the audit's
  "same metric = same color" consistency win while bringing color back. Status cells keep red/amber
  and the glyph/sign pairings (warn/clock icon, -$, ▲/▼) added in pass 2.

Verify: web `tsc` clean for every touched file (SalesDashPanel, HomeTab, msd.css); remaining errors
are the same unrelated pre-existing/concurrent WIP. Not committed — left in the working tree.

## 2026-07-20 — Phase 1 Retention in Sales Mytrion (UI + touchpoints)

Wired the real Phase 1 (Sales Agent) retention workflow into Sales Mytrion against the v2
tables. Scheduled automation (2BD auto-escalate, vacation job, Ryan Saab email, CITI) deferred.

**Backend**
- New touchpoint kind `local` (DB-backed handlers) in types + dispatcher.
- `src/modules/retention/phase1.ts` — outcome→status map, 2BD helper, attempt/pool guards.
- `retentionCasePhase1Repo` — listForAgent, listOpenPool, getWithEvents, claimFromPool (cap 3),
  logCommsAttempt (5→Open Pool). Core create stamps `2BD_agent_action` deadline.
- Catalog: `retention.my_cases|case_get|record_outcome|log_attempt|pool_list|pool_claim|lookups`
  (`departments: ['sales']`, identityParam self-scopes non-admins).

**Frontend (Sales redesign)**
- Un-parked Retention nav. Cases = Kanban+List (`RetentionCasesPane`) + detail drawer with the
  5 outcomes / channel attempts / dissatisfied reasons. Open Pool = live `pool_list` + claim.
- Data via `retentionData.ts` → `callTouchpoint('retention.*')`.

**Tests:** phase1 pure (11) + touchpoint self-scope/claim-cap (3) + existing retention routes (21).
Verify: backend `pnpm typecheck` clean; retention unit tests 35/35. Not committed.

## 2026-07-20 — Home goal bar + streak: wired to REAL Zoho COQL (Application_Date)

Replaced the client-side/localStorage streak (fake accumulation) with real per-agent data from Zoho
CRM. Validated the COQL live via the Zoho CRM MCP first: `select Application_Date from Deals where
Owner = '<uid>' and Application_Date >= '<since>' order by Application_Date desc limit 0, 2000`
(Application_Date is a `date` field → 'YYYY-MM-DD'; note this org's COQL parser rejects a bare
`limit N` and a trailing `is not null` — use offset-form limit, and `>= since` already drops nulls).

- **Backend:** `salesDataCenter.fetchAgentApplicationStats(ownerId, windowDays=90)` runs that COQL,
  buckets rows into a `{ 'YYYY-MM-DD': count }` map (`AgentAppStats`: days/total/windowDays/truncated).
  New owner-scoped route `GET /v1/data-center/app-stats` (mirrors leads/deals: requireSalesAccess +
  resolveZohoUserId; admins may target `?zoho_user_id`).
- **Frontend:** `api/dataCenter.getAppStats()`; `streakStore.ts` rewritten to PURE data-driven funcs
  over the day-map — `todayApps / topDay / weekTotal / currentStreak(days,goal) / isNewBest` — plus a
  tiny per-user `claimCelebration` localStorage guard (the only persisted state; fires goal/PB toast
  once per NY day). HomeTab now `useLoad(getAppStats, [uid])`; goal bar (today), 🔥 streak, ⭐ best day,
  week total, and the celebration all derive from real COQL data. Snapshot Refresh reloads it too.
- **Goal:** `DAILY_APPS_GOAL` 5 → 3 (live data shows agents fill ~1–3 apps/day; 5 was never reachable).
  Tunable constant; a per-rep target is the future step.

**Verify:** backend `pnpm typecheck` clean; web `tsc` clean for all touched files; `data-center-routes`
14/14 (+3 new: non-sales 403, sales-rep own-scope never victim, admin ?zoho_user_id). Not committed.

## 2026-07-20 — Sales Mytrion: remove remaining mock/seed data

- Deleted `redesign/mock.ts` (orphaned `DEALPOOL` fixture; Open Pool is live).
- Slimmed `sales/data.ts` to `CALL_TO_ACTIONS` only (Home Quick Actions catalog). Removed
  unused seed arrays: announcements, snapshot, automations, inbox, clients, carriers,
  synthetic fuel activity.
- Comments in `live.ts` / `salesData.ts` updated — no seed fixtures in the redesign path.

## 2026-07-20 — Admin Jobs tab + 2h retention case-sync

Retention bulk insert already ran via pg-boss (`automation.retention.case-sync`). This session
makes it operable from Mytrion Admin and slows the cron to every 2 hours.

**Backend**
- Cron `*/5` → `0 */2 * * *` (JOBS_CRON_TZ). Payload may include optional `lookbackDays` /
  `limit` / `trigger` for Admin backfill; cron still sends `{}`.
- Worker returns the sync summary as pg-boss `output` (visible in Admin).
- `GET /v1/agent/jobs` — catalog + live schedules + counts + recent runs (admin).
- `POST /v1/agent/jobs/:name/run` — enqueue allowlisted cron queues (admin); retention accepts
  lookback/limit. Singleton overlap → 409.
- `listJobCatalog` / `recentJobRuns` / `triggerCatalogJob` helpers.

**Frontend (Admin Mytrion)**
- New **Jobs** tab: all queues, cron vs live schedule, counts, Run buttons, Recent runs with
  output modal. Prominent **Run retention sync** with lookback/limit fields.
- Client: `api/jobs.ts`.

**Tests:** `tests/unit/jobs-admin.test.ts` (4). Backend typecheck clean. Not committed.

## 2026-07-20 — Retention load speed (remote DB)

Local API → Render Postgres was ~1–4s/request (network RTT), and case open also awaited
DWH for phone (~1.5s more). Fixes: drop DWH from `case_get` (lazy `retention.case_contact`);
single-query list (no separate count); agent index `0028`; modal seeds from board row so
paint is instant while events load.

## 2026-07-20 — Retention UI: modal, loaders, RC call, no manual Returned, hourly sync

- Case detail is a **centered modal** (not sidebar); skeleton loaders on first board + detail
  load only (refresh keeps rows / spins refresh icon — no double loaders).
- **Returned** removed from agent actions + touchpoint outcomes; `resolvePhase1Transition`
  rejects manual returned (auto-close stays on hourly DWH sync).
- **Log attempt** = RingCentral phone call (click-to-dial when DWH `contact_phone` present) +
  log channel `ringcentral`; other channels remain secondary for the 5-attempt count.
- **Cadence** copy clarified: usual fueling rhythm (2/5/7d from 90d history).
- Case-sync cron `0 */2 * * *` → `0 * * * *` (every hour).

## 2026-07-20 — Jobs 503 fix: enable FF_JOBS + migrate prod

Admin Jobs tab returned 503 because `FF_JOBS_ENABLED` defaulted off (commented in `.env`).
- Set `FF_JOBS_ENABLED=1` + `JOBS_WORKER_MODE=inline` locally against Render app Postgres.
- Ran `pnpm db:migrate` against that DB (migrations applied successfully).
- Softened `GET /v1/agent/jobs` to return catalog + `enabled:false` / reason instead of hard 503
  when jobs are off; UI shows the reason banner and disables Run buttons.
- Restarted local API so pg-boss boots on the prod DB.

## 2026-07-20 — Loyalty Tiers in Data Center → Clients (real DWH)

Implemented the "Loyalty Tiers v3" program per the approved plan (/Users/user/.claude/plans/
abstract-forging-backus.md). Each client gets a Bronze/Silver/Gold tier from REAL DWH data, evaluated
on the CALENDAR month (user-confirmed).

- **Backend:** `src/integrations/dwhLoyalty.ts` `fetchLoyaltyStatsByAgent` — one owner-scoped DWH query
  (`octane.mart_transaction_line_items`, grouped by carrier, this + prev calendar month) returning
  `sum(line_item_fuel_quantity)` (gallons) + `count(distinct card_number)` (active cards = ≥1 tx that
  month — NOT the all-time `total_active_cards`) + `count(distinct transaction_id)`. Owner mapped to the
  client's CURRENT agent via `dim_company` (newest-per-carrier) with the **last-12-digit suffix match**
  on `agent_zoho_user_id` (session vs DWH org-prefix mismatch — mirrors `warehouse_gallons.ts`); owner
  id kept a string, bound as `$1`. Route `GET /v1/data-center/loyalty-stats` (owner-scoped like
  leads/deals; `dwhError` 502). Tests: `data-center-routes.test.ts` +3 (non-sales 403, rep own-scope
  never victim, admin target) → 17/17.
- **Frontend:** `loyalty.ts` — pure config (thresholds + rewards from the deck) + `resolveTier` (track by
  card count, T3 segments cap 12, tier by gallons, 1-month grace within 10%), `tierRewards`, colors.
  Theme-aware `--tier-{gold,silver,bronze}[-text]` tokens (AA-safe label text per theme). `getLoyaltyStats`
  in api/dataCenter.ts; merged into the roster in `live.ts` (best-effort, 5 raw numeric fields added to
  `RecordVM` + `ClientRecord`). `RecordsTab`: tier badge on each client card + a **loyalty distribution
  bar** atop the list (Gold/Silver/Bronze/Building counts across the book). `ClientModal`: tier badge in
  the header + a dedicated **Loyalty tab** (tier + segment, gallons-vs-next progress bar, 4 stat tiles,
  6 rewards with active/inactive states & values). Tier is derived only from the raw month numbers, never
  the formatted cycle `gallons` string.

Notes: rewards are display-only program rules; Money-Code % is shown but not wired to issuance (future).
DAILY month basis differs from the client card's existing "cycle gallons" (26→25) tile — labeled
distinctly ("This month" vs "Cycle"). **Run a live DWH probe before merge** to confirm the suffix match
returns rows (no direct DWH tool in this session).

Verify: backend `pnpm typecheck` clean; web `tsc` clean for every touched file; `data-center-routes`
17/17. Not committed — left in the working tree.

## 2026-07-20 — Loyalty tiers: fixes from live review

Three issues from the user testing the Clients tab:
- **ClientModal tabs disappearing on the Cards tab.** The header / tab bar / footer were flex children
  with no `flex-shrink:0`; a tall Cards list made flexbox shrink the tab bar, and since it has
  `overflow-x:auto` (→ implicit `overflow-y:auto`) its buttons got clipped. Added `flex-shrink:0` to all
  three + an opaque `background:var(--surface)` on the tab bar (ClientModal.tsx).
- **"No active fuel cards this month" even though the client has active cards.** The tier's TRACK was
  keyed on cards that *transacted this month* (`activeCardsThisMonth`), which is 0 for a client that
  pumped earlier in the cycle. Re-based `resolveTier(activeCards, gallons)`: **track from the client's
  actual active-card count** (roster `active`), **level from billing-cycle gallons** (the reliable 752
  already shown), dropped the grace/prev-month coupling. Now any client with active cards gets a
  track/tier (e.g. "Building toward Bronze") instead of the empty state.
- **Show this-month gallons distinctly + "make sure gallons show properly (it's July 20)."** Added raw
  `cycleGallons` to RecordVM/ClientRecord. Client card now shows **Gallons · Cycle** (violet) AND
  **Gallons · Month** (accent) with colored dot labels; ClientModal Loyalty tab shows both gallon
  figures + **Active cards** (total) and **Cards used · This month** (DWH transacted) so the two
  card/gallon definitions are unambiguous. The this-month figure is the real DWH calendar-month count
  (0 is legitimate if the client had no July transactions yet; cycle covers late-June activity).

Note: tier level now uses the billing-cycle gallons (stable, matches the card + not understated
mid-month), NOT the partial calendar month — a deliberate revision of the earlier calendar-month
choice based on the July-20 reality. The DWH per-month query is retained for the "this month" display.

Verify: web `tsc` clean for every touched file. Not committed.

## 2026-07-20 — Phase 1 board flow: log→result + instant UI

Aligned Sales Retention Phase 1 with the board sticky notes:
- **Outcome first**, then OoR channel attempts (TG/WA/SMS/RC/IG/FB/EM). Attempts only allowed
  when status is `p1_out_of_reach` (repo rejects otherwise).
- Each OoR outcome / attempt stamps a **1 BD** deadline (`1BD_comms_attempt`); 5th attempt
  still auto-sends to Open Pool.
- Modal + kanban update **instantly** from mutation responses (local timeline events, no
  post-write `detail.reload()` race). Board `onUpdated` keeps columns in sync.
- UI split: `RetentionCaseActions.tsx` (stage panels) + leaner `RetentionCaseDetail.tsx`.
- Returned remains sync-only; Dissatisfied / No-action / Vacation paths unchanged.

Verify: `vitest` retention-phase1 + retention-touchpoints green. Not committed.

## 2026-07-20 — Retention deferred timers (deadline sweep)

Wired the board timer paths that were deferred after Phase-1 UI:

- **Job** `automation.retention.deadline-sweep` every 15m (+ Admin trigger).
- **2BD no-action** → Retention + stamp `10BD_retention` → on expiry → CITI (`p3_hold`).
- **Reached** (agent outcome; fuel-again Returned stays sync-only) → `5BD_post_contact` →
  Open Pool if no fuel.
- **Open Pool** stamps `3BD_pool_claim`; unclaimed → Retention; claim → `p1_pool_assigned` +
  `3BD_new_owner`; 3rd agent fail → CITI. Cap claim auto-moves to CITI.
- **Vacation** 14D → `p1_vacation_followup` (2BD) → `p1_awaiting_ops` → Ops confirm/deny
  touchpoints (confirm → Phase 1, deny → CITI). Inbox notify Ops.
- **Ryan Saab / deal owner** inbox notify on Open Pool via
  `RETENTION_OPEN_POOL_NOTIFY_ZOHO_USER_ID` (+ previous owner).
- Migration `0029_retention_timer_statuses` (reached / vacation_followup / awaiting_ops).

Verify: vitest retention-phase1 + deadline-sweep + touchpoints + cases green. Apply
`pnpm db:migrate` before prod use. Not committed.

## 2026-07-20 — Sales Data Center: this-month gallons fix, caching, filters, editable Leads/Deals

Four-part upgrade to Sales Mytrion → Data Center (all owner-scoped, RBAC rule #9 honored).

1. **This-month gallons = 0 for all clients — ROOT CAUSE FOUND + fixed.** Ran a read-only DWH
   probe (analytics agent): July 2026 data exists (55,595 rows, freshest = today); the `dim_company`
   owner-join and on-fact `agent_zoho_user_id` scoping return *identical* non-zero gallons — so the
   join was never the problem. The real cause: warehouse `agent_zoho_user_id` is 19 digits, so
   `right(id,12)` is a zero-PADDED `000000676127`, but the app's session id (short) yields `676127`
   → `= $1` matches nothing for every agent. Fix in `dwhLoyalty.ts`: `lpad(right(...,12),12,'0') =
   lpad($1,12,'0')` (both sides). Also log the failure in `live.ts loadLoyaltyStatsSafe` instead of
   swallowing. NOTE: if it still shows 0 after deploy, the session id genuinely doesn't share its
   last-12 record digits with the warehouse id (identity-mapping issue, not query).
2. **Loyalty tier re-based on THIS-MONTH gallons** (program basis), with a this-cycle fallback when a
   client has no current-month pumps (never collapses an active client to "Building"): `tierGallons()`
   in RecordsTab + ClientModal; `resolveTier` doc updated; loyalty progress-bar label → "This month".
3. **Caching (SWR)** — new `dcCache.ts` (`useCachedLoad` + `invalidateDcCache` + `formatCachedAt`):
   instant paint from a per-agent module cache, background revalidate only when >60s stale, a Refresh
   button + "Updated Xs ago" caption in the toolbar. Strictly faster (tab switches/refresh never blank).
   Wired Clients/Leads/Deals/Rejections. Edits + carrier-lead-create call `invalidateDcCache` → the
   list refetches instantly.
4. **Filters** — Leads by Status + Source, Deals by Stage (styled native `DcSelect` in the toolbar,
   applied in `dataCenterViews`).
5. **Editable Leads/Deals** — owner-scoped `PATCH /v1/data-center/leads|deals/:id` mirroring the
   cs/billing deal-write pattern (zod `.strict()` allowlist → `resolveWritePayload` casing-resolve →
   `updateRecord` → audit) PLUS a mandatory Owner==caller check (cs/billing skip it; sales is
   owner-scoped). Lead: MC/DOT/Referral_Source/Cell/Phone/Email/Description. Deal: Email/Phone/
   Description. Field API names live-verified via Zoho CRM MCP. Frontend: inline-edit mode in the Lead/
   Deal modals (optimistic apply + toast + cache-invalidate), Deal Value StatCard removed (grid → 3
   cells), Deal Email row added, `LeadEdit`/`DealEdit` raw-value objects on the VMs.

Verify: `pnpm typecheck` ✓, `pnpm test tests/unit/data-center-routes.test.ts` ✓ (25 tests incl. 8 new
PATCH/RBAC — non-owner edit 403, admin act-as, allowlist 400, 404). Web typecheck: my files clean (24
errors are ALL pre-existing branch WIP — finance/*, admin/*, icons.tsx, sidebarBadges.ts). Full backend
suite has 28 pre-existing failures (cs-routes/carrier-mini-app/touchpoints — confirmed identical on a
stashed clean branch, NOT mine). Not committed.

## 2026-07-20 — Retention realtime (Octane WebSocket)

New retention cases push live to the assigned sales agent:
- `notifyCaseCreated` → `inbox_events` + `publishInboxEvent` (`retention.case.created`)
  from hourly sync create + manual `POST /v1/retention/cases`.
- Open Pool / Ops notifies also call `publishInboxEvent` (were persist-only before).
- Pool opens also fan out on topic `retention:pool` (any internal worker may subscribe).
- Sales FE: `useOctaneRealtime` + `useRetentionRealtime` in Shell; Cases pane merges the
  new row instantly; Pool tab reloads on `retention.pool.opened`.

Note: live push requires `JOBS_WORKER_MODE=inline` (same process as WS). Split workers
still persist inbox rows; FE sees them on next fetch until pg NOTIFY exists.

Verify: realtime-inbox + retention unit tests + typecheck green. Not committed.

## 2026-07-20 — Sales Open Pool claim approval (Sales Mytrion gaps)

Filled Sales-agent gaps only (CS / Retention desk / CITI batch deferred):

- Open Pool claim is no longer instant: **request → owner approve/decline** or
  **1 BD auto-approve** (`1BD_claim_approve`). Requires **10+ days inactive**.
- `pool_owner_zoho_user_id` + `pending_claimant_zoho_user_id` + status
  `p1_pool_claim_pending` (migration `0030_retention_pool_claim_approval`).
- Touchpoints: `pool_claim` (request), `pool_claims_pending`, `pool_claim_approve`,
  `pool_claim_decline`. FE: Retention → **Claims** pane + Pool copy/CTA updated.
- Inbox/WS: `retention.claim_request|approved|declined`.

Still deferred (CS Mytrion / later): Retention desk UI, P2→pool loop, Zoho owner
email SMTP, Verification/OOB/WEX DWH exclusions (no columns in scan today),
CITI Sales Manager bi-weekly batch, pre-entry funded-no-use alert, MOR reports.

Verify: retention unit tests + typecheck green. Not committed.

## 2026-07-20 — Retention migrations applied + API restarted

- Ran `pnpm db:migrate` against Render app Postgres (`MYTRION_OPS_DATABASE_URL`).
  Applied through `0030_retention_pool_claim_approval` (journal ids through 31).
- Confirmed live columns: `pool_owner_zoho_user_id`, `pending_claimant_zoho_user_id`.
- Restarted local API (`tsx watch src/server.ts` on :3001) so inline jobs + WS use
  the new schema.

### 2026-07-20 — Notification tizimi N-0: outbox + pg-boss dispatcher (poydevor)

Ultraplan (Analitika/notification_system_ultraplan.md) N-0 bosqichi:
- Schema: mini_app_notifications (outbox: dedupe_key UNIQUE = fakt boshiga bitta qator,
  payload'da FAQAT template kirishlari — last6 qoidasi, money-code qiymati saqlanmaydi) +
  mini_app_notification_prefs (qator yo'q = yoqiq). drizzle.config ro'yxatiga qo'shildi;
  MIGRATSIYA HALI GENERATSIYA QILINMAGAN — esbuild darwin binary VM'da ishlamaydi,
  Mac'da: corepack pnpm db:generate && pnpm db:migrate.
- modules/notifications/: registry.ts (11 tur — rol-matritsa BITTA joyda), templates.ts
  (4 til, hozircha 'en' render — registratsiyada language_code yig'ish backlog),
  service.ts (notifyMiniApp: insert + pg-boss enqueue, jobs o'chiq bo'lsa inline fallback;
  dispatchMiniAppNotification: idempotent 'new'-only, rol filtri, driver o'z kartasi
  fail-closed, prefs, faqat 0-yetkazishda retry — partial fan-out hech qachon takrorlanmaydi).
- jobs: notification.dispatch (retryLimit 4, backoff, dead-letter) + worker registratsiyasi.
- Birinchi caller: override bot receipt endi outbox orqali (sendPlainReply import route'dan
  olib tashlandi). Xatti-harakat ekvivalent, ortiga tarix qatori qo'shildi.
Keyingi (N-1): card_status diff poller + money_code event, pilot flag per-carrier.

### 2026-07-20 — N-2: client_news + Inbox real feed + mavjud WebSocket hub'ga ulanish

Jadval nomlari saqlanib qoldi (owner qarori: rename shart emas) — mini_app_notifications /
mini_app_notification_prefs, YANGI: client_news + client_news_reads (0032_client_news.sql,
qo'lda, IF NOT EXISTS).

- client_news: title/body per-locale jsonb (en majburiy), audience_scope 'all'|'carriers'
  (+carrier_ids), roles owner/driver, severity info|important, pinned, publish/expires oynasi.
  O'qish DOIM caller'ning verified registration'i orqali filtrlanadi (listNewsForRegistration) —
  bitta klientga yozilgan post boshqasiga sizib chiqmaydi. important+carriers → notification
  outbox orqali bot push (type 'news'); 'all' uchun bot-blast ATAYIN yo'q (digest keyin).
- Muallif: /v1/client-news (POST admin RBAC + audit, GET list) — zoho-octane widget/skript uchun.
- Mini-app: POST /carrier/mini-app/inbox — ikkala tab bitta chaqiriqda (news + notifications;
  driver slice dispatcher routing'ining aynan o'zi, fail-closed); /inbox/news-read receipt.
- Realtime: MAVJUD hub'ga ulandik — topic grammatikasiga inbox:miniapp:<telegramUserId>,
  GET /carrier/mini-app/realtime (websocket, initData auth, subscribe-only, faqat o'z topic'i).
  Dispatcher muvaffaqiyatli send'dan keyin hub.publish qiladi (split worker deploy'da 0 —
  hub'ning o'z scope-note pozitsiyasi, keyingi fetch'da baribir keladi).
- Frontend: Inbox endi real (feedToInbox: news locale-pick + notifications client-side render,
  demo seed faqat fetch yiqilganda fallback), WS live append, news o'qilganda read-receipt.
- Eslatmalar: (1) Mac'da corepack pnpm db:migrate (0031+0032). (2) _to_delete/ ichidagi
  eski fayllarni o'chirish. (3) drv uchun notification unread holati client-side (localStorage
  emas, sessiya ichida) — per-user server read state N-3 prefs UI bilan birga.

### 2026-07-20 — mytrion-crm: Client News muharriri (Admin → Client News tab)

- apps/mytrion-crm/src/mytrions/admin/ClientNews.tsx (+module.css, +api/clientNews.ts):
  professional composer + feed. Rich-text: dependency'siz contentEditable + whitelist toolbar
  (B/I/U, H3/¶, ro'yxatlar, link, clear) — UX xolos, XAVFSIZLIK server tomonda:
  modules/notifications/richText.ts sanitizer (whitelist b/i/u/p/br/ul/ol/li/h3/a; a faqat
  http(s)/mailto href + noopener; title'lar plain-textga stripping) create route'da qo'llanadi.
- Composer: 4 til tab (EN majburiy, to'ldirilganlar • bilan), auditoriya All / Specific carriers
  (ClientCombobox reuse + chip'lar), rol pillari Owner/Driver, Delivery: Inbox-only /
  Important (bot push) / Pinned. Feed: pill'lar bilan post kartalari, EN body render.
- Mini-app InboxTab: news body endi rich render (RichBody — DOMParser bilan client-side
  qayta-sanitize, defense-in-depth; .rich-news tipografiyasi global.css'da). Notification'lar
  plain-text yo'lida qoladi.
- Eslatma: mytrion-crm'da BIZDAN OLDIN mavjud tsc xatolar bor (sonner moduli, unused importlar) —
  root node_modules bilan tekshirilgani uchun bo'lishi mumkin; Mac'da app'ning o'z
  node_modules'i bilan `pnpm --dir apps/mytrion-crm typecheck` haqiqiy natijani beradi.
  ClientNews fayllari xatosiz.

### 2026-07-20 — N-1: card_status diff poller + money code eventi

- 0033_notification_state.sql: mini_app_notification_state (scope PK + jsonb watermark) —
  poller restart'da qayta-notify qilmaydi; scope'ning BIRINCHI o'tishi faqat baseline yozadi
  (mavjud kartalar bo'yicha portlatmaydi). Mac'da: corepack pnpm db:migrate.
- pollers.ts runCardStatusPoll: NOTIFY_POLL_CARRIERS (env, bo'sh = no-op) dagi har carrier
  uchun servercrm getCards snapshot vs watermark diff → card_status event (last6, prev,
  status, cardId — cardId findDwhCardByNumber orqali best-effort; topilmasa owner eshitadi,
  driver nusxasi fail-closed o'tib ketadi). Bitta carrier xatosi qolganlarini to'xtatmaydi.
- Jobs: notification.poll (singleton, */2 daqiqa cron, overlap yo'q) + worker registratsiya.
- money-code draw: muvaffaqiyatli draw'dan keyin type 'money_code' notification (qiymat
  XABARDA YO'Q — registry qoidasi, "mini-app'ni oching").
- Pilot yoqish: .env'da NOTIFY_POLL_CARRIERS=<OnzmoveCarrierId> + FF_JOBS_ENABLED=1 (worker
  rejimiga qarab). O'chirish: bo'sh qoldirish.

### 2026-07-20 — News: rasm dastagi + "Octane mobile app" e'loni

- Rich-text whitelist'ga <img> qo'shildi (server richText.ts: faqat https src + alt, boshqa
  atribut o'tmaydi; mini-app InboxTab client sanitizer'i ham mos). CRM editorda 🖼 tugma
  (https URL bilan insertImage). CSS: max-width 100%, radius (mini-app + CRM preview).
- scripts/post-news-octane-mobile-app.sh: hamma klientlarga (owner+driver, pinned, 4 til)
  Octane Fuel mobil ilova e'loni — App Store artwork (mzstatic og:image), ikkala do'kon linki.
  Ishga tushirish: BASE=... API_KEY=$OCTANE_INTERNAL_API_KEY ./scripts/post-news-octane-mobile-app.sh
  Yoki CRM Admin → Client News editor orqali qo'lda.

### 2026-07-21 — Notification audit + caveat'larni yopish (multi-lang + queue bug)

Notification tizimi (N-0/N-1/N-2) auditi. Backend typecheck 0, 758 test yashil, lint toza
(o'zgartirilgan fayllar). Caveat holati: (1) migratsiya generatsiyasi — YOPILDI (0031-0033
qo'lda, journaled, DB'da mavjud, db:migrate yashil); (2) _to_delete/ — YO'Q (tozalangan);
(3) drv unread server-state — N-3'ga qoldirilgan (kelasi faza, bug emas); (4) CRM tsc 25 xato —
hammasi BIZDAN oldingi (icons/Jobs/DashboardTab…), ClientNews fayllari toza.

**Caveat #2 (multi-lang) — TO'LIQ YOPILDI.** Ilgari templates.ts 4 til bor edi lekin dispatcher
har doim 'en' render qilardi (registratsiya language_code'ni saqlamas edi). Endi:
- `registered_mini_app_companies.language_code` ustuni (migratsiya `0034_registration_language.sql`,
  ADD COLUMN IF NOT EXISTS, journal idx 34, DB'ga qo'llandi). `TelegramWebAppUser.language_code`
  qo'shildi (Telegram initData'da keladi).
- Redeem + driver self-register upsert'lari tgUser.language_code'ni yozadi; qayta-ochishda
  bo'sh kelsa eski qiymat saqlanadi (COALESCE-keep, dev mock lang'siz ochsa yo'qotmaydi).
- service.ts dispatch: `renderNotification(spec.templateKey, reg.languageCode, payload)`.
  `normalizeLang()` har qanday IETF tag'ni (ru/uz-Cyrl/pt-BR) qo'llab-quvvatlanadigan tilga maplaydi,
  fallback 'en'.
- News per-recipient locale: outbox payload endi TO'LIQ LocalizedText map'ini saqlaydi
  ({en,ru,uz,es}), .en emas. renderNotification (bot) va App.tsx notifToInbox (FE inbox) ikkalasi
  ham payload slot'idan recipient tilini tanlaydi (object → locale-pick, string fallback eski
  qatorlar uchun). Bitta outbox qatori har recipient tilida to'g'ri render bo'ladi.
- Test: `tests/unit/notification-templates.test.ts` (6 test — normalizeLang + render locale-pick).

**BUG topildi va tuzatildi (jobs).** `notification.dispatch` + `notification.poll` queue'lari
`ALL_JOBS`'da YO'Q edi → boss.ts createQueue() ularni provizatsiya qilmasdi → FF_JOBS_ENABLED=1
bo'lganda dispatch enqueue prod'da xato berardi (dev inline fallback buni yashirgan). Test
`jobs-catalog: every cron schedule points at a defined queue` yiqilgani shu bugni ushladi.
Tuzatish: ikkala job'ni ALL_JOBS'ga qo'shildi.

Verified: mini-app ?dev=1&lang=ru → RU render; dev mock-init-data language_code=ru'ni qaytaradi;
backend hot-reload toza. Local dev: `pnpm dev:all` backend+CRM; mini-app alohida `pnpm -C
apps/mini-app dev` (:5174), ?dev=1 mock Telegram identity.

### 2026-07-21 — N-3: notification read-state server-persisted + inbox 500 bug tuzatildi

Caveat #4 YOPILDI. Ilgari notification unread holati faqat client-side (sessiya ichida) edi —
reload/relaunch'da badge tiklanardi. Endi news bilan bir xil server-persisted:
- Jadval `mini_app_notification_reads` (notification_id + telegram_user_id, unique) — client_news_reads
  nusxasi. Notification bir necha user'ga fan-out bo'lgani uchun read holati per-user (outbox
  qatoridagi ustun emas). Migratsiya `0035_notification_reads.sql` (journal idx 35, DB'ga qo'llandi).
- service.ts: `markNotificationRead(tgUserId, notifId)` (idempotent, faqat caller'ning o'z receipt'i,
  ownership risk yo'q) + `readNotificationIds(tgUserId, ids)` (badge uchun Set).
- Inbox route: ko'rinadigan slice uchun read holatini so'raydi, har notification'ga `read` maydoni
  qo'shadi. Yangi endpoint `POST /carrier/mini-app/inbox/notification-read`. Hub live-push ham
  `read:false` yuboradi.
- FE (api.ts + App.tsx): InboxNotification.read; notifToInbox `unread: !n.read`; markAllRead + readNotif
  endi man_ id'lar uchun apiMarkNotificationRead chaqiradi (nws_ = news, man_ = notification,
  gen- = client-only). 

**BUG (blocking) topildi + tuzatildi:** listNewsForRegistration `sql\`${clientNews.publishAt} <= ${now}\``
postgres.js driver'da RAW Date bind qila olmaydi → inbox endpoint HAR DOIM 500 berardi ("Received an
instance of Date"). FE fetch fail'da demo seed'ga tushgani uchun "real inbox" ko'rinishda ishlab
turgandek edi. Tuzatish: drizzle `lte(clientNews.publishAt, now)`. Notification kodida boshqa
Date-in-sql interpolatsiya yo'q (attempts+1 lar faqat ustun).

Verified E2E (jonli backend): seed registration+sent notification → inbox read:false → notification-read
→ inbox read:true (server-persisted). Typecheck backend+mini-app 0, 758 test yashil, lint toza.

### 2026-07-20 — Hamroh promo bot: mytrion tomoni (support-bot fasadi) + deep-link actions

Qaror: hamroh (Telegram agent harness, ~/Projects/Octane/AI/hamroh) HOZIR mini-app targ'ibot
boti, keyin support agent. Arxitektura: instance-per-carrier (bitta Claude sessiyasi hamma
chatlarni ko'radi — cross-client izolyatsiya faqat alohida konteyner bilan), toollar
carrierId'ni env'dan oladi, writes minimal.

mytrion tomonida yangi: src/routes/v1/supportBot.routes.ts (/v1/support-bot/*):
- POST /override — DRIVER-ONLY, telegramUserId → registration lookup (active + carrier ==
  bot env carrier, fail-closed), requireDriverCardNumber bilan o'z kartasi, mini-app bilan
  BIR XIL flag/rate/audit/notification (override receipt). Owner → 403 "mini-app'da".
- GET /access?carrierId — active registrationlar ro'yxati; hamroh scripts/
  sync_octane_access.py shu bilan access.json'ni yangilaydi (bitta identity manba:
  mini-app'da revoke = botda ham yo'qoladi).
Mini-app: ?startapp=go-<action> deep-linklar (override/moneycode/funds/txns/pinunit/status/
invoices) — ro'yxatdan o'tgan user to'g'ri sheet'da ochadi; go-* registration-id yo'liga
sizmaydi. Hamroh repo'da: prompts/project.md.octane (promo persona, intent→pointer jadvali,
anti-spam qoidalar), skills/octane-promo, tools/octane/octane_override.py (model argumentiga
ishonmaydi: sender oxirgi 5 daqiqada shu chatda yozganini DB'dan tekshiradi, qolganini
backend qayta-verify qiladi).

### 2026-07-20 — Support-bot RBAC yuzasi (mytrion, to'liq server-side)

supportBot.routes.ts qayta yozildi — YAGONA gate resolveCaller(carrierId, telegramUserId):
active registration + carrier == bot instansiyasi env carrier (fail-closed; boshqa kompaniya
useri "not registered" bilan bir xil ko'rinadi — probing yo'q). ROL registration'dan, hech
qachon so'rovdan emas. Endpointlar:
- /whoami — rol/ism/kompaniya (bot muomala uchun)
- /card-status — driver: faqat o'z kartasi qatori; owner: fleet statuslari (30 cap)
- /funds — owner: real raqamlar (efs_balance, credit); driver: FAQAT boolean + o'z karta statusi
- /txn-report — hisobot so'ragan odamning O'Z bot-DM'iga fayl (guruhga EMAS — fleet raqamlari
  guruh a'zolariga ko'rinmasin); driver: o'z kartasi + retail majburiy; owner: to'liq
- /override — driver-only, o'z kartasi, mini-app bilan bir xil flag/rate/audit/receipt
- /access — hamroh access.json sync manbai
Read rate: 30/daq/carrier, write: 5/daq. Hamma javob shakli rolga qarab server tomonda
kesilgan — model/bot hech narsani kengaytira olmaydi. Hamroh toollari keyingi qadam
(octane_override naqshi bo'yicha: sender-verify + shu endpointlar).

### 2026-07-20 — Hamroh → apps/agent-telegram-bot (monorepo'ga ko'chirildi)

Hamroh source apps/agent-telegram-bot/ ga nusxalandi (.git/.env/data'siz; upstream 2026-07).
Octane qatlami: tools/octane/ endi 5 ta tool (_client.py umumiy: env cfg + backend POST +
sender-verify) — whoami, card_status, funds, txn_report, override. Hammasi mytrion
/v1/support-bot/* RBAC yuzasiga boradi; rol/carrier server tomonda. OCTANE.md — to'liq
setup (instance-per-carrier, env'lar, ishga tushirish, invariantlar, upstream farqlar).
Eslatma: ~/Projects/Octane/AI/hamroh dagi asl nusxada qolgan tools/octane/octane_override.py
va boshqalar endi dublikat — asl repo tozalanishi mumkin (yoki upstream-only qoldiriladi).
## 2026-07-20 — Retention modal: Call, auto-Working, screenshot attempts

- **Call** lives in the case modal header (RingCentral click-to-dial) for any open
  Phase-1 case with a phone — not buried only under OoR log.
- Removed **Start working** from the agent UI. New breach cases open as
  `p1_in_progress` (Working) automatically; open `p1_new` rows backfilled in
  migration `0031_retention_attempt_evidence`. Kanban “New” column removed.
- Non-RC OoR attempts (TG/WA/SMS/IG/FB/email) **require a screenshot** (upload or
  paste). Stored on `retention_case_events.evidence_url`; shown in the timeline.

## 2026-07-20 — Retention attempt-first flow (rewrite)

Correct Sales agent loop (was outcome-first — confusing):

1. Case created → agent notified (inbox/WS).
2. Open case → **1 · Contact attempt** (Call or TG/WA/…).
3. RC call-end (dialed from modal) **forces** attempt log; RC call log = proof.
   Other channels: screenshot **or** notes.
4. Only then **2 · Client status** (Reached / no contact / Vacation / Dissatisfied).
   Modal blocks close until force-log + status after an attempt.

Backend: `log_attempt` allowed from Working (not only OoR); stays Working until
status or 5 attempts → Pool.

## 2026-07-20 — Retention wizard polish (icons + close on status)

- Channel pills use brand SVG icons (Telegram / WhatsApp / SMS / IG / FB / Email).
- True wizard: **Attempt → Status** (one step at a time); modal **closes after
  status save** (or no-contact / pool).
- Dissatisfaction reasons are radio cards with short hints (not a bare picklist).

## 2026-07-20 — Remove Sales Claims review

- Dropped Retention → **Claims** pane (`PoolClaimsPane`) — not a Sales review job.
- Open Pool claim is **instant assign** again (no owner approve / pending UI).

## 2026-07-20 — Fix: Data Center → Clients "Gallons · This month" = 0 for every client

**Symptom:** Clients cards + ClientModal showed `Gallons · This month` = 0 (and `Cards used · This
month` = 0) for every client, while `Gallons · Cycle` and the roster populated normally.

**Diagnosis (not a rendering bug, not DWH lag):**
- The month figures come from `GET /v1/data-center/loyalty-stats` → `fetchLoyaltyStatsByAgent`
  (`src/integrations/dwhLoyalty.ts`), a DWH query that maps carrier→owner by the **last-12-digit
  suffix** of the session Zoho id against `dim_company.agent_zoho_user_id`. Cycle gallons + the roster
  come from **servercrm** (`/api/clients/by-agent`), which matches by full id **with a display-name
  fallback** (`dim_company.agent ILIKE`) when the id resolves 0 rows.
- Read-only DWH probe (analytics agent): July 2026 is fully loaded (max tx date = today, 3.75M gal
  this month); the loyalty SQL returns correct non-zero figures for a properly-shaped agent id. So the
  warehouse and the query are fine.
- Logic: the roster populated (clients visible) but our id-suffix query returned `{}`. If the roster
  had resolved by **id**, our suffix match would have matched too. It didn't → the roster resolved via
  servercrm's **name** fallback → the session id is in a different id-space than the warehouse
  `agent_zoho_user_id`, and our id-only query silently matched nothing → all clients read 0.

**Fix:** give `fetchLoyaltyStatsByAgent` the same name fallback servercrm uses. Extracted the
aggregation into `runLoyaltyQuery(predicate, bind)`; try `OWNER_BY_ID_SUFFIX` first, and if it
resolves no carriers and a name is supplied, fall back to `OWNER_BY_NAME` = `lower(c.agent) =
lower($1)` (exact, case-insensitive — safer than `ILIKE` for free-text `%`/`_`). The
`/data-center/loyalty-stats` route now passes `ctx.userName` as the fallback name for the self case
(and act-as-by-header, where `ctx.userName` is already the target); an admin targeting another agent
by `?zoho_user_id` uses the id path only (we don't have that agent's name). Verified against the DWH:
the name path selects the byte-for-byte identical carrier set (128/128) as the id path for a real
agent, with non-zero this-month gallons.

**Why it's safe:** the fallback name is the SAME `ctx.userName` servercrm already matched to resolve
the roster, so it's guaranteed to hit; it's session-authoritative (no IDOR); name-scoped only as a
fallback after the id match is empty. Tests: `data-center-routes.test.ts` updated (name arg asserted)
+ a new regression test for the plain frontend call → 26/26. (28 unrelated failures in
carrier-mini-app / cs-routes / touchpoints-count are pre-existing from the in-progress retention work,
confirmed by stashing this change.)

## 2026-07-21 — Perf: Data Center → Clients loads faster (one DWH scan, drop dashboard.agent_sales)

**Complaint:** Clients tab loads too slowly. **Measured** (read-only DWH probe, EXPLAIN ANALYZE):
- The DWH has **NO indexes** on `octane.mart_transaction_line_items` (1.24M rows) or `dim_company` —
  every query is a **Parallel Seq Scan** (~99k blocks / ~775 MB, ~250 ms). This is the real floor.
- The Clients tab fired **3 calls**: `clients.by_agent` (servercrm: dim_company + live CMP debt),
  `dashboard.agent_sales` (servercrm: **6** full mart scans, used ONLY for per-carrier cycle volume),
  and `loyalty-stats` (our DWH) — which, post-name-fallback, ran **twice** in this env (id path → 0
  rows still full-scans, then name path) ≈ 2 scans.

**Change (source clients gallons from dim_company + mart_transaction_line_items, one pass):**
- `src/integrations/dwhLoyalty.ts`: `fetchLoyaltyStatsByAgent` is now a **single** query — resolve the
  agent's carriers in a cheap `dim_company`-only CTE (`(id-suffix OR name)` OR'd in one pass, no more
  id-then-name double scan), then aggregate `mart_transaction_line_items` ONCE for **cycle (26th→25th)
  + this-month + prev-month** gallons/cards/txns. Added `cycleGallons` to `LoyaltyCarrierStats`. Cycle
  reconciled to the penny vs an independent sum (288,052.38 for a test agent).
- Frontend (`live.ts`): **removed `loadCycleGallonsByCarrier` / the `dashboard.agent_sales` call** from
  `loadRecords`; cycle gallons now come from the loyalty payload (`ls.cycleGallons`). `loadRecords` is
  down to **2 calls** (roster + one loyalty query). `LoyaltyStat` (loyalty.ts) gained `cycleGallons`.
- Net: Clients-tab DWH work goes from *(2 loyalty scans + 6 dashboard scans)* → **one scan**; one fewer
  round-trip. Clients tab uses stale-while-revalidate cache, so this is the cold-load + revalidate cost.

**Zoho (Leads/Deals):** already batched — `fetchAgentLeads`/`fetchAgentDeals` pull `limit 0, 2000` in
ONE COQL query, so no change needed there.

**Still the floor / not done here:**
- The unindexed full seq scan (~250 ms) is unavoidable app-side — a covering index
  `mart_transaction_line_items (carrier_id, transaction_date) INCLUDE (line_item_fuel_quantity,
  card_number, transaction_id)` would let it switch to per-carrier range scans (~11k rows vs 1.2M), but
  the **DWH is a read-only third-party replica — this must be requested from the warehouse owner**, we
  never migrate it.
- `SET jit=off` saves ~24–38 ms/query but I did NOT set it globally (dwh.ts) — it could slow the big
  analytics-agent queries; leaving it as an option.
- The roster call still goes through servercrm for **live CMP debt**. Could be sourced directly from
  `dim_company` (fully DWH, 3→1 calls) but that trades live debt for ~3h-stale DWH debt — a product
  decision, pending the user.

Verify: backend typecheck + lint clean; `data-center-routes.test.ts` 26/26 (mock gained `cycleGallons`);
frontend typecheck unchanged at 24 pre-existing errors (none in my files; finance/admin WIP). Shipped
consolidated SQL validated live against the DWH.

## 2026-07-21 — Phase 1 Sales Retention: correct to board

Corrected Phase 1 to match the Sales board (prior attempt-first flow was wrong).

**Backend**
- Migration `0032`: rename open `1BD_comms_attempt` → `5BD_comms_attempt` (deadline *at* unchanged; next stamp is authoritative).
- OoR attempts stamp **5 BD** each; log_attempt gated to `p1_out_of_reach` only; attempts 1–4 stay OoR; 5 → Open Pool + Ryan notify.
- Reached 5 BD expiry → **handoff to Retention** (never Open Pool).
- Sync closes open non-CITI cases on **any transaction after `createdAt`** (drop “back under threshold”).
- Deal-owner / Ryan alerts: **inbox + WS only** — no Zoho/SMTP sender in-repo yet; hook documented in `notify.ts`.

**Sales FE**
- Wizard: **Call → forced stage** (OoR / Reached / Dissatisfied / Vacation); OoR then channel picklist (RC auto on call).
- Kanban: Working / **Reached** / Out of Reach / Vacation / Exited (Dissatisfied column dropped — jumps to Phase 2).
- Captions: `5 BD attempt ·`; Reached copy no longer mentions Open Pool.

**Verify:** unit tests for phase1 / deadline-sweep / sync; `pnpm db:migrate` for 0032.

**Out of scope (later):** Open Pool owner-change / 3 BD unclaimed → Retention deep rules; Retention desk / CITI UI.

## 2026-07-21 — Fix: Retention Call shows "No phone on file"

`retention.case_contact` used `getDwhCompanyDetails`, which only read `dim_company.contact_phone`.
Sales roster / deals use **`deal_phone || contact_phone`** — most carriers only have `deal_phone` filled.
Updated `getDwhCompanyDetails` to coalesce the same way. Restart API (or wait for reload) and reopen the case.

## 2026-07-21 — Retention Kanban stages + New wizard

- Kanban columns: **New / Reached / Out of Reach / Vacation / Dissatisfied / Closed** (dropped Working + Exited).
- **New** = call-within-2BD inbox (`p1_new` / `p1_in_progress` / pool assigned).
- Dissatisfied / Closed stay on the agent board: `my_cases` no longer forces `phase_1_agent`; Retention handoff keeps sales assignee.
- Modal wizard: New → Call → Stage → per-stage workflow (progress chrome).

## 2026-07-21 — Migration 0033: Sales Agent board columns

- `retention_statuses`: added **`board_column`** + **`sort_order`**; labels match Kanban (New / Reached / OoR / Vacation / Dissatisfied / Closed).
- `agent_outcome` enum: added **`reached`** (watching) vs `returned` (closed on fuel).
- Applied locally via `pnpm db:migrate`. Open Reached rows backfilled to `agent_outcome=reached` post-migrate.

## 2026-07-21 — Retention entry exclusions (debtors / pre-swipe / OoB)

**OoB** = Out of Business (CRM: `Closed Lost` / stage text matching out of business).

Sales Agent case scan (`scanRetentionCandidates`) now excludes:
1. **Debtors** — Billing Mytrion rule via `public.cmp_invoice` (not stale `dim_company.is_debtor`).
2. **Pre–Card Swiped** (Verification / WEX / funded-never-used) — requires `first_swipe_date`.
3. **Closed Lost / OoB** — `deal_stage` filter.
4. **Deactivated** — `is_active = 1` only.

Pure helper: `isRetentionEntryEligible`. UI caption notes the exclusions.

## 2026-07-21 — Phase 1 stage workflows aligned (Reached / Dissatisfied / Vacation)

**Reached:** watch-only (no attempts); hourly sync closes on any fuel after open;
`5BD_post_contact` expiry → **Open Pool** + Ryan/owner notify (was wrongly Retention).
Entering Reached clears OoR attempt counter.

**Dissatisfied:** reason list matches board; immediate handoff → Retention (10 BD), not Pool.

**Vacation:** 14d countdown → 2 BD follow-up → Ops confirm (→ New) / deny (→ CITI);
return-date note field on stage confirm; fuel still auto-closes.

## 2026-07-21 — OoR stage after every attempt + Open Pool Zoho mail

- After each OoR attempt (RC or other), stage picker shows again with **Out of Reach**
  available (pre-selected); attempt 5 → Open Pool.
- Open Pool notify: inbox/WS (Ryan + previous owner) **and** best-effort Zoho CRM
  `send_mail` on the Deal (`RETENTION_NOTIFY_FROM_EMAIL` optional From).
- Auto-close on any transaction after case open remains in hourly `syncRetentionCases`
  → `p1_returned` + `closedAt`.

## 2026-07-21 — Retention wizard: RC auto-attempt + stage UX

- **Move to stage** button shows spinner / “Saving…”; optimistic board update before API.
- **US phone** `formatUsPhone` (+1 (773) 909-6150) prominent in header, call CTA, call-ended banner.
- **RC auto-log:** New→OoR after a call counts attempt 1 (channel RingCentral); OoR call-end auto-logs (no manual “Log RC” / no note). Retry only on failure.
- Other channels: note field **red outline** when required (no screenshot).
- Timeline headlines: `RingCentral attempt → Out of Reach` (etc.).

## 2026-07-21 — RingCentral: silent call lifecycle toasts

Dialing / connected / ended toasts removed from `RingCentralPhone` and dial sites.
Backend `postRingCentralCallEvent` still runs on every event. UI warnings only for
**session ended (logout)** and **adapter load failure** / dial-not-ready errors.

## 2026-07-21 — Retention tab UI polish (metrics + kanban chrome)

External CRM kanban patterns (HubSpot-style headline KPIs, column count + value aggregates,
color-coded stage headers) applied to Sales Retention without leaving the Sales design system
(Rajdhani / JetBrains Mono / cyan accent).

- `retentionBoardStats()` — active / overdue / gal-at-risk / high-freq + per-column gallons.
- `RetentionBoardUi.tsx` — hero, 4-up metric strip, column heads (count + gal), cards, empty.
- Cases / Open Pool / RetentionTab wired to `.ss-ret-*` chrome; tab badges for active + pool.
- Column hints + left rail colors align with stage SLA copy (2 BD / 5 BD / OoR attempts).

## 2026-07-21 — Inbox live toast on every Sales tab

Shell `useSidebarBadges` already held the ServerCRM WS; hardened so inbox push works off-Inbox:
- Toast title fixed to **New inbox message** (subject as body) so subjects with “error” don’t
  render as error-tone; fires for the effective user on any tab.
- `watchKey` reconnects the shell socket on View-as user change; refs avoid stale owner match.
- `inboxLiveBus.publishInboxLive` fans out to InboxTab + Home preview lists (shell still owns toast).

## 2026-07-21 — Fix: Home goal/streak stuck at 0

Home called `getAppStats()` with **no** `zoho_user_id`, unlike Deals/Desk. Failures / empty
owner resolution rendered as silent zeros (no error UI). Backend COQL on
`Deals.Application_Date` (application filled) was already correct — verified live for Daniel
(29 apps / 90d; week + best non-zero).

- FE always passes session / act-as `zoho_user_id`; normalizes day counts; shows load/error on
  goal bar + streak strip.
- Route logs owner + totals at debug.

## 2026-07-21 — Data Center Money Codes (zoho-octane parity)

Reference: `zoho-octane` self-service Records → Money Codes.

**Correction:** list/void are **not** DWH touchpoints — the ledger is our Ops DB table
`money_code_requests` (ServerCRM draw writes the same table via `MYTRION_OPS_DB_INTERNAL`).

- Migration `0034`: draw-model columns (company_name, batch_id, unit_number, USED, …);
  drop the old ACTIVE unique arbiter.
- Local touchpoints: `money_code.list` (SQL, own-only) + `money_code.void` (own-only check
  on Ops DB, then ServerCRM EFS-safe void which writes back to the same table).
- Draw/preview stay `dwh.money_code` / `dwh.money_code_draw` (live EFS).
- FE: `dataCenterMoneyCodes.tsx` — never shows `efs_money_code`.
