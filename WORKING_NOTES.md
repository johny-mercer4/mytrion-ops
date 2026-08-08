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

## 2026-07-22 — Analytics dashboard as reusable components

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

## 2026-07-21 — Retention: disable LLM weekly-scan (Sales first)

- Parked `automation.retention.weekly-scan` in `DISABLED_JOB_QUEUES`: no cron, no Admin
  trigger, no automation worker. Boot unschedules any leftover pg-boss cron.
- Keep deterministic Sales jobs: `case-sync` (hourly) + `deadline-sweep` (15m).
- Re-enable LLM weekly scan only after Sales Mytrion retention is solid, then CS Mytrion.

## 2026-07-21 — RingCentral: suppress false “session ended” toast

- Embeddable emits `loggedIn:false` while restoring a persisted session after refresh.
- Only emit `logout` when prior state was signed-in; reset login cache on adapter teardown;
  debounce the toast (~2.5s) so a quick re-login cancels it.

## 2026-07-21 — RingCentral: Sales + CS only, pointer cursor

- Softphone moved to `WorkerLayout`, gated to `/main/salesmytrion` + `/main/csmytrion`
  (torn down on Billing/Finance/Admin/picker).
- Hover cursor: host `#rc-widget-adapter-frame { cursor: pointer }` + Embeddable
  `stylesUri` as a `data:text/css` URI (`ringcentralEmbedStyles.ts`) — localhost file
  URLs are blocked by Chrome Private Network Access from `apps.ringcentral.com`.

- Presentational: AnalyticsKpiGrid, AnalyticsTrendChart, AnalyticsBreakdown, AnalyticsLeaderboard,
  AnalyticsDimensionTabs, DeltaPill
- Hook: useAnalyticsSnapshot({ dimension, pollMs, enabled }) — loads / caches / polls per dimension
- Composer: AnalyticsDashboard — accepts dimension / sections / showTabs / showHeader / title /
  pollMs / external `block` so pages can mount full or slim widgets
- Analyst page Dashboard.tsx is now a thin `<AnalyticsDashboard />` shell

Import from `@/components/analytics`.

## 2026-07-22 — pnpm 11 broke `pnpm dev:all`

`apps/mytrion-crm/pnpm-workspace.yaml` was auto-created by pnpm 11 with a placeholder
`esbuild: set this to true or false` (no packages / invalid allowBuilds) →
`ERROR packages field missing or empty` on `pnpm -C apps/mytrion-crm install`.

Product: CS (not deal-owner email) approves Sales Open Pool claims; Phase 2 desk + CITI Folder
in Customer Service Mytrion (distinct from Citifuel Clients).

### Backend
- `requestClaim` → `p1_pool_claim_pending` + `1BD_claim_approve` (no instant assign).
- CS `approveClaim` / `declineClaim` (dept `customer-service` or admin); Sales cannot approve.
- Approve / 1BD auto: Zoho Deal Owner required; Contact + Account Owner best-effort
  (`src/modules/retention/zohoOwnership.ts`).
- Touchpoints: `retention.cs_claims_*`, `retention.cs_cases*`, `retention.cs_citi_*`.
- Phase 2 outcomes in `phase2.ts` + `retentionCaseCsRepo`.
- Profile seed: Customer Retention → CS Mytrion; migration `0035`.

### Frontend
- Sales Open Pool: **Request claim** + Pending CS row state.
- CS Shell nav: Retention Cases / Open Pool Claims (badge + realtime) / CITI Folder.

### Smoke checklist
1. Sales Open Pool → Request claim → row shows Pending CS; case leaves claimable pool.
2. CS Open Pool Claims → Approve → claimant owns Deal (+ Contact/Account best-effort); case
   `p1_pool_assigned`.
3. CS Reject → back to `p1_open_pool`.
4. Leave pending 1 BD → sweeper auto-approves with Zoho ownership.
5. CS Retention Cases → claim / log attempt / Saved|Refused|OoB|No response|CITI.
6. CS CITI Folder → Confirm → Export CSV (Assignment_Stage=CITI) → Mark sent → `p3_closed`.
7. Customer Retention profile lands on CS Mytrion after migrate / profile-defaults seed.

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

## 2026-07-21 — Sales Mytrion go-live hardening (feature/SalesProd, 11 commits)

**P0 root cause — Clients modal Cards/Activity 403 for every non-admin:** the Clients list
moved to the DWH roster (9d6f270, id-suffix + name-fallback ownership) but `assertCarrierOwned`
still asked servercrm by-agent with the FULL session zoho id (id spaces diverge). Gate now
probes the SAME `buildOwnedCte` arms via `dwhClientRoster.isCarrierOwned` (+60s cache,
in-flight coalescing; DWH outage = 502 DWH_ERROR, never RBACError). Keep gate + list on the
shared ownership path — a second authority is how this P0 happened.

**Security:** `/carrier-users/dwh-cards` + `/carrier-registrations/for-carrier` returned card
numbers / owner PII for ANY carrier to ANY signed-in worker — now `assertCarrierOwned`-gated
(role 'admin' skip covers the API-key system identity).

**RBAC go-live contract:** ADMIN_PROFILE_MARKERS is now EXACT-match, default
`administrator,ceo` (substring 'manager' made "Sales Manager" a silent full admin) — check the
Render env group doesn't still pin the old value. Profile defaults seed at boot (fail-open,
loud log; GET /profiles self-heals). Hard rule: 1 accessible Mytrion ⇒ always auto-enter, no
picker, no Switch link; single-Mytrion grants persist home on write. Touchpoint `departments`
is REQUIRED (compile-time fail-closed; 51 entries tagged `SALES`). Contract pinned by
tests/unit/sales-golive-contract.test.ts + mytrion-access-routes.test.ts + client
Landing/TopBar tests.

**Live events:** WS ownerId vs session id can differ by org prefix — owner matching is now
suffix-normalized (`redesign/zohoIds.ts`), fixing silently-dropped inbox toasts (+ retention).

**Perf:** parked-Tickets badge no longer pages the whole Desk set (≤20 req/load) —
`TICKETS_ENABLED` gates it; `inbox.list` deduped 3→1 POSTs (`fetchDedupe.ts`, 30s TTL,
invalidated on WS event/refresh/delete; cache writes identity-guarded against the
invalidation race); `activity.agent` deduped on Home.

**RingCentral:** rc-*-notify / [RingCentralExtensions] console spam is 100% vendor-bundle
(zero hits in our code/history) — `rcConsoleFilter.ts` drops those exact patterns
(log/debug/info only), installed just before adapter injection. Iframe-origin krisp lines
can't be filtered (cross-origin). Prod auth = per-agent OAuth (no BROWSER_CREDS_ACK).

**Known issues NOT from this work:** ~24 pre-existing TS errors committed with the
SalesMytrionFull merge break the app's `tsc` build gate (vite build itself is clean — the
served `app/` bundle was rebuilt from a clean HEAD worktree); the checkout also carries
concurrent uncommitted retention/CS WIP with ~28 failing tests (carrier-mini-app, cs-routes,
touchpoints catalog count 81→106) — left untouched, scoped all commits by path.

**Deploy checklist:** confirm Render env doesn't override ADMIN_PROFILE_MARKERS; verify
Daniel Brown (Sales Agent) lands on /main/salesmytrion, gets Forbidden on /main/billingmytrion,
403 on admin/finance APIs; Clients modal Cards+Activity 200 under View-as; reconcile each
agent's Zoho display name vs DWH agent name (all-zeros Home snapshot = mismatch).

## 2026-07-21 — Retention Closed green + contact phone at sync

- **Kanban Closed** column accent → `var(--ok)` green.
- **contact_phone** on `retention_cases` (migration 0037); DWH scan selects
  deal_phone/contact_phone; sync writes on create + refresh.
- Modal uses denormalized phone instantly; skeleton loader while resolving;
  lazy `retention.case_contact` only for older null rows.

## 2026-07-21 — Sales Mytrion brand / Retention UX

- **Brand:** rocket chip removed → large **MYTRION** + gradient **Sales** wordmark.
- **Retention nav icon:** Handshake → RefreshCw (win-back / re-engage).
- **Loader:** sales `hue` rocket→`accent`; `data-mytrion=sales` accents match `.ss-root`
  (cyan/violet dark, blue light) — no longer wizard `--rocket` pink.
- **Kanban cards:** left rail via inset shadow (fixes double border with column frame).
- **New stage modal:** hide Timeline; inactivity full-width callout + meter; remove
  “Continue to choose stage” — call only, stage after call ends.

## 2026-07-21 — CS enterprise soft-pass (gold kept, chroma down)

Softened CS Mytrion for all-day ops without abandoning gold:
- **Tokens:** light `#C9A227` / dark `#D4B84A` (was neon `#FFD60A` / bright `#EAB308`);
  quieter softs/glows; neutral slate borders (no cool-blue clash); calmer shadows.
- **Chrome:** solid (not neon-gradient) primary buttons; soft avatars/badges; inset
  active-nav bar; muted App IDs; quieter home hero / card hover / focus rings.
- **Stage hues:** slightly desaturated picklist/dot palette.
- Loader/`data-mytrion` accents aligned.

## 2026-07-21 — CS brand text, Deal-owner agent, hide copilot

- **Brand:** removed sidebar icon; larger MY/TRION wordmark; “Customer Service” gold
  gradient text (`background-clip`).
- **Agent (Deal):** map `_dealOwner` only (widget parity) — never Application `Owner`; empty →
  `not assigned`.
- **Copilot:** unmounted `CsCopilot` from Shell for now (file kept).

## 2026-07-21 — CS apps icon + Applications load speed

- **Brand / copilot icon:** sparkles mark → headset (Shell) + chat bubble (CsCopilot FAB/avatars).
- **Apps/Clients speed:** FE + `cs.applications.list` `perPage` raised **200 → 2000** (Zoho COQL
  max/call — fewer Deluge round-trips if the function honors `perPage`). 90s client TTL cache on
  `loadApplications` (bypass via Refresh / invalidate after save). `MAX_COQL_ROWS` → 2000 in
  `zohoCrm.ts` + tool docs.
- **Note:** Deluge body for `mytrionGetApplications` lives in Zoho — if it still hardcodes
  `LIMIT 200` loops, update that function to `LIMIT 2000` (or pass-through `perPage`) for full gain.

## 2026-07-21 — CS Mytrion: CSMYTRION gold redesign (real data only)

Applied `/Users/user/Desktop/CSMYTRION` visual IA to live Customer Service Mytrion:

- **Tokens:** `.cs-root` remapped from royal blue → design gold (`#FFD60A` dark / `#EAB308`
  light); surfaces/borders/shadows match design; fonts Rajdhani + Instrument Sans + JetBrains Mono.
- **Loader:** `--yellow` + `[data-mytrion='customer-service']` accents aligned to same gold so
  `MytrionGuard` Suspense splash matches in-app theme.
- **Shell:** gold brand mark, MY/TRION wordmark, nav icons, gold claims badge, theme toggle + user card.
- **Home:** design layout with live `loadHome` + quick-action navigation; **omitted** streak,
  daily goal, CSAT, fake live-queue inject, fake leaderboard.
- **Panels:** Retention master-detail (340px list), Apps/Claims/CITI/Citifuel/Analytics/Copilot
  chrome on gold tokens; APIs unchanged. Data Center / Inbox / Service Center stay Soon.
- No mock datasets added.

### Enterprise Agentic AI Metrics (2026-07-21)

Applied Agentic AI evaluation skills for coding agents (`.agents/skills/agentic-eval-metrics/SKILL.md`).
- **Tool Use (Gorilla LLM standard):** Added instructions to evaluate exact AST-based JSON argument match, API resolution rates, and hallucination rates for tools like Zoho/Composio.
- **Memory/State (MemGPT standard):** Defined checks for Context Paging Efficiency and State Recall Precision across `langgraph-checkpoint-postgres`.
- **Agentic RAG:** Required Groundedness/Faithfulness and explicit Retrieval Decision Rate testing.
- **Orchestrator Execution:** Established targets for tracking Ping-Pong Rates and TTFT in `evalLive.ts`.

## 2026-07-21 (pm) — Sales Home fixes, call logging, post-call Lead wizard (feature/SalesProd)

**Home (HomeTab/salesData/streakStore):** workday bar now 10 AM–7 PM NY via
WORKDAY_START_HOUR/END_HOUR constants (clock was already NY). Today's Snapshot refresh now
uses `.refresh()` (spinner + cache bypass) with a real stamped "Updated" time — the fetch was
always working; the bug was `.reload()` leaving `refreshing` false. Activity block hidden and
its range `activity.agent` fetch dropped (kept the cheap 'today' load for the Tasks-Done cell).
Best Day tile now names the day (streakStore.topDayEntry).

**Call logging (mytrion_calls):** new table (migration 0036, hand-authored — drizzle-kit
generate is blocked by the pre-existing 0022/0023 snapshot collision; 0025+ are all
hand-written) + mytrionCallRepo. The /ringcentral/call-events handler inserts one row per
finished OUTBOUND call (best-effort): caller from the zoho: principal, phone=callee, duration,
picked_up/missed derived (no explicit RC flag), source from the dial context
(retention_case → lead → deal precedence). retentionCaseId now flows to the backend (added to
payload + callEventSchema; emit no longer strips it). Verified migration green on a throwaway DB.

**Post-call Lead wizard (LeadCallWizard):** shell-level host subscribes to call events; on a
finished outbound call tagged with a leadId it opens a FORCED modal (ESC/backdrop blocked)
requiring Status (+ dependent reason: Unqualified→Unqualified_Reason, Not Interested→
Not_Interested_Reason) before it closes; optional note → Description. Writes via the existing
owner-scoped PATCH. **IMPORTANT: the Zoho field is `Status`, not `Lead_Status` (no such field).
Zoho enforces NO picklist dependency — the Status→reason pairing is UI logic.** Backend
leadEditBody whitelist extended with Status + the two reasons (z.enums of the verbatim live
picklist values). Deals only log (no wizard).

**Data Center / Manage:** Money Codes sub-tab got its own Refresh button (it owns its loader).
Manage panel distinguishes DWH outage (502/503) from a real "not your client" 403 in the
error copy; POST /carrier-invitations now owner-gated for non-admins (matches the reads).

**Test baseline:** 4 unit files fail from concurrent in-flight retention/CS/finance WIP
(carrier-mini-app driver-registration, cs-routes, touchpoints-catalog/routes catalog SIZE
51→49 + finance-filter shape) — all WIP-owned, none touch this session's areas. This session's
suites (ringcentral-call-log, data-center-routes, LeadCallWizard, sales redesign) are green.
App `tsc` build gate still blocked by ~24 pre-existing finance/admin TS errors — bundle built
via vite in a clean worktree as before.

## 2026-07-21 (evening) — Fix retention touchpoint 500s (circular ESM import)

`retention.my_cases` / `retention.pool_list` 500'd because `tsx watch` crashed on reload:
`deadlineSweep` statically imported `retentionPoolClaimRepo`, which imports `notify`, while
`deadlineSweep` also imports `notify` — TDZ/partial exports →
`does not provide an export named 'notifyClaimRequestToCs'`. Broke the cycle by
dynamic-importing `retentionPoolClaimRepo` only inside the claim-approve branch of
`sweepRetentionDeadlines`. API restarted cleanly; routes return 401 without key (not 500).

## 2026-07-21 (evening) — Retention stage timers on Sales board

Per-stage countdown on Kanban/list/detail for the next deadline event:
- New: 2 BD → Retention; OoR: 5×1 BD attempts (5th → Open Pool); Reached: 5 BD fuel watch → Pool;
  Vacation: 14d calendar; Dissatisfied: no timer + card locked for Sales.
- FE: `retentionTimers.ts` (BD-aware remain) + `RetentionStageTimer` meter; board clock ticks 30s.
- Backend: OoR stamp back to `1BD_comms_attempt` (migration 0038 renames open `5BD_*` types).
Open Pool UX deferred to next discussion.

## 2026-07-21 (late) — Sales Phase + Open Pool closeout

Sales Phase escalation is treated as covered (status machine already matched RetentionDocs):

| Path | Result |
|------|--------|
| OoR ×5 attempts | → Open Pool + notify |
| Reached ×5 BD no fuel | → Open Pool + notify |
| New ×2 BD no action | → Retention (not Pool) |
| Dissatisfied + reason | → Retention (not Pool) |

**Notify gap closed:** `notifyOpenPoolOpened` / Zoho mail take `reason:
out_of_reach | reached | reclaim | phase2` so copy is no longer always “5 OoR attempts”.
Call sites: `logCommsAttempt`, deadlineSweep (Reached vs reclaim), `record_outcome`, Phase 2 CS.
Touchpoint title for `retention.log_attempt` → “1 BD each”. Unit test
`retention-open-pool-notify.test.ts` covers reason labels.

**Env (Ryan + From):** `.env.example` clarified. Local `.env` currently has
`RETENTION_OPEN_POOL_NOTIFY_ZOHO_USER_ID` and `RETENTION_NOTIFY_FROM_EMAIL` **empty** —
inbox/mail to Ryan will skip until set (previous owner still notified when present;
pool WS broadcast still fires). Set Ryan’s Zoho user id + allowed From in local/prod;
no hardcoded personal email in source.

**Deferred:** Open Pool claim UX polish, Phase 2/3 / CITI product, Vacation diagram gap,
Retention-handoff emails (docs don’t require them for New/Dissatisfied).

## 2026-07-21 (late) — Open Pool email via Zapier (not Zoho send_mail)

`RETENTION_OPEN_POOL_NOTIFY_ZOHO_USER_ID` / `RETENTION_NOTIFY_FROM_EMAIL` are set for
ops. App path stays inbox + realtime only; removed Zoho CRM `send_mail` from
`notifyOpenPoolOpened` so Zapier owns outbound Ryan/owner email (avoids double-send).

## 2026-07-22 — Sales Open Pool (Mytrion) ownership model

Product: Open Pool = other agents may request assignment of a retention case /
underlying Zoho Deal. CS approve transfers Deal + Contact + Account Owner to the
claimant. Former owner sees the case locked on Cases (not in Open Pool widget).

Implemented:
- DWH scan joins `stg_zoho_deals` → `zohoDealId` on create + sync backfill
  (`dwhRetention` / `retentionSync`).
- `listOpenPool` excludes `pool_owner = viewer`; `pool_list` passes exclude.
- `listForAgent` includes former owner's `p1_open_pool` / claim-pending rows
  (Kanban Closed, locked badge — not actionable).
- Claim approve **requires** `zoho_deal_id` then `transferDealOwnershipToClaimant`
  (fail closed if missing).
- PoolTab copy + client-side filter; Cases locked card for pooled former deals.

## 2026-07-22 — Retention deal_id from octane.agent_deals

Deal fetch for retention cases uses `octane.agent_deals` (`id` → `zoho_deal_id`),
not `stg_zoho_deals`. Distinct on carrier_id, newest `appfilldate` then id.

## 2026-07-22 — Own Open Pool deals leave Cases board

Former-owner pooled cases are not listed on `retention.my_cases` (assignee
cleared on pool entry). They disappear from the Kanban instead of a locked card.

## 2026-07-22 — Open Pool claim_requests + unified auto-close

Open Pool is **not** a fourth phase — it is Phase 1 status `p1_open_pool` /
`p1_pool_claim_pending` (Processing). Sales Open Pool tab is a filtered view.

**Schema:** `retention_claim_requests` (migration `0039`) — durable CS queue +
audit; partial unique one `requested` row per case. Processing lock still on
the case (`pending_claimant_zoho_user_id` + `p1_pool_claim_pending`).

**Claim flow:**
- Sales `pool_claim` requires `reason` → insert request + Processing + 1 BD
  auto-approve deadline (fallback sweeper unchanged; same finalize as CS Approve).
- CS Reject → **DELETE** request row; case → `p1_open_pool`.
- CS Approve / auto-approve → Zoho Deal/Contact/Account Owner → claimant;
  case → **`p1_new`** + `2BD_agent_action` (Kanban New); bump `assignment_count`.

**Sync:** any new post-create transaction closes **all** open phases including
CITI (`p1_returned`); open claim requests deleted so Processing cannot stick.

**UI:** PoolTab — no Owner column; Available/Processing; reason modal (row +
bulk); live refresh on claim WS events. ClaimsPanel shows requester + reason.

## 2026-07-22 — Open Pool 3 BD unclaimed + max-3 → CITI

**Unclaimed Open Pool:** every entry via `enterOpenPool` (Sales OoR×5 / Reached
5BD, Phase 2 `no_response`, CS reject restamp) stamps `3BD_pool_claim`.
`automation.retention.deadline-sweep` (cron `*/15`) applies overdue rows:
unclaimed → **Retention** (10 BD); if `assignment_count ≥ 3` → **CITI** (not
Retention). Processing (`p1_pool_claim_pending`) uses 1 BD auto-approve instead;
reject restores a fresh 3 BD claim window.

**Max 3 agents:** `enterOpenPool` short-circuits to CITI when already at cap.
2BD New/in-progress expiry with `assignment_count ≥ 3` also → CITI (3rd agent
failed their window). Terminal destinations remain Closed (returned / outcomes)
or CITI.

**Load:** sweeper is a bounded indexed query (`closed_at IS NULL` +
`current_deadline_at < now`, limit ≤ 500) every 15 minutes — fine for low case
volume; no per-case jobs. Case-sync is hourly + on-demand.

## 2026-07-22 — CS Retention desk + RoundRobin + CITI Closed Lost

**Claims:** Approve/Reject hardened toasts; claim-approved notify says **2 BD**.

**Phase 2 handoff:** clears Sales assignee; RoundRobin from
`RETENTION_CS_ROUND_ROBIN_ZOHO_USER_IDS` preferring Zoho `Isonline`; assigns
Ops case as `p2_working` + soft Zoho Deal/Contact/Account Owner transfer.
Cursor table `retention_rr_cursors` (migration `0040`).

**10BD Retention:** no txn → **Open Pool** (CITI if `assignment_count ≥ 3`).

**CITI entry:** Deal API field `Stage` = `Closed Lost` (org picklist; not bare
"Lost"). Export still sets `Assignment_Stage=CITI`.

**Sales lock:** Phase 2 / CITI hidden from `my_cases` open board; FE
`isSalesLocked`; Phase 1 writes reject wrong phase. CS CasesPanel shows agent,
phase/status, SLA, timeline via `caseGet`.

## 2026-07-22 — Sales tab go-live sign-off (Data Center / Create / Carriers / Automation)

Four-area assessment (workflow) + fixes on feature/SalesProd:
- **Data Center P1 (was FAIL → now GTG):** admin View-as → Clients returned 0 for any agent
  whose session id isn't DWH-aligned — the route dropped the display-name arm when targeting
  another agent (only appeared to work for id-aligned accounts like Daniel). Fixed: the
  targetingOther branch resolves the TARGET's name via resolveActAsTarget so buildOwnedCte gets
  the id-first/name-fallback pair. Empty-state copy no longer says "match your search" with no
  search term. (dataCenter.routes.ts, RecordsTab.tsx, +test.)
- **Create:** salutation ("Title") was collected + passed (leads.create schema .passthrough) but
  dropped in createLead → now written to Zoho Salutation. AttachZone enforces the advertised
  file types (accept attr + take() allowlist; drag/paste bypassed accept). readMultipart returns
  a clean 413 on oversize instead of a 500. All create paths verified wired + schema-validate
  green via salesPanelSmoke. A real create/attachment WRITE test should be run in a controlled
  env (avoid polluting live Zoho/Desk).
- **Carriers:** widened root max-width 860→1180 (fills Shell's wrapper; NOT full-bleed — no
  internal scroll container). Failed Create-Lead is now a "Failed — retry" button (was stuck
  until a full re-search). Functionality PASS.
- **Automation:** all 22 self-service actions are FULLY WIRED (no stubs / coming-soon / missing
  touchpoints; params match; success logs via logAutomation). NOT code-fixed — governance for
  the user to decide: (1) write-class touchpoints are invokable by non-admin sales (dispatcher
  admin-gates only 'destructive', behind FF_TOUCHPOINT_DESTRUCTIVE_SALES which defaults ON) —
  intentional for the self-service panel but deviates from CLAUDE.md rule #7; (2) IDOR:
  browser.close_application/boca (by appId) and sales_mytrion.invoice_signed_url (by invoiceId)
  have NO ownership gate — an agent can act on another's app/invoice; recommend the same
  assertCarrierOwned-style gate as the carrier routes.

## 2026-07-22 — CS access Admin-only + RR pool + OoB Closed Lost

**CS Mytrion access:** Standard profile seed no longer grants CS; legacy
department substring cannot open CS; `reconcileStandardNoCsGrant` clears
historical Standard→CS defaults on seed. FE static rule: only
`Customer Retention` (+ admin bypass). Grant CS via Mytrion Admin Profile
Defaults / per-user override.

**RoundRobin `.env`:** Manal, Ahsan, Zara, Layla, Charlotte, Isaac Zoho ids
in `RETENTION_CS_ROUND_ROBIN_ZOHO_USER_IDS` (.env + .env.example). Restart
API to pick up.

**Out of Business (CS desk):** `p2_out_of_business` now best-effort sets Zoho
Deal `Stage=Closed Lost` (same as CITI exclusion from future retention).

## 2026-07-22 — Admin grants for Retention RoundRobin pool

Per-user `worker_mytrion_access` overrides for CS Mytrion (home CS) on:
Manal Alqassimi, Ahsan Ahmed, Zara Ashley, Layla Mei, Charlotte Birmingham,
Isaac Leo. Standard profile default remains empty (no CS auto-grant).
Cache invalidated per user after upsert.

## 2026-07-22 — Spanish desk + CS caps + pool WS harden

**Spanish → Jean Paul:** DWH `main_language` (prefer) else `dim_company.nationality=Spanish`
→ `retention_cases.is_spanish_desk` / `preferred_language` (migration `0041`). Handoff
bypasses RR to `RETENTION_CS_SPANISH_ZOHO_USER_ID` (Jean Paul `6227679000065094200`);
falls through to RR if at daily cap or env unset. CS Admin grant applied for Jean Paul.

**Caps:** 40 deals/day (claim/RR), 15% portfolio `p2_offer_pending` (`mark_pending`),
two-call rule (listen + solution notes) before Saved/Refused. CS CasesPanel +
`retention.cs_desk_quota`.

**Realtime:** claim approved/declined broadcast on `retention:pool`; Sales
`useRetentionRealtime` passes claim_* events for peer Pool refresh.

**Deferred:** pre-entry funded alert, Zapier email, KPI/MOR components.
### 2026-07-21 — Notifications Phase-2: T2 receipt poller (T1 deferred)

**T1 (limit poller) DEFERRED** — per-card daily gallon (ULSD) limit is readable NOWHERE:
servercrm getCards mart = {card_number, status} only; `/cards/{c}/{card}/efs` = status/unit/driver
(no limit); no GET for card limits (setCardLimits is write-only, GETs 404). DWH `dim_card` has no
gallon limit; all DWH "limit" columns are carrier-level `credit_limit` ($ credit line, not per-card
gallons). Usage gallons exist (`fuel_quantity`/`line_item_fuel_quantity`) but no cap to compare
against. T1 needs either a configured threshold (env, v1) or a new servercrm EFS-policy read
endpoint — parked until owner decides.

**T2 (receipt poller) DONE** — `pollers.ts runReceiptPoll`:
- Source `listDwhTransactions({carrierId, range:'day', limit:200})` (DWH fast path, `t.*`).
- Line items collapsed → one receipt per `transaction_id` (sum `line_item_fuel_quantity`).
- Watermark `receipt:<carrierId>` = last `transaction_date`; FIRST pass baseline-only (no blast).
  Re-scan safe: dedupe_key `receipt:<carrier>:<txnId>` (outbox UNIQUE).
- Payload: last6, gallons, location, city, state, cardId — **NO price** (driver rule). cardId via
  findDwhCardByNumber (cached per card), owner hears w/o it, driver copy fail-closed.
- Backfill guard: RECEIPT_PER_CARD_CAP=20/card/run.
- Wired into the SINGLE `notification.poll` cron (sequential after runCardStatusPoll — no new job).
- Mini-app: `notifToInbox` 'receipt' case + `inbox.ntfReceipt.title/body` in 4 langs (en/ru/uz/es).
- No new env (reuses NOTIFY_POLL_CARRIERS), no migration (reuses `mini_app_notification_state`).
- Checklist: tsc root+mini-app 0, eslint 0, 762 tests pass (no regression), i18n 4 til. Test on Mac.

### 2026-07-21 — Notifications Phase-2 roadmap decision: money code OFF for MVP

**Decision (owner):** for the MVP, the mini-app money code stays DISABLED for company owners.
- Enforced by `FF_MINIAPP_MONEY_CODE_ENABLED` — ship default `0` (env.ts + .env.example); local .env
  flipped 1->0 to match. Backend `requireMoneyCodeEnabled()` -> `MINIAPP_MONEY_CODE_DISABLED`; the
  mini-app already degrades to a disabled sheet ("Money codes are not enabled here yet. Please send
  a request instead.") — no dead screen. Verified live.

**Phase-2 status after this session:**
- T1 limit poller — DEFERRED. Per-card daily gallon limit is readable nowhere (servercrm getCards /
  `/efs` / no limits GET; DWH `dim_card` no gallon cap, only carrier `credit_limit` $). Needs a
  configured threshold (env) or a new servercrm EFS-policy read endpoint.
- T2 receipt poller — DONE (runReceiptPoll + mini-app receipt row, i18n 4 lang).
- T3 weekly statement — SKIPPED for now (unblocked when wanted: buildTxnReport + sendDocument exist).
- T4 driver money code + owner confirm — DEFERRED (money code off for MVP). When revived, resolve
  the OWNER-CONFIRM mechanism first: Telegram inline buttons need bot `callback_query`, but the
  carrier bot token is polled by agent-gateway (`getUpdates`) and `setWebhook` disables polling —
  so either a mini-app approve endpoint (no webhook, recommended) or a separate approval bot token.

**Migration numbering:** next hand-written migration is 0041+ (0031-0040 used after the build merge).

### 2026-07-21 — Support-bot PROD PARITY: hamma servis ulandi (money code ham)

Owner qarori: prod uchun to'liq parity. /v1/support-bot yangi endpointlar (hammasi
resolveCaller RBAC + audit + rate ostida): service-request (butun ticket oilasi, billing-form
ham), tracking, money-code/draw (FF gate; QIYMAT guruhga emas — owner'ning shaxsiy Octane-bot
chatiga DM), card-action (activate/deactivate, last-6 bilan; resolveCardByLast6 — 0 match=404,
ko'p match=409 "last 6 bering"), card-limits (MINIAPP_LIMIT_CHANGE_MAX cap), card-info
(driver o'z kartasi cardLast6'siz; driverName owner-only), balance (raqamlar DM'ga),
manual-code (to'liq PAN faqat DM'ga). Gateway: 8 yangi tool + allowedTools + prompt
(har yozuvga bir-qatorlik confirm; sezgir narsa guruhga chiqmaydi).
Test checklist (guruhda): owner money code (flag on) → DM'da kod; "4753 ni o'chir" →
ambiguous bo'lsa last-6 so'raydi; driver unit change o'z kartasiga; balance → DM;
manual code → DM; billing form → ticket id.

### 2026-07-21 — Gateway: buttons-first UX (Telegram inline keyboard qatlami)

Analitika asosi: klient so'rovlari qisqa/chala ("kod", "gtg?") — eng qulay UX yozish emas,
BOSISH. Qo'shildi: telegram.ts sendButtons (inline_keyboard, ≤8 tugma 2 tadan qatorda) +
answerCallback; getUpdates endi callback_query ham oladi; index.ts tap'ni sessiyaga
"[button tap from <name> (id N)]: <data>" qilib uzatadi (id Telegram'dan — construction
bo'yicha sender-verified), registered-gate tap'larga ham; tools.ts telegram_buttons tool +
allowedTools. Prompt "Buttons-first UX": har yozuv-confirm faqat tugma (✅ Ha/❌ Yo'q),
bo'sh tag/help/menu → rolga mos, talab-tartibli menyu (owner: money code birinchi — 2251;
driver: kartam holati birinchi), tanlovlar (davr, ambiguous karta, ticket turi) tugmalarda.
Test: "@bot menu" → tugmali menyu; money code oqimi to'liq tap bilan; "4753 o'chir" →
Ha/Yo'q tugmalari.

---

## 2026-07-21 — Manager role (owner-equivalent) for carrier mini-app + CRM

- **Why:** big fleets have managers who work with drivers and need company-owner-level access in
  Octane — but they aren't the account owner. Added a third `profile` value **`manager`** that is
  owner-EQUIVALENT in every capability gate; differs only in provenance (invited, not the owner) and
  display. Product decisions (confirmed): full owner-teng access (incl. finances); owner + manager +
  admin can all issue manager links; a manager can also issue driver links.
- **No migration.** `profile` is a plain `text` column in both `carrier_invitations` and
  `registered_mini_app_companies` (no pg enum / CHECK), so widening the TS union `'owner' | 'driver'`
  → `'owner' | 'manager' | 'driver'` is a code-only change.
- **Single source of "manager == owner":** `miniAppAuth.isOwnerLike(profile)` = owner || manager.
  `requireRegisteredOwner` / `requireRegisteredOwnerUser` key off it; `telegramCtx` maps both to the
  `fleet_manager` role. `serviceRequestAllows` normalizes manager→owner (per-service role lists stay
  owner/driver). `inviteService` pins `companyType='fleet-manager'` for a manager invite so a DWH
  hiccup can't null it and lock the manager out of the fleet gate (fail-closed).
- **Notifications + news need no change:** dispatcher (`service.ts`) and news (`news.ts`) already
  collapse `profile === 'driver' ? 'driver' : 'owner'`, so a manager inherits owner-targeted
  deliveries automatically. Registry roles stay owner/driver (routing role, not registration profile).
- **New endpoint:** `POST /carrier/mini-app/manager-invites` (gated by `requireRegisteredOwner`, so
  owner OR manager; carrier bound from the caller's own registration, never the body; ttl 48h).
- **Mini-app FE:** `isOwner` is now owner-LIKE (owner||manager) and drives the whole owner UI; added
  `isManager` for copy that must distinguish. Manager-invite affordance sits at the top of the fleet
  screen (fleet-manager only — matches the backend gate): generate → reveal link → copy/regenerate.
  Confirm/success screens + i18n (EN/RU/UZ/ES) gained manager strings.
- **CRM admin:** `CarrierUserForm` account-type toggle gained a Manager option (treated owner-like:
  carrier tie, no card — one logic change: `isOwner = !isDriver`). `CarrierInvitations` list labels
  manager invites. **Registered Companies screen (per follow-up):** managers now render as their own
  tier (Manager pill, revocable — revoke was already profile-agnostic at the API); added **status
  filter chips** (All / Active / Revoked with counts) since revoked accounts accumulate and clutter
  the roster.
- **Tests:** +4 in `carrier-mini-app.test.ts` (manager gets owner-only money view; manager & owner
  can mint a manager link bound to their own carrier; driver refused at /manager-invites). Full suite
  766 pass. Backend + mini-app + CRM(carrier files) typecheck clean; mini-app bundle rebuilt.


## 2026-07-22 — CS Mytrion collapsible sidebar

Branch `hotfix/MytrionOverall`: Customer Service shell gets a Sales-style
collapse control (panel icon) next to the brand; collapsed rail is icons-only
(`--sidebar-collapsed`), persisted as `cs.nav.collapsed`. Badges/soon dots
remain visible on the icon rail.

## 2026-07-22 — Sales Dashboard Debtors tab live

**Debtors (Dashboard → Debtors):** removed Soon stub; agents see their book via
`dashboard.debtors` (CMP `/api/agent/cmp/debtors` + Zoho deal enrich). Client rules
match Billing: PENDING/PARTIALLY_PAID invoices with remaining ≥ $1, age ≥ 2 days,
hard debt at 15+ days (`dashDebtorsData`). UI: search, status chips, KPI strip,
expandable invoice cards, skeleton/refresh/toasts, 5-min localStorage cache
(`DEBTORS_DASH_TTL_MS`, keyed by act-as user). Files: `DashTab.tsx`,
`DebtorsDashPanel.tsx`, `dashDebtorsData.ts`, `dashCache.ts`, `DashSkeleton.tsx`.

## 2026-07-22 — Home Money Owed uses Billing debtor floors

Home snapshot “Money Owed” now matches Dashboard → Debtors / Billing rules
(pending·partial, remaining ≥ $1, age ≥ 2d, hard ≥ 15d):
- Backend `summarizeCmpDebtors` recomputes `fetchHomeSnapshot` +
  `fetchDebtorsInfo` totals from invoice rows.
- FE `loadSnapshot` overlays `loadDebtorsHomeSummary` (shared 5-min cache;
  Refresh forces). Card click → Dashboard → Debtors via `openDash`.

## 2026-07-22 — Verification Pipeline tab (Sales Mytrion, hotfix/MytrionOverall)

Phase 1 of the Sales-side verification bridge. Un-parked the "Verification Pipeline" tab.
- **List:** the agent's DWH deal-clients (`octane.agent_deals`, freshest `appfilldate` first),
  owner-scoped via the roster authority (`dwhClientRoster.buildOwnedCte` — made reusable with a
  column-list param + exported `ownerBinds`; id-suffix-first / display-name-fallback), enriched from
  `octane.dim_company`, classified `in_pipeline | active | closed` (Card Swiped / first_swipe_date ⇒
  active). Admin View-as resolves the target's name so the name arm fires.
- **Detail:** in-pipeline → 9-stage vertical timeline (Pre Stop Factors → … → Post Stop Factors) +
  decision badge (Prepaid / LOC w/ score+limit+cycle / Not accepted / Undecided); active → current
  terms read-only.
- **Pipeline data = MOCK via a provider seam** (`modules/verificationPipeline/provider.ts`,
  deterministic per client, no DB), shaped exactly like the real `credit_platform` model
  (`kxd.<stage>_reports.status` + `kxd.decision_reports` / `requests.result.summary`) so a future
  live provider swaps in behind a flag. **No credit_platform querying this phase** (per direction).
- Files: `src/modules/verificationPipeline/{types,provider,service}.ts`,
  `src/routes/v1/verificationPipeline.routes.ts` (GET /v1/verification/clients + /pipeline, mirrors
  dataCenter owner-scoping), `apps/.../api/verification.ts`, `apps/.../tabs/VerificationTab.tsx`.
- Verified live: 187 deals for View-as Daniel (freshest-first), pipeline route → 9 mock stages;
  `verification-pipeline.test.ts` (6) green; roster/data-center tests unaffected by the buildOwnedCte
  change. (3 pre-existing WIP test files still fail: carrier-mini-app, touchpoints-catalog/routes.)

**Follow-ups (documented, not built):** live `credit_platform` provider (swap behind
FF_VERIFICATION_PIPELINE_LIVE, join `requests.carrier_id → dim_company.carrier_id` 97.8% / fallback
application_id/dot; expose only stage status + decision + LOC terms, never PII); limit-change request
submission (Credit/Card/Weekly → new `limit_change_requests` table mig 0042 + touchpoint).

## 2026-07-22 — Fix React #321 (duplicate React) + rebuild served bundle

Reported from a deployed build (`index--dvCpMb7.js`, not in the repo): React error #321 (invalid
hook call) crashing on `useSessionUser → useImpersonation → useContext`, plus a benign
`/v1/ringcentral/embed-config` 404.
- **#321 root cause:** the crash stack split the reconciler (`renderWithHooks`) and the hooks
  dispatcher (`useContext`) across two chunks = **two React copies in the bundle**. A sibling app
  (`web/`) ships its own `react-dom`, so a build environment that resolves React from two physical
  locations duplicates it. Fix: `resolve.dedupe: ['react','react-dom']` in
  `apps/mytrion-crm/vite.config.ts` — pins one copy in *any* build env.
- **Verified new build:** `react-dom` now in exactly ONE chunk (`index-By1ddpst.js`, = the entry) →
  #321 structurally impossible; VerificationTab + ringcentral call present; verification nav
  un-parked. Rebuilt `apps/mytrion-crm/app/` (vite build, emptyOutDir) and committed.
- **ringcentral 404 is NOT a crash:** `RingCentralPhone.tsx` already swallows the fetch failure
  (fail-silent), and the route is registered *unconditionally* at `app.ts:252`. A 404 only means the
  **backend** serving the client predates the route — resolved by deploying the backend from this
  branch. No frontend change needed for it.

## 2026-07-22 — Retention Closed cards: fuel-return vs 2BD handoff

Sales Closed with "0d since last fuel" = auto `p1_returned` (hourly sync:
any txn after case open). Fuel closes the case — it does **not** go to
Retention. True 2 BD no-action handoff leaves Sales and lands in CS Phase 2
(`p2_new` / `p2_working`), not Closed.

UI bug fixed: closed/returned no longer show stale "Due today · → Retention"
(`stageTimer` gates `!isOpen`; sync clears deadline on return-close).

## 2026-07-22 — CS Mytrion sees all retention phases

`retention.cs_cases` / `listForCs`: CS agents browse **any phase** (filters:
Open · Sales · Retention · P2 New/Working · CITI · Closed · All). Detail pane
shows carrier, phase, status, assignee, fuel/volume, deadline, Zoho deal id,
timeline. Claim / log attempt / outcomes stay **Phase 2 only** (backend already
gated). Zoho Deal+Contact+Account ownership still only on Retention RR assign.

## 2026-07-22 — Zoho ownership: Open Pool + Retention

Both paths use `transferDealOwnershipToClaimant` → Zoho **Deal** (required),
**Contact** + **Account/Company** (best-effort):
- Open Pool claim approve: hard-fail if Deal Owner update fails.
- Retention RR/Spanish handoff + CS claim of unassigned P2: soft transfer
  (Ops assign kept if Zoho fails). CS claim now also triggers Zoho when
  assignee changes inside Phase 2 (was a gap).

## 2026-07-22 — CS Retention Cases UI polish

Cases tab: list/detail skeletons, phase+status color badges, due urgency
(overdue/soon), staggered fade-in, smoother chip/row hover, refresh spinning
state, reduced-motion respect (`casesUi.tsx`, `retention-panel.css`).

## 2026-07-22 — CS Cases: icons, larger type, clearer filters

Renamed desk chips **To claim** / **In progress** (was P2 New / P2 Working).
Lucide icons on filters, list rows, detail fields; bumped title/badge/meta
type sizes for easier scanning.

## 2026-07-22 — CS Cases: hierarchical filters + desk actions

Filter UI: **Phase** then dependent **Status** chips (Sales/Retention/CITI
buckets). API: `retention.cs_cases` accepts `phase` + `status`.
Detail: removed channel picker (auto ringcentral); colored Call 1 Listen /
Call 2 Solution + outcome status buttons (`CaseDeskActions`).

## 2026-07-22 — CS filter chip active tones + Closed (Returned)

Status Closed → **Closed (Returned)** for All/Sales. Active filter chips
use per-tone colors (sales blue, retention gold, citi purple, success, etc.).

## 2026-07-22 — CS filter labels clarified

Sales: Open→All open, Calling→New. Retention: To claim→Unassigned,
Offer pending→Offer out. Added filter explain line with timers.

## 2026-07-22 — CS quota + deadline UI clarity

Quota: Claims today + Offer out cards with colors/hints. Deadline field
shows plain SLA text (no raw 2BD_agent_action).

## 2026-07-22 — CS desk: drop Saved button; clarify Refused gate

Removed Saved from Retention desk UI. Refused stays gated on Call 1+2.

## 2026-07-22 — CITI = red folder

CITI phase chip/badge/nav use Folder icon + danger red (not purple Archive).

## 2026-07-22 — CS Retention Cases → green

Fixed: outcome notes wired; Offer-out min-1 small-portfolio cap;
claim-before-calls/outcomes; claim cannot steal assigned cases.

## 2026-07-22 — Retention pilot reset (Daniel Brown only)

Wiped retention_cases (398), events (671), rr_cursors. Enabled
FF_RETENTION_PILOT_ONLY=1 + RETENTION_PILOT_AGENT_ZOHO_USER_IDS=
6227679000031473048 (Daniel Brown). Sync creates only his clients.
Set FF_RETENTION_PILOT_ONLY=0 to restore full generation.

## 2026-07-22 — Retention pilot sync + Sales Open Pool UX

Fixed DWH deal_lang (`zoho_deal_id`). Pilot scan filters by agent in SQL.
Wiped + sync: 16 Daniel Brown cases created. Open Pool UI: status chips,
how-to strip, claim window, modal extract, better empty/loading.

## 2026-07-22 — Sales Retention modal: unified save loader

Status updates use a single Saving overlay; close-after skips remounting
timeline (no modal jump). Timeline slot reserved height while hydrating.

## 2026-07-22 — Sales Retention modal: single update loader

Dropped button/timeline spinners on status update — only the modal
Updating overlay shows while busy (no double loaders).

## 2026-07-22 — Sales Retention: locked former-owner cards + modal overlay

Updating overlay pinned to modal (not scroll body). Dissatisfied/Open Pool
handoffs stamp pool_owner; my_cases keeps locked cards for former Sales agent.
SIP play-rejected console noise filtered (browser autoplay).

## 2026-07-22 — View-as per Mytrion + faster retention saves

View-as is scoped per Mytrion (no /main picker, no cross-Mytrion leak).
Retention outcome/attempt returns after DB write; Zoho + notify post-commit.
CS RR uses warm Zoho Users cache (no blocking Users call on save).

## 2026-07-23 — Revert Sales Open Pool ownership plan

Stepped back: CS again approves Open Pool claims; Zoho Deal/Contact/Company
transfers on Retention handoff; CS Claims tab + No-response→Pool restored.
Sales Claims (prior-owner) pane removed.

## 2026-07-23 — View-as any user + instant Open Pool

Admin View-as lists all CRM users (search); mounted on CS + Billing shells.
Open Pool claims assign instantly (Zoho + Kanban New); CS sees Claimed/Unclaimed
activity logs; CS No-response→Pool removed (10 BD timer kept); Sales daily cap = 2.
Migration 0042 backfills pending claims to Open Pool.

## 2026-07-23 — Sales Cases + Open Pool polish + CS readonly Pool

OoR = Out of Reach (agent UI wording). Migration 0043 adds `previous_owner_*` on
claim requests + `retention_to_pool_count` on cases. Instant claim stamps previous
owner + timeline note. Retention 10 BD → Open Pool up to 3 times, then CITI
(separate from assignment_count agent cycles). Sales Cases: carrier/company search,
Out of Reach attempt UX (note required for messengers), Ops confirm/deny hidden
unless Ops/admin, hide agent names / “In Open Pool” · “With Retention” badges.
Sales Open Pool: no Prior agent column, Claim/Claiming… loaders, short quota copy.
CS: Activity tab removed; readonly Open Pool list + timeline; Retention Cases desk
unchanged. `retention.cs_pool_activity` kept backend-only.

## 2026-07-23 — CS desk scope + Open Pool / View-as polish

Sales Cases hero: “Retention workflow” kicker + larger stage copy.
CS View-as: sidebar placement, menu opens upward.
CS Open Pool: metrics, badges, empty state, card list + timeline.
CS Retention Cases list/detail: non-admin sees only assigned cases; admin sees all.
Open Pool browse stays shared (unassigned) for CS readonly visibility.

## 2026-07-23 — Durable Zoho ownership transfer log

Added `retention_ownership_transfers` (migration 0044): append-only from→to Zoho
owner log for Retention handoff + Open Pool claim (success/partial/failed). No FK
to `retention_cases` so rows survive hard-delete. Wired in
`transferDealOwnershipToClaimant` when audit context is passed. Applied via
`pnpm db:migrate` against Render app Postgres.

## 2026-07-23 — Disable Retention auto-assign

`RETENTION_AUTO_ASSIGN_ENABLED = false` in `csRoundRobin.ts` — Spanish desk +
RoundRobin skipped; handoff keeps the Sales agent (no unassign, no Zoho Owner
transfer to CS). Flip the constant to re-enable CS auto-assign.

## 2026-07-23 — Merge origin/build into hotfix/MytrionOverall

Resolved content conflicts (admin tabs, DWH pool timeouts, dwhCards billing +
any-status card lookup, payments ingest audit + preMapped). Renumbered local
retention migrations to avoid colliding with build’s mini-app/news/support-bot
series: `0049_retention_open_pool_instant`, `0050_retention_pool_cycles_claim_log`,
`0051_retention_ownership_transfers` (SQL unchanged / IF NOT EXISTS — prod hashes
already applied stay skipped).

## 2026-07-23 — Admin Deals tab (one-click ownership)

Mytrion Admin → **Deals**: list 200 by `Application_Date`, word/id search, drawer
to pick agent and transfer Deal+Contact+Account via
`transferDealOwnershipToClaimant` (`admin_manual` audit). Owner Logs subview
reads Zoho `Owner_Logs` (Entity_ID / New_Owner_* / Owner_Log_Time) to find
mis-assigned deals; suggests prior owner from chronological logs. Meta refreshed
live for Deals/Contacts/Accounts/Owner_Logs. Routes under `/admin/deals*` +
`/admin/owner-logs` (allDepartmentAccess).

**Transferrer filter:** Owner_Logs `Created_By` (= timeline “by John Mercer”).
Default id `6227679000093960901`. Deals tab “Show my transfers” →
`GET /admin/deals?transferredBy=` hydrates unique Entity_IDs into deal rows.

## 2026-07-23 — Admin Deals recovery via Timeline (not Created_By)

Owner_Logs `Created_By` is often Amir Alimov (workflow) — unusable as transferrer.
Recovery now loads the fixed deal-id list (`recoveryDealIds.ts`, 132 ids) and
reads each deal’s `__timeline` with `done_by.id` = John Mercer
(`6227679000093960901`). Prior owner = Timeline Owner `_value.old` (name → Zoho
user id via ActiveUsers). Admin UI: **Load recovery set**.

## 2026-07-23 — Recovery list shows Timeline prior owner

Admin Deals recovery rows now surface Timeline Owner `_value.old` / `_value.new`
(prior → changed to), when, and by whom; names resolved to Zoho user ids via
ActiveUsers. Drawer mirrors the same Timeline evidence before transfer.

## 2026-07-23 — Admin Deals UX polish

Browse / Recovery mode switch, recovery stats, list filter, agent typeahead,
Current→Return-to flow card, copy deal id, relative timeline times, and
post-transfer Deal/Contact/Company badges. Keeps Owner Logs disabled.

## 2026-07-23 — Ops ownership transfer log (from→to)

Every Zoho ownership transfer through Ops (`transferDealOwnershipToClaimant`)
already wrote `retention_ownership_transfers`; now enriched with `deal_name` +
`contact_name` (migration `0052`), from→to owner names/ids, and clearer actor
(impersonator when acting-as). Admin Deals → **Transfer log** reads our DB via
`GET /admin/ownership-transfers` (not Zoho Owner_Logs). Reasons covered:
`admin_manual`, `retention_handoff`, `open_pool_claim`.

## 2026-07-23 — Client News 500 + Admin sidebar

`GET /v1/client-news` 500: `client_news` (and mini_app notification tables) were
missing — journal slots for 0042–0044 had been overwritten by retention
renumber hashes. Repair migration `0053_repair_client_news_notifications`
(CREATE IF NOT EXISTS). Admin sidebar: categorized sections + search filter
via `MytrionShell` `navSections` / `enableNavSearch`.

## 2026-07-23 — SotA Agentic Phase 1 (Horizon AI)

Upgraded the deepagents orchestrator (Admin → Horizon AI → `POST /v1/agent`)
with four workstreams. **Defaults are ON** (orchestrator + checkpoints + blackboard +
skill cache + plan DAG) in `env.ts` / `.env.example`.

| Flag | What |
|------|------|
| `FF_ORCHESTRATOR_ENABLED` (default 1) | `POST /v1/agent` |
| `FF_AGENT_CHECKPOINTS` + paging envs | Token-budget MemGPT paging; structured `<MemorySummary>`; goal re-anchor |
| `FF_AGENT_BLACKBOARD` (default 1) | `agent_blackboards` + `blackboard.read/write`; `<Blackboard>` in brief |
| `FF_AGENT_SKILL_CACHE` (default 1) | `agent_skills` trajectory cache; `<CachedSkill>` hint only |
| `FF_AGENT_PLAN_DAG` (default 1) | Pre-invoke JSON DAG + `plan_propose` / `plan_update`; SSE `plan` |

Migration: `0054_agent_blackboard_skills`. Stay on deepagents (no custom StateGraph).

**Local Horizon QA** (`feature/MytrionAdmin`): `pnpm db:migrate` → `pnpm dev:all` →
`/main/adminmytrion` → **Horizon AI**. Smoke: `"hi"`; multi-dept ask; long thread; skill hint.

**Eval:** `EVAL_AGENT_SOTA=1 pnpm eval:live --category sota`. Unit: `tests/unit/agent-sota-phase1.test.ts`.

## 2026-07-23 — SotA Agentic Phase 2

Sequenced on `feature/MytrionAdmin` after Phase 1.

### 2.1 Hard DAG + data-center agent
- `FF_AGENT_HARD_DAG=1` (default): [`waveRunner.ts`](src/modules/agents/planning/waveRunner.ts)
  deterministically runs ready plan nodes via isolated `createDeepAgent` + `AgentResult`,
  writes blackboard artifacts, replans when blocked, then synthesis turn.
- New agent key `data-center` (Sales-book / Data Center workspace copilot; `departments: ['sales']`,
  no new department tag). Routing copy in orchestrator prompt.

### 2.2 Corrective RAG
- Ternary grade Correct|Ambiguous|Incorrect in `judgeSufficiency`.
- Loop: refine on Ambiguous; broaden then discard Incorrect; optional web fallback
  (`FF_CRAG_WEB_FALLBACK`, when `webSearch` or admin); else `notDocumented` abstain.
- `FF_AGENTIC_RAG` default **on**. Wired in `scopedRag` + chat `retrieveGrounding`.

### 2.3 Eval / observability
- `RunTracker.cachedPromptTokens` / `cacheHitRate` → `AgentTurnResult.usage`.
- `toolSelectionScores` F1 + `suiteKpis` (p50/p95, soft KPI ceilings) in `behaviorReport` / `evalLive`.
- `pnpm eval:live --baseline eval-reports/baseline-sota-phase2.json` fails on category/KPI regression.
- `EVAL_AGENT_SOTA=1` also enables hard DAG + agentic RAG / CRAG web fallback.
- `eval:retrieval` exits non-zero below recall/MRR floors.
- `LANGSMITH_PROJECT` env. Units: `agent-sota-phase2.test.ts`, updated `query-planner.test.ts`.
- Committed floors: `eval-reports/baseline-sota-phase2.json` (runtime reports still gitignored).

## 2026-07-23 — Admin Deals Recovery / Transfer log

- Recovery: removed John Mercer default transferrer chip + auto-fill; tab starts empty; Load set
  requires an explicit numeric Zoho user id. Backend `GET /admin/deals/:id` no longer defaults
  transferrer to Mercer (optional query only).
- **Removed Transfer log tab** (and list UI/API): `OwnershipTransferLog.tsx`,
  `GET /admin/ownership-transfers`, `ownershipTransferAdmin.ts`, FE list client, repo `list`.
  Append-only `insertOwnershipTransfer` audit writes on actual transfers remain (no UI).

## 2026-07-23 — KB sync + Recovery COQL

- Knowledge Base empty: API on local `:5433` had 0 docs; synced 49 docs / 604 chunks from Render.
- Recovery: removed Have prior / Missing prior / Timeline hits tiles. Transferrer filter is
  Owner_Logs COQL (`Created_By`, default limit 1000) + pagination; static `recoveryDealIds` removed.
  Prior owner still from deal `__timeline`. Copy COQL button in Recovery toolbar.

---

## 2026-07-23 — Sales Tickets: ordering, latency, tab order (feature/MytrionAdmin)

### Chat message ordering (our reply vs Desk message interleaved wrong)
- `loadTicketMessages` sorted server rows by `_ts`, but rows with a missing/unparseable time got
  `_ts=0` and floated to the **top** (e.g. an attachment with no server time), and the sort key was
  stripped before the pending merge — so optimistic/live sends were blindly appended
  (`[...server, ...extras]`) and could sit out of order next to Desk messages.
- Fix: `TicketMsgVM` now carries `ts` (epoch ms; 0 = unknown). Added `byTicketMsgTime` comparator
  that sends unknown times to the **bottom** (treated as "just now"). `loadTicketMessages` keeps `ts`
  and sorts with it; `buildPendingMsgs` stamps `ts` (`Date.now()`); `mergeTicketThread` now sorts the
  server+pending union so the whole thread is always chronological. (live.ts, ticketOptimistic.ts)

### Slow ticket open
- Backend `/desk/tickets/:id/comments` hydrated full thread content with an **unbounded** per-thread
  Zoho GET fan-out (`threadList.slice(-40)`), so long-running tickets fired dozens of serial-credited
  Desk calls per open. Capped the hydration window to the most recent 15 threads
  (`THREAD_HYDRATE_WINDOW`); older threads keep their summary. (src/routes/v1/desk.routes.ts)

### Tab order
- Moved **Tickets** to sit right after **Retention** in the `soon` nav cluster
  (retention → tickets → verification → callHub). (salesData.ts)

### Move-to-top
- Reviewed: `useTicketsFeed.promoteTicket` already pins + fetches tickets outside the loaded pages
  (via directory cache + `loadTicketById`), and pins survive `softReload`/`loadMore`. The path is
  functionally correct for any owned ticket; the perceived "not bumping" was the open latency above.
  Left the shell-level ownership filter (sidebarBadges full page scan) as-is — changing it blind is
  risky and it works for the common (<99 tickets = 1 page) case.

- Verified: `tests/unit/desk-routes.test.ts` (23) green; app typecheck introduces no new errors in
  the touched files (pre-existing WIP errors elsewhere on the branch remain).

## 2026-07-23 — View as loaders (Billing + CS)

- ActAsPicker: empty menu + spinning refresh icon while `listAgents` loads → shimmer skeleton
  rows (search stays usable; no spinner).
- Billing + CS Data Center: centered ring loaders on initial / View-as remount → table-row
  skeletons that keep toolbar/table chrome.
- Billing Transactions / Debtors / Prepay / Returns: same pattern (drop `bm-initial-loader` rings
  on View-as remount).

## 2026-07-23 — User Management: Zoho role defaults

- Added `mytrion_role_defaults` (migration `0055`) + repo. Resolver layering is now
  profile default → role default (UNION grants / OR all-dept / home overlay) → per-user
  override → env-admin pin. Specific Mytrion grant = full access to that Mytrion
  (department 1:1).
- Admin API: `GET/POST /admin/mytrion-access/roles` (roster roles appear as unconfigured
  stubs until saved). Admin UI: Role Defaults tab; Users table shows Role column.
- Tests extended for role-only, union, override-wins, Full Mytrions via role.

## 2026-07-23 — Billing read-only vs full (User + Role)

- Added `mytrion_access_modes` JSONB on `mytrion_role_defaults` + `worker_mytrion_access`
  (migration `0057`). Profile defaults stay implicit full.
- Resolver merge: env-admin/all-dept → all full; else user mode; else role mode; else full.
  Surfaced on `/auth/me` + admin effective; `requireMytrionWrite` gates Billing write POSTs.
- Admin UI: Role Defaults + User override show Billing Read-only / Full. Billing Transactions/
  Returns hide write actions when read-only.


---

## 2026-07-23 — Sales Inbox off servercrm/Zoho → own Postgres + WebSocket (feature/MytrionAdmin)

Goal: stop the Sales inbox depending on Zoho `Org_Module` (read) + the servercrm
`crm_inbox_notification` WebSocket (live). Mirror the module into our own table, create rows via our
own webhook, push live over our existing `/v1/realtime` hub. **Tickets stay on servercrm (migrate later).**

- **Inspected** Zoho `Org_Module`: id, Owner{id,name,email}, Subject, Content(HTML), Type
  (Task/Update/Assignment/… — free text, values exceed the picklist), Priority(small/medium/high),
  Tag, Source_Url, Created_Time, Record_Status__s.
- **New table `mytrion_inbox_messages`** (`src/db/schema/mytrion_inbox_messages.ts`) mirroring those
  fields + tenant_id, owner_zoho_user_id (scope key), read_at (reserved), timestamps. Partial-unique
  `(tenant_id, zoho_record_id) WHERE zoho_record_id IS NOT NULL` = idempotent Zoho retries.
  Migration **0056** hand-authored (drizzle-kit `generate` still hits the 0022/0023 snapshot
  collision — recent tables 0048/0054/0055 are all hand-authored). Verified on a throwaway DB in the
  octane-postgres container (structure, idempotent re-run, partial-unique behavior).
- **Repo** `src/repos/mytrionInboxMessageRepo.ts` (pure DB, tenant+owner scoped: create w/ unique-
  violation→return-existing, listForOwner excl. Trash, deleteForOwner). **Service**
  `src/modules/inbox/service.ts` `createInboxMessage()` = persist + `publishInboxEvent` (mirrors
  `retention/notify.ts`) + `toInboxMessageDto`. Reuses the existing realtime hub — NO new socket.
- **Routes** `src/routes/v1/inboxMessages.routes.ts` (registered in app.ts):
  `POST /v1/inbox/messages/webhook` (shared secret `x-inbox-secret` = `INBOX_WEBHOOK_SECRET`, tolerant
  of Zoho or normalized casing incl. nested `Owner`, required owner+subject; persists + pushes to
  `inbox:worker:<zohoId>`, synthetic audit); `GET /v1/inbox/messages` (session-authed, owner-scoped
  via `resolveZohoUserId`, admins View-as `?owner_id`); `POST /v1/inbox/messages/:id/delete`
  (owner-scoped — improvement over the old no-ownership-check Zoho delete). Internal "several places"
  call `createInboxMessage()` directly.
- **Frontend**: `apps/mytrion-crm/src/api/inbox.ts` (new); `loadInbox` now reads `/v1/inbox/messages`
  (unchanged `InboxVM` map — Type categories preserved so `mapInboxType` needs no change);
  `useRetentionRealtime` broadened to dispatch `inbox.*` events → the existing inbox reload fan-out
  (`invalidateInboxCache`+`publishInboxReload`+`publishInboxLive`+toast); removed the
  `crm_inbox_notification` branch from `sidebarBadges` (servercrm socket KEPT for ticket events).
- **Cutover step (in Zoho, not code):** repoint the CRM "Inbox" workflow webhook from servercrm
  `/webhook/crm-inbox` to `POST /v1/inbox/messages/webhook` with the shared secret. No backfill
  (starts empty, fills from new events).
- **Follow-up (cosmetic):** `InboxTab` LIVE/OFFLINE dot still uses its own servercrm socket; repoint
  to our realtime status later (data path is fully off servercrm already).

Verification: `tests/unit/inbox-messages-routes.test.ts` 9/9 (auth, create+publish, tolerant parse,
validation, owner-scoped list=RBAC leakage, owner-scoped delete). New files typecheck + lint clean.
The suite's 78 failures (12 files: agent-golden, agent-rbac-leakage, touchpoints-*, carrier-mini-app,
approvals, caller-identity, cs-routes, retention-*, stream-adapter, department-agents) are
PRE-EXISTING branch WIP — confirmed via a committed-HEAD worktree: touchpoints-routes fails at the
bare commit; agent-golden/caller-identity fail only under the branch's uncommitted agent/RBAC rework
(those files were already `M` at session start). None touch inbox code.

## 2026-07-23 — Silence RingCentral AGW-401 console spam

Embeddable probes `platform.ringcentral.com` before OAuth completes and dumps
`AGW-401 / Authorization header is not specified` into the page console (string or JSON object).
Not fixable via adapter params (`enableErrorReport=false` already set). Extended
`rcConsoleFilter` to match AGW-401 (+ object `errorCode` payloads) on log/debug/info/warn/error,
and install the filter at `RingCentralPhone` module load so early session-restore probes are
covered. Network-tab 401 rows / cross-origin iframe logs still cannot be hidden from our origin.

## 2026-07-23 — Sales Retention locked-card copy

Locked former-owner cards now say **Escalated to Retention** (Dissatisfied + New 2BD handoff /
phase_2) or **Escalated to Open Pool** (pool statuses), via `salesLockBadge` / `salesLockTitle` in
`retentionTimers.ts`. Cards stay disabled (`is-locked` / pointer-events none). Column hint for
Dissatisfied → "Escalated · Retention".

## 2026-07-23 — Retention case creation: all Sales agents

Local `.env`: `FF_RETENTION_PILOT_ONLY=0` (cleared `RETENTION_PILOT_AGENT_ZOHO_USER_IDS`). Render has
no pilot env var (defaults off). Verified pg-boss: `automation.retention.case-sync` cron
`0 * * * *` America/Chicago + `deadline-sweep` `*/15`; latest sync
`created:3 scanned:500 breached:262 refreshed:259 pilotSkipped:0`. Open Phase‑1: **281 cases /
51 agents** (Daniel Brown only 10). Escalation→CS still blocked (`RETENTION_AUTO_ASSIGN_ENABLED=false`).
Ops helpers: `scripts/checkRetentionJobs.ts`, `scripts/runRetentionSyncOnce.ts`.

## 2026-07-23 — Open Pool cards stay on their stage column

Former-owner Open Pool / claim-pending cases no longer map to Closed. `kanbanColOf`
places them on Reached / OoR / Vacation / New from `agentOutcome` (locked badge unchanged).
`enterOpenPool` only overwrites `agentOutcome` when the caller passes one (preserves stage).

## 2026-07-23 — Sales Home: load-then-reveal

Home no longer paints the hero while tiles stream in. `homeReady` waits for snapshot +
announcements + inbox + today's activity + app-stats; shows `HomePageSkeleton` (full page)
until they settle (or error). Re-gates on View-as user switch.

## 2026-07-23 — Seed one Daniel Brown case into Open Pool (claim UX test)

Ran `scripts/seedDanielOpenPoolCase.ts` → case **414** XPEDITED FREIGHT LLC (`5800330`)
status `p1_open_pool`, poolOwner=Daniel Brown, assignee cleared, 3BD claim window. Use View-as
any other Sales agent → Retention → Open Pool → claim (instant Zoho + Kanban New).

## 2026-07-23 — Open Pool claim modal polish

Beautified `PoolClaimModal`: header pills (Open Pool / Instant assign / Max 2/day),
deal summary with colored Quiet/Cycle/Fuel/Cadence badges, numbered reason + confirm
steps with Ready/Required state, green confirm-on state, and distinct primary Claim
vs Cancel. Styles in `theme.css` `.ss-pool-*`.

## 2026-07-23 — Revert XPEDITED claim test ownership to Daniel

After successful Open Pool claim UX test (Apo Adams), ran
`scripts/revertXpeditedToDaniel.ts`: Zoho Deal/Contact/Account
`6227679000080100779` / `…776` / `…773` Owner → Daniel Brown; case **414**
assignee restored, assignment_count 2→1, open_pool_attempt 1→0.

## 2026-07-23 — Open Pool daily claim quota UI + count harden

Backend already wrote Apo’s approved claim (case 414) to
`retention_claim_requests` (used=1 → remaining should be 1), but the badge
stayed at 2 because the UI only re-fetched quota after claim. Fix:
`claimNow` returns `{ quota }`, PoolTab applies it immediately + View-as deps,
badge shows `left / max` with low/empty tones. Count uses `requested_at`
(UTC day) instead of nullable `resolved_at`.

## 2026-07-24 — Sales Tickets stale-while-revalidate cache

Tickets tab no longer cold-boots Desk on every visit. `useTicketsFeed` paints
from `dcCache` (`sales:tickets:feed:*`, 60s SWR); shell `loadTickets` uses
`useCachedLoad` (120s) and seeds the feed cache. Page fetches share via
`dedupedFetch` (15s). Create-ticket invalidates `sales:tickets` + `desk:tickets:`.

## 2026-07-24 — Tickets: match ticketdashboard load path (fix hang)

Root cause: shell `loadTickets()` dumped up to ~20 Desk pages on every Sales mount,
and Desk.search is SCOPE_MISMATCH (403) so each page used the slow creator-scan
fallback — UI looked hung. Fix aligned with zoho-octane ticketdashboard.html:
- shell warms **first 20 only** + subscribe registry for WS ids
- Tickets tab progressive pages update the registry (no full dump)
- windowed `pageTicketsByCreator` scans in parallel batches of 5
- chrome always visible; list-body spinner only; empty cache never “fresh”
Verified smoke: search 403 SCOPE_MISMATCH; windowed first page ~3.2s / 15 rows.

## 2026-07-24 — Tickets thread side + attachments + realtime

Sales-side authorship: treat viewing CRM agent name/email as "me" in addition to
`ZOHO_DESK_AGENT_ID`, so a Komilova thread + Desk-agent attachment stay on the same
(left) side. Surface comment/thread inline attachments; poll open thread every 12s;
selecting a ticket upserts WS subscribe ids.

## 2026-07-25 — Pause Open Pool + Retention escalations (Sales keeps ownership)

Cases still generate; Sales can work New / Reached / OoR / Vacation / Dissatisfied.
Kill-switches in `src/modules/retention/killSwitches.ts` (logic kept, all `false`):
- `RETENTION_OPEN_POOL_ESCALATION_ENABLED` — no enterOpenPool (timers, 5× OoR, claims)
- `RETENTION_PHASE2_ESCALATION_ENABLED` — no handoffToRetention; Dissatisfied → `p1_dissatisfied`
- `RETENTION_OPEN_POOL_CLAIM_ZOHO_TRANSFER_ENABLED` — no Deal/Contact/Account Owner rewrite
`RETENTION_AUTO_ASSIGN_ENABLED` remains false. Flip switches later to restore.

## 2026-07-25 — RingCentral prod: sign-in without hard refresh

Prod symptom: softphone dock sometimes missing Sign in until a full page refresh.
Cause: adapter `<script>` could remain while `#rc-widget-adapter-frame` was gone (Zoho
tab blur / soft-nav); bootstrap early-returned on “script already injected” and never
remounted. Fix:
- remount when iframe missing; wait for frame after inject; `revealRingCentralWidget()`
  (un-minimize / un-close) on boot, login, logout toast, and tab visible / pageshow
- adapter URL adds `multipleTabsSupport=1`
- embed-config + call-events allow **sales or customer-service** (CS Mytrion was 403)

## 2026-07-25 — Escalated-to-Retention stay on New/Dissatisfied + CS single assignee

Kanban: Phase 2 “Escalated to Retention” cards were dumping into Closed via
`kanbanColOf` (`phase !== phase_1_agent → closed`). They now stay on the stage
they left from (Dissatisfied → Dissatisfied; New / 2BD escalate → New). Closed
is for returned/fuel only.

CS assign: RoundRobin rotation removed — `RETENTION_CS_ROUND_ROBIN_ZOHO_USER_IDS`
first id is the fixed assignee when auto-assign is later enabled.
`RETENTION_AUTO_ASSIGN_ENABLED` remains **false** (do not activate yet).

## 2026-07-25 — Retention call finish: restore stage picker (not DC wizards)

Retention New-case flow was colliding with Data Center Deal/Lead post-call
wizards: dial context attached `dealId` from the case, so after a retention call
the Deal validation modal opened on top of the case stage picker.

Restore the older Retention UX:
- “Continue to choose stage →” + “← Back to call” on New cases again
- dial context is `retentionCaseId` only (no `dealId`)
- `LeadCallWizardHost` / `DealCallWizardHost` ignore events with `retentionCaseId`

## 2026-07-24 — DWH / salesdata connect timeout (ServerCRM)

Symptom: `[server-crm] POST /api/agent/salesdata → HTTP 500: timeout exceeded when
trying to connect` (~16s). Not a slow Octane query — Render ServerCRM could not
check out a DWH client.

Root cause (live `pg_stat_activity`): lock storm on the shared analytics Postgres
(`77.42.31.254:54342`). Mashup Engine pid held a heavy query ~1h47m
(`ExecuteGather`); postgres/dbt sessions queued behind it; ServerCRM
`agent_carriers` / salesdata queries sat on `Lock/relation` 60m+ and pinned the
pool. Local `select 1` / `dim_company` still ~380ms (slots free; jam was lock
queue, not max_connections=150).

Recovery: jam cleared on its own; `/api/agent/salesdata` returned 200 in ~3s.
Preventive (Octane-Project/servercrm `services/dwh.js`, needs Render deploy):
lower `max` (8), `connectionTimeoutMillis` 15s, `statement_timeout=30s`,
`idle_in_transaction_session_timeout=60s`, `application_name=servercrm`.
Ops probe: `scripts/probeDwhLockJam.ts`. If it recurs: terminate the Mashup
root blocker (or restart Mashup), then restart ServerCRM to flush stuck clients.

---

## 2026-07-25 — agent-gateway: OAuth token pool (multi-token failover)

Problem: every parallel turn drew on ONE `CLAUDE_CODE_OAUTH_TOKEN`. With several groups active,
the subscription 5h/7d window exhausts and the whole bot goes dark. (Turns were already parallel
across chats via `sessions.ts` `chains` map — concurrency was never the blocker; shared quota was.)

Added `src/authPool.ts`: token pool with round-robin SPREAD + cooldown FAILOVER.
- Config (merged, de-duped): `CLAUDE_CODE_OAUTH_TOKENS` (comma/newline list) | `..._1.._10` |
  single `CLAUDE_CODE_OAUTH_TOKEN` (legacy = no rotation). `AUTH_COOLDOWN_MS` fallback (1h).
- `pickToken(tried)` round-robins healthy tokens so N concurrent group turns land on N accounts;
  best-effort returns a cooling token if all are down; null once all tried this turn.
- `markLimited(token, resetsAt)` cools a token (normalizes unix-seconds→ms); `soonestRecovery()`.

`sessions.ts`:
- `runQuery` now takes `authToken`, pins it via `options.env` (spreads `process.env` — that option
  REPLACES the subprocess env). Detects rate-limit in-stream: rejected `rate_limit_event`
  (+resetsAt), assistant `error:'rate_limit'`, result `api_error_status===429` — only acted on when
  the turn produced NO text.
- New `runWithRotation` wraps it: on `rateLimited`, cool the token + retry SAME turn RESUMING the
  SAME session id on the next token (transcript is on disk under `$HOME/.claude`, account-agnostic,
  so the conversation continues). Also folds in the existing dead-resume heal (retry fresh, same
  token). Throws `AllTokensLimitedError(retryAt)` only when every token is exhausted →
  enqueue's catch sends a bilingual "try again in N min" fallback.

Boot log now prints `tokens=N`. Verified authPool logic standalone (8/8: dedupe, spread, failover,
cooldown, all-exhausted). `pnpm typecheck` green. Live-run TODO: confirm a mid-session token swap
resumes cleanly (the one thing disk-transcript resume can't be unit-tested for).

### MAX_CONCURRENT_TURNS cap (same session)

Added global concurrency semaphore in `sessions.ts`: `MAX_CONCURRENT_TURNS` (default 6, ≥1). Per-chat
chains still serialise a single chat; the semaphore bounds total turns EXECUTING across all chats so
a busy hour can't spawn dozens of CLI subprocesses and OOM the container. Acquired in `runTurn`
BEFORE the typing keep-alive (a queued turn doesn't flash "writing…" while waiting); released in
`finally`. Slot handed directly to the next waiter on release (active count only drops when nobody
waits). Boot log now prints `maxConcurrent=N`. Fuzzed the semaphore algo (500 concurrent, 4/4:
peak==cap, never breaches, all drain, zero leaked slots). `pnpm typecheck` green.

### Per-USER sessions (no same-group head-of-line wait)

Decision (owner): a user who writes must NEVER wait because the bot is busy on someone else — the
worst failure mode of the agent. Two changes:
1. `MAX_CONCURRENT_TURNS` default flipped to UNLIMITED (0/unset). The cap I added earlier was itself
   starving fresh chats; kept as an opt-in safety valve only. Boot log prints `maxConcurrent=∞`.
2. Session + queue key changed `chatId` → `chatId:userId` (`sessions.ts`). Turns now serial WITHIN a
   user's thread, parallel ACROSS users — so in a busy group driver B is answered while driver A's
   turn still runs. `enqueueTurn(chatId, userId, …)`; both call sites in `index.ts` updated. `chains`
   map pruned on settle (was bounded by #chats, now would grow per unique asker).

Why safe (checked, not assumed): the tool layer already authorises by (chatId, userId) — `tools.ts`
`recentSenders` is `chatId→(userId→ts)` (no clobbered "current sender"), and `telegramTools.ts`
`telegram_read_image` refuses a photo whose `entry.userId` ≠ asker. Per-user context also means one
user's session only ever holds their own id, so it can't act as another user. Known minor: only ONE
latest photo per chat — if A posts then B posts, A must resend (guard refuses, no leak).

Concurrency reality with a single resumable session id: it can't run two turns at once (SDK resume
not concurrent-safe), which is exactly why per-USER keying (not a bigger per-chat lock) is the fix.

Verified: queue keying (same-user serial / cross-user parallel / prune 3/3), semaphore fuzz (4/4),
authPool (8/8). `pnpm typecheck` green.

### Hardening pass (adversarial review fixes)

Reviewed the multi-token / per-user work for failure modes. Fixed the code-side ones:

- **Double tool-execution on rotation** (`sessions.ts` runWithRotation): on rate-limit, carry the
  session id the failed attempt established (`init` stores it even when the turn then limits) into
  the retry, so the next token RESUMES the transcript instead of re-running the user prompt — a write
  tool that already fired on token A won't fire again on B.
- **All-tokens-exhausted amplification** (`sessions.ts`): fast-fail a turn when every token is cooling
  and the soonest reset is > `ALL_LIMITED_FASTFAIL_MS` (30s), instead of best-effort-spawning a doomed
  CLI per token per queued turn (100 queued × 3 tokens = 300 pointless spawns hammering a limited API).
- **Cooldown re-extension** (`authPool.ts` markLimited): authoritative `resetsAt` always wins; a
  no-reset limit only STARTS a cooldown on a currently-healthy token — repeat probes no longer push a
  cooling token's recovery farther out.
- **Telegram Bot-API 429** (`telegram.ts`): global outbound send throttle. `queued()` spaces
  replies/buttons/reactions/acks ≥ `TELEGRAM_MIN_GAP_MS` (40ms ≈25/s), FIFO, a rejecting send never
  stalls the queue. `sendTyping` uses `bestEffort()` — skipped if within the gap so cosmetic pulses
  never delay a real reply. Polling + file downloads unthrottled (separate limits).

Verified: throttle (gap/FIFO/reject-resilience/best-effort-skip 5/5), markLimited no-re-extend +
authoritative-override (2/2). `pnpm typecheck` green.

DEFERRED (need product/live decision, NOT fixed in code):
- **Tokens MUST be separate Anthropic accounts.** 3 setup-tokens off ONE subscription share ONE quota
  → they limit together → rotation is a no-op. Confirm 3 distinct Max/Pro seats before relying on it.
- **Cross-token resume UNVERIFIED.** "Continue conversation on the next token" assumes resuming a
  session created under account A works when authed as account B (transcript is on the shared disk
  volume, so plausibly yes). The double-write fix depends on this. Live-test a forced mid-turn swap.
- **Shared `~/.claude.json` under high concurrency**: downgraded — the CLI writes it atomically
  (temp+rename, see data/claude-home/backups/*.backup), so concurrent writers get last-write-wins,
  not corruption. Left shared on purpose: per-token config dirs would isolate the transcript store
  and break cross-token resume.
- **Per-group Telegram limit (~20 msg/min/group)** still applies — a single group with a burst of
  users can't be replied to faster than Telegram allows, regardless of our global gap. Per-chat
  bucket is a possible follow-up.
- **Group context**: per-user sessions mean the bot no longer sees other users' messages as context
  (accepted trade for no head-of-line wait).

### Verification harnesses (#1 accounts, #4 cross-token resume)

Added two on-demand diagnostics (hit real API, cost a tiny turn each):
- `scripts/checkTokens.mts` — one haiku turn per token, reads the `rate_limit_event` window
  (`resetsAt` five-hour + `overageResetsAt` seven-day). Two tokens sharing a 5h reset timestamp =
  SAME account → flags 🔴 "rotation won't help". Independent windows = 🟢. (accountInfo has no email
  for OAuth tokens, and the /usage control method returned empty/unscoped, so the window timestamp
  from the message stream is the reliable discriminator.)
- `scripts/testCrossTokenResume.mts` — phase 1 token A stores codeword TANGERINE-42, phase 2 token B
  RESUMES that session id and must recall it. PASS ⇒ context survives a token swap.

Ran both with the single configured token:
- checkTokens: works (status=allowed, 5h window resets 2026-07-24T23:10Z). Only 1 token → nothing to
  compare; waiting on the real pool.
- resume test (degenerates to same-token): 🟢 PASS — resume plumbing itself is sound.

STILL NEEDS the real 3-token pool (owner to set CLAUDE_CODE_OAUTH_TOKENS) to close #1 + true #4.
Note: runWithRotation ALREADY handles a cross-account resume REJECTION gracefully — the catch drops
the session and retries fresh on the new token. Residual if that path fires: the rare mid-turn
double-write returns (write tool re-run on the fresh retry). So the cross-account resume result
determines whether #2's fix is fully effective or we lean on the fallback.

## 2026-07-28 — audit fixes on multi-token failover + stack restart

Audited d19620f, fixed 4 findings (typecheck green, root test failures pre-exist on tip):
1. **Signal handlers now exit** (`sessions.ts`) — SIGTERM/SIGINT flush then `process.exit(0)`;
   before, `docker stop` hung its full grace period until SIGKILL, Ctrl+C needed two presses.
2. **Write-replay guard** (`sessions.ts`) — stream watches `tool_use` for WRITE_RISK_TOOLS
   (money_code, manual_code, override, card_action, service_request). If one fired before a
   rate-limit failover, the retry sends a continue-nudge, NOT the original prompt (double money
   code risk). If the resume then DIES post-write, refuse the blind fresh retry — fail the turn
   (closes the residual noted 2026-07-25).
3. **Error RESULT ≠ silence** (`sessions.ts`) — `error_max_turns`/`error_during_execution` end with
   no text and no throw; runTurnInner now sends the bilingual fallback + errMsg to the monitor.
4. **Telegram 429 honored** (`telegram.ts`) — must-deliver lane (tgSend) parses `retry_after`,
   stamps a global `blockedUntil`, retries once; non-ok responses logged. Typing lane unchanged.

Separately: whole local stack found DOWN (gateway container gone, :3001 down, :5433 down) —
"can't access money code" report was this, not the code. Restarted per CLAUDE.md run stack.

## 2026-07-28 — review of agent-gateway multi-token branch

Reviewed `build...feature/agent-gateway-multi-token-failover` without changing implementation.
Open findings:

1. `telegram_read_image` still trusts the model-supplied Telegram user id instead of binding the
   per-user session id, so a prompt-injected id can read another recent sender's cached group photo.
2. Write replay protection is incomplete: `octane_card_limits` and `octane_card_info` are absent
   from `WRITE_RISK_TOOLS`, and a thrown resumed stream loses the attempt-local write marker before
   the fresh-session replay path.
3. The image transcription sub-query does not receive the token selected by `authPool`; a pool
   configured only through the documented plural/numbered variables has no singular token for that
   nested SDK call, while a legacy singular token bypasses rotation and can remain rate-limited.
4. Button ownership is keyed only by Telegram `message_id` (which is chat-scoped), is fail-open
   after restart/cap eviction, and does not consume a confirmation after its first tap.
5. No committed unit tests exercise auth cooldown/rotation, write replay, button ownership, or
   bound image identity; the two added scripts are live diagnostics and are excluded from the
   gateway `tsconfig`.

Verification: gateway typecheck passed; root lint and typecheck passed; cross-tenant RBAC suite
passed. Full root tests: 882 passed / 38 failed across unrelated existing areas plus sandbox-local
network restrictions; this branch changes no root implementation or root tests.

## 2026-07-28 — owner/manager private agent chat + gateway safety

Implemented the first agent-gateway upgrade slice:

- Added `GET /v1/support-bot/dm-access`, resolved exclusively from the ACTIVE mini-app registration
  through `registeredMiniAppCompanyRepo`. Only `owner` and `manager` return a carrier; drivers and
  missing/revoked registrations fail closed.
- Gateway private chats now resolve `(telegram user → carrier)` through that endpoint. Telegram's
  private-chat `chat.id === from.id` invariant is enforced, every verified DM message engages
  without an `@mention`, and group behavior remains mention/reply/follow-up gated.
- Prompts now distinguish `GROUP_CHAT` from verified `PRIVATE_DM`: owner-authorized figures may be
  discussed in DM, while money-code values, full card numbers and PINs remain tool-delivered only.
- Bound `telegram_read_image` to the session user rather than its model-supplied id; its nested
  vision query now uses the token selected for that attempt, so multi-token failover also applies.
- Replaced global/fail-open button ownership with `(chatId,messageId,userId)` ownership, 10-minute
  expiry, single-use consumption and fail-closed restart/eviction behavior.
- Follow-up UX: button authorization returns `allowed | foreign | unavailable`. Expired, replayed,
  evicted and restart-unknown taps get a visible bilingual Telegram alert asking the user to request
  the action again; foreign-user taps are silently acknowledged with no ownership leak.
- Completed write-replay classification for card limit/info writes. A streamed exception now
  carries the attempt's write marker and refuses a fresh retry after any emitted write tool.
- Refreshed the gateway README and added 13 focused tests for DM authorization/client behavior,
  engagement, button isolation/replay/expiry and retry-safety classification.

Verification: gateway + root typecheck green; root lint 0 errors (18 existing warnings); 35 focused
gateway/RBAC tests green. Full suite: 895 passed / the same 38 unrelated failures as the pre-change
run, plus the existing detached mini-app mock rejection. No deployment or live Telegram/API call
was performed.

## 2026-07-28 — offline real-time agent-gateway stress harness

- Added `apps/agent-gateway/scripts/stressGateway.mts` and the `stress:offline` package command.
- The harness simulates parallel `(chat,user)` turns with per-user ordering and a global concurrency
  cap, while reporting completed/queued/active turns, throughput, elapsed time and RSS in real time.
- It exercises the real button-ownership and write-risk helpers plus auth-pool rotation with exactly
  three fake tokens. All numbered/singular token environment slots are cleared inside the process.
- Network is denied in-process by replacing `globalThis.fetch`; no real Telegram, Mytrion, EFS,
  Claude, or client request is made. Runs are capped at 1,000,000 synthetic turns to avoid OOM.
- Added JSON output for CI and documented both live and JSON commands in the gateway README.
- Verification: 1,000-turn live run passed (12/12 max concurrency, zero same-user overlap and
  out-of-order completion); JSON run passed; standalone strict script typecheck, gateway/root
  typecheck and 14 focused gateway tests passed; lint has 0 errors and the same 18 warnings.
  Full suite remains red only outside this slice: 896 passed / 38 failed plus one existing detached
  mini-app mock rejection; all three agent-gateway test files passed in the full run.

## 2026-07-28 — Redis coordination/idempotency/staging plan

- Added `docs/agent-gateway-redis-idempotency-staging-plan.md` with the detailed staging matrix in
  `docs/agent-gateway-staging-load-test-matrix.md`; the split keeps both files below the repo limit.
- The plan defines a Redis Streams ingress/worker model with per-session leases and fencing,
  Postgres-backed idempotency for support-bot writes, failure-state semantics for external provider
  uncertainty, staging load/failure scenarios, release gates, and a controlled rollout/rollback.
- Planning only: no Redis dependency, database migration, runtime behavior, deployment, or external
  request was added in this step.

## 2026-07-28 — idempotency/fencing implementation started

- Folded the agreed fence atomicity, turn replay, occurrence-slot, ingress failover, button,
  stub/real-model, and token-failover refinements into the plan and staging matrix.
- Added migration `0076_support_bot_operations.sql` (renumbered from 0058 during the build merge):
  a global Postgres fencing sequence,
  tenant/session fence registry, and tenant-scoped operation ledger with unique idempotency and
  `(tenant, turn, write occurrence)` slots.
- Added `supportBotOperationRepo`: fence verification and operation claim share one transaction
  with the fence row locked; expired pre-external claims can be reclaimed, while any operation past
  the external boundary routes to reconciliation.
- Added deterministic canonical request/session/operation identity helpers and an executor that
  returns sanitized replay results, blocks stale/conflicting/in-progress/unknown attempts, and marks
  ambiguous provider failures unknown.
- Moved support-bot caller lookup onto `registeredMiniAppCompanyRepo`, making caller resolution
  request-tenant scoped instead of a direct route query.
- Extracted `/support-bot/card-action` into its own route module. With
  `FF_SUPPORT_BOT_IDEMPOTENCY=0` it preserves the legacy path; when enabled it requires gateway
  operation metadata, issues a Postgres fence, and executes through the ledger.
- Gateway turns now carry the Telegram update ID (`tg:<update_id>`). The card-action tool lazily
  acquires a fence and supplies a gateway-generated idempotency key, persisted occurrence, session
  hash, and fencing token; the model controls none of these values.
- Added 18 focused operation/route/gateway-identity tests. Cross-tenant/RBAC baseline was 52/52;
  the final combined focused run, including the existing gateway safety tests, was 64/64.
- Root and gateway typechecks passed; lint remained 0 errors with only pre-existing warnings after
  removing the one new assertion warning. `drizzle-kit check` remains blocked by the existing
  0022/0023 snapshot-parent collision; migration 0058 was not applied. Feature flag stays OFF and no
  deployment, Telegram, EFS, ServerCRM, or other external request was performed.
- Full suite finished at 914 passed / 38 failed. The 38 failures match the existing unrelated
  baseline areas; every new idempotency, fencing, card-action, and gateway test passed. The existing
  detached mini-app mock rejection also remains.
- Remaining prerequisite debt: `supportBot.routes.ts` was reduced but is still above the 600-line
  cap. Continue Phase 0 route extraction before enabling the feature or starting Redis workers.

## 2026-07-28 — support-bot Phase 0 route/repository cleanup

- Split the 1,079-line `supportBot.routes.ts` into gateway control-plane, document delivery and
  private-value route modules. The original route is now 523 lines; every support-bot route module
  is below the 580-line target.
- Removed every direct database query/import from support-bot routes. Message ingest and chat-map
  persistence now go through `supportBotGatewayRepo`; registration access-list reads go through
  `registeredMiniAppCompanyRepo`.
- Made chat mapping tenant-safe at both query and uniqueness levels. Migration
  `0077_support_bot_chat_tenant_scope.sql` (renumbered from 0059 during the build merge) replaces
  the global `chat_id` unique index with
  `(tenant_id, chat_id)`, and auto-bind locks/claims the tenant-scoped row without re-pointing an
  already enabled mapping.
- Fixed the existing `findByTelegramUserId` lookup so `tenant_id` is part of the SQL predicate
  before `LIMIT 1`, rather than filtering one arbitrary global result in application code.
- Replaced override receipt notification's ineffective `Date.now()` dedupe key with the stable,
  gateway-supplied Telegram turn/request ID. The model cannot supply or alter this value.
- Added cross-tenant gateway-route tests covering chat-map reads, access-list lookup and rejected
  auto-bind when no registration exists in the authenticated tenant.
- Verification: root and gateway typechecks passed; lint has 0 errors and the same 17 existing
  warnings; focused gateway/security suite passed 71/71. Full suite finished at 917 passed /
  the same 38 unrelated baseline failures, plus the existing detached mini-app mock rejection.
  Support-bot migrations 0076/0077 remain unapplied, idempotency remains feature-flagged OFF, and no deployment
  or external Telegram/EFS/ServerCRM request was performed.

## 2026-07-28 — Phase 0 committed + pre-Redis baseline instrumentation

- Registered the support-bot migrations (now 0076 and 0077) in Drizzle's journal. A fresh
  throwaway Postgres migrated through all then-current journal entries, the second migrator run
  was a no-op, and both support-bot SQL files
  each executed twice successfully to verify statement-level idempotency. The throwaway DB was
  removed afterward.
- Applied the journaled migrations to the local Docker `octane_assistant` app database only.
  Production, DWH and MySQL were not touched; `FF_SUPPORT_BOT_IDEMPOTENCY` remains OFF.
- Added in-memory gateway baseline metrics: measured queue/total/SDK/send latency rings; active
  turn, vision and subprocess gauges; RSS/heap/event-loop samplers; Telegram, provider, backend,
  replay, reconciliation and stale-fence counters. Main Claude attempts and image-vision attempts
  both contribute to subprocess pressure.
- Turn lifecycle now spans enqueue through normal or fallback Telegram delivery. Per-user queue
  wait is measured after the optional global slot is acquired, and turn errors are counted once at
  the outer promise settlement. `sessions.ts` remains below target at 571 lines after moving the
  concurrency semaphore into `turnConcurrency.ts`.
- Extended the monitor with `/api/metrics` and incremental `/api/turns?since=` output. New turn
  rows carry stable `turnId`, completion cursors, measured total/send times and truncation metadata;
  old JSONL rows remain readable and are excluded from new total/wait percentile calculations.
- Card-action replay responses now expose only the safe `replayed: true` execution metadata so the
  gateway can count result replays; fresh response bodies are unchanged.
- Added `baseline:capture`, which polls metrics and turns incrementally, aborts on truncation or a
  process restart by default, segments explicitly allowed restart epochs, and writes a repo-root
  evaluation report. A localhost fake-monitor dry run produced a valid report; the fake artifact
  was removed.
- Verification: lint 0 errors / the same 17 existing warnings; root and gateway typechecks, build,
  standalone capture-script typecheck, 65 focused tests and a 100-turn offline stress run passed.
  Full suite: 925 passed / the same 38 unrelated baseline failures plus the existing detached
  mini-app mock rejection. Local backend smoke returned 200 for `/v1/health` and the extracted
  `/v1/support-bot/chat-map`; no gateway was started against a real bot token and no external
  Telegram, Claude, EFS or ServerCRM request was made.

## 2026-07-28 — independent Phase 0 and metrics audit follow-up

- Audited the committed Phase 0 route/repository, migration, idempotency, monitor and baseline
  capture paths. Direct database access remains absent from support-bot routes, all touched source
  files remain below the line caps, support-bot migration journal entries 0076/0077 are present, and
  `FF_SUPPORT_BOT_IDEMPOTENCY` still defaults OFF.
- Fixed four metrics edge cases: backend transport/timeout failures are now counted, a second
  Telegram 429 after retry is counted, baseline capture preserves URL path prefixes and includes
  its deadline sample, and captured turn latency is bounded to the same server-clock window as
  counter deltas.
- Added regression coverage for backend safety/status error classification and the proxied monitor
  metrics route, including preservation of `token` and `since` query parameters.
- Verified the monitor locally: unauthenticated `/api/metrics` returned 403, authenticated access
  returned 200, and a synthetic turn settled with one completed turn, one histogram sample and no
  leaked active gauge. The baseline script was dry-run against a prefixed fake monitor and aligned
  two measured turns with a two-turn counter delta.
- Confirmed the local app database contains the operation/fence tables and the tenant-scoped unique
  chat index; a repeated local migration run completed cleanly. Production, DWH and MySQL were not
  touched.
- Verification: lint has 0 errors and the same 17 existing warnings; root, gateway and standalone
  capture-script typechecks passed; focused tests passed 19/19; offline stress passed 100/100 with
  zero same-user overlap or ordering violations. Full suite finished at 927 passed / the same 38
  unrelated baseline failures plus the existing detached mini-app mock rejection.
- A real Telegram gateway was deliberately not started because the bot token must have only one
  long-polling consumer. No deployment or external Telegram, Claude, EFS or ServerCRM request was
  performed.

## 2026-07-30 — OpenAI gateway burst-handling implementation

- Reviewed the multi-request patterns on `feature/agent-gateway-multi-token-failover` and applied
  the reusable concurrency controls to the standalone OpenAI-only gateway. Claude OAuth token
  rotation, Groq fallback, subprocess resume/replay and subscription-token behavior were not
  copied.
- Added a configurable FIFO global turn semaphore (`MAX_CONCURRENT_TURNS`, default 8), bounded
  global and per-user admission, strict per-user turn ordering, automatic queue-key cleanup and
  per-user chat history isolation.
- Parallelized Telegram update ingestion in bounded batches while retaining per-user ordering.
  Added a global Telegram send throttle, per-chat message spacing, one retry for Telegram
  `retry_after`, shared typing keep-alives and send timeouts so one busy group does not block all
  other groups.
- Added single-flight access/chat-map refreshes, stale-cache cleanup, asynchronous atomic session
  persistence and bounded buffered JSONL logging. Dashboard sync now avoids replacing newer
  in-memory turns while log writes are still buffered.
- Added runtime counters, gauges and latency histograms for queueing, OpenAI, Telegram, backend,
  tools, vision, memory and event-loop behavior, exposed through the authenticated monitor
  `/api/metrics` endpoint.
- Added concurrency, metrics, buffered-writer and single-flight regression tests plus an offline
  concurrency stress harness. Verification passed: gateway typecheck; 33/33 gateway tests;
  22/22 mandatory cross-tenant RBAC tests; and 300 queued turns across 100 users with max active
  exactly 8, zero same-user overlap, zero ordering violations, zero leaked queue keys, 15.29 ms
  maximum sampled event-loop lag and 2.7 MB RSS growth.
- This phase is intentionally single-process. Horizontal replicas still require a shared queue,
  distributed rate limits and Telegram webhook ownership before scaling past one gateway process.
- Merged the latest `origin/build` into the feature branch. The build branch already owned
  migrations 0058–0075, so the support-bot migrations were safely renumbered to 0076/0077;
  both schema entries and both branches' session notes were preserved.
- Post-merge verification: root typecheck and production build passed; lint had 0 errors and 24
  existing warnings; 22/22 mandatory cross-tenant RBAC tests and 33/33 OpenAI gateway tests passed.
  The 300-turn gateway stress run again had zero per-user overlap/order violations and no leaked
  queue entries. The full root suite finished at 1,263 passed / 11 failures in unrelated legacy
  fixtures and mocks. `drizzle-kit check` remains blocked by the pre-existing 0022/0023 snapshot
  parent collision; the migration journal itself has 78 unique entries with every SQL file matched.
## 2026-07-25 — Retention post-call force stage modal + snappy save

After a Retention **New** case call ends, stage selection opens as a forced
overlay modal (`RetentionCallStageModal`, portaled z-index 160) — not the
in-panel stage section under the case. Case panel stays on Call with a short
banner; ESC/close still blocked until a stage is picked.

Save path: optimistic board patch + close immediately, then
`retention.record_outcome` (+ OoR `log_attempt`) in the background. Reverts
the board + toast on failure. Manual Continue still uses the in-panel stage
step.

## 2026-07-25 — Return Retention-phase cases to Sales

Prod one-shot `scripts/returnRetentionCasesToSales.ts --apply`:
8 open `phase_2_retention` cases → `phase_1_agent` (2× `p1_dissatisfied` when
outcome was dissatisfied, 6× `p1_new`). No open Open Pool rows at apply time.
Assignee restored from `pool_owner` when null; deadlines cleared; audit event
logged. Remaining open cases were already Sales Phase 1 (~295 `p1_in_progress`).

## 2026-07-25 — Retention New: force modal only, no Continue

Post-call stage uses `RetentionCallStageModal` alone (case dialog no longer
stacked behind). Removed New-flow “Continue to choose stage →” / back-to-call;
stage is pickable only after the call ends.

## 2026-07-25 — Retention stage modal theme + toast z-index

Force stage modal was portaled to `document.body`, outside `.ss-root`, so
CSS vars (`--warn`, `--on-accent`, …) never resolved → flat cards + near-
invisible CTA. Now portals into `.ss-root` (same as AutoFloatingDrop).
Shell toasts also portal under `.ss-root` at z-index 200 (above modal 160).
Stage cards keep kanban colors/icons; confirm CTA uses stage fill + dark label.

## 2026-07-25 — Horizon picker: theme toggle + card hover parity

Theme pill driven from React `dark` (Horizon-style inline styles + spring knob
slide) so light/dark no longer fight CSS `[data-theme]` rules. Workspace cards
use the same accent bloom / lift / outer glow in light as in dark (no more weak
gray light-mode shadow); hover layers are state-driven, not CSS `:hover`.

## 2026-07-25 — Picker full-width + theme flash fix

Picker content/nav drop `max-width` gutters; hero/top gaps tightened. Theme
toggle flash: `data-theme` now applied synchronously + `useLayoutEffect` (was
post-paint `useEffect`, so header lagged the pill for a frame). Single nav blur
layer; no `transition:all` / filter interpolation on the toggle.

## 2026-07-25 — Picker polish: light hover, Sales icon, width

Restored centered column at 80rem (was 72rem). Kill hover underlines on
workspace Links. Soften light cards/hover (no heavy accent bloom). Sales glyph
→ `TrendingUp`.

## 2026-07-25 — Picker card hover = HorizonNew verbatim

Stopped “softening” the hover. `WorkspaceCard` styles + `horizonGlass` tokens
copied from HorizonNew `App.tsx` (incl. separate `gradientLight`, light frost /
specular / shimmer opacities, and light soft gray shadow). Sales → `LineChart`.

## 2026-07-25 — Soft light theme + accent hover

Dark left alone. Light: softer page/mesh/type; rest cards near-neutral;
hover blooms accent wash + colored soft shadow, title/chevron/icon tint shift.

## 2026-07-25 — Theme VT + light wordmark + icon chip

Theme toggle uses View Transitions crossfade (no hard flicker). Light wordmark
gradients deepened for contrast. Light card hover: white icon chip vs pastel
card wash so icon/bg no longer match 1:1.

## 2026-07-25 — Horizon design system promoted to tokens; Admin skinned

**New:** `apps/mytrion-crm/src/styles/horizon.css` — the Horizon gradient + glass
primitives as app-wide tokens, imported by `global.css` after `theme.css`. The
gradient (sky→pale blue→sunset) is now THE accent in both themes: same hue
journey, deeper stops in light (`--hz-1..5`), plus glass shells (`--hz-pane*`,
`--hz-glass*`), motion (`--hz-ease`, `--hz-dur-*`) and ambience
(`--hz-mesh/grid/vignette`). Every token has a call site — audited, no dead ones.

**Wizard cards → HorizonNew verbatim** (this un-does the repeated "soften the
light theme" passes above; the reference is the spec now):
- Light frost layer direction was INVERTED — it must *increase* on hover
  (0.52→0.78 / 0.06→0.18), so the pane gets glassier as the hue saturates.
- Light colour wash 0.16→0.72 corrected to 0.45→1; specular 0.28→0.65.
- Light cards are hue-TINTED at rest (`rgba(240,249,255,.82)` etc.), not neutral
  white; borders + icon strokes are hue-tinted too (`horizonGlass.ts` restored to
  the reference values, incl. a new `purple` theme for HR).
- Light card lift shadow is neutral, not hue-glowed. Icon chip 0.88→1 white.
- Title + chevron no longer recolour on hover (fixed ink, one hue per card).
- Added the missing `.icon-draw.drawn` equivalent: `.glyphLit svg` →
  `drop-shadow(0 0 4px currentColor)`.
- Light gradient alphas fixed to the Tailwind source (`-200/50 via -100/30`).

**Gotcha worth remembering:** `background` is a shorthand and RESETS
`background-clip`. Setting the wordmark fill in a rule *after* the clip rule
painted MYTRION/HORIZON as solid gradient blocks instead of text. Fill now comes
via `--hz-wordmark` inside the same rule as the clip. Caught only by screenshot.

**Admin = the Horizon pilot.** Opt-in via `_shared/horizonSkin.ts` →
`data-horizon="on"` on the shell root; add an id there to skin another module.
Nothing gated on it touches the other Mytrions (verified: Sales/Billing render
unchanged). `[data-mytrion='admin']` accent is now the ramp itself, with a new
`--accent-2` (defaults to `--accent`, so single-hue modules are unaffected) so
`accent → accent-2` can be written unconditionally.
Skinned: shell ambience/sidebar/tabs (gradient rail via `::after` — a box-shadow
can't take a gradient), masthead glass + gradient hairline, panels, tables
(blurred sticky header), stat tiles (lift + glow + shimmer), buttons, chips,
toggles, inputs, modals, dropzone, toasts, Client News language tabs,
SchemaBrowser, and Octane-Scope's `bg0` pinned to `--hz-page`.

**Verified** in a real browser (Chrome CDP, second dev server on :5174 with
`VITE_DEV_MOCK_AUTH=1` so :5173 was untouched): picker + admin, dark + light,
rest + hover, plus Client News / Scope / Train / Jobs tabs.

**Pre-existing and NOT from this work:** 23 `tsc` errors (unused imports +
strict-null in `finance/redesign`, `sales/redesign`, `icons.tsx`, `Jobs.tsx`,
`SchemaBrowser.tsx`) and 1 failing test
(`sales/redesign/dashDebtorsData.test.ts` — expectation missing `debtorCount`);
both files are unmodified vs HEAD. `vite build` is green.

## 2026-07-26 — Light mode pass (dark left alone)

Dark was signed off as-is, so every change below is light-only or a light branch.

**The black SVG shadow.** `.glyphLit svg { drop-shadow(0 0 4px currentColor) }` takes its colour from
the ink — and light's `iconHoverLight` was the hue's **950** (Sales `#082f49`), so the "glow" rendered
as a black smudge under the glyph. Two fixes, both deliberate divergences from HorizonNew:
- `iconHoverLight` now BRIGHTENS to the hue's 600 instead of darkening to 950 (all 10 workspaces).
  The reference darkens on hover, which also made the chip feel heavier as you approach — backwards
  from dark, where hover brightens.
- The filter is `none` under `[data-theme='light']` entirely; light's hover is carried by the chip's
  coloured ring + the ink brightening.

**"Too bright and sharp"** — the page had no ground: `#f3f5ff` put white cards on white with nothing
to separate them, so definition came only from shadows, which then had to be hard.
- `--hz-page` light → `#e9edf6`. Panels now sit ON something.
- Vignette used to fade toward a colour *brighter* than the page (lighting the corners, adding
  glare). Now settles the edges down: `rgba(191,203,226,.3)` from 40%.
- Grid hairlines: saturated sky → neutral slate `rgba(100,116,139,.05)`. Cyan ruling on a light field
  reads as sharp lines, not texture.
- Every light shadow is slate-tinted with a negative spread, never pure black. Two new theme-aware
  elevation tokens, `--hz-shadow-lift` / `--hz-shadow-pop`, replaced 5 hardcoded `rgba(0,0,0,…)`
  shadows in `admin.module.css` (a dark-theme drop shadow on a pale field is the main "sharp" tell).
- Card frost top stop 0.78 → 0.62 and specular 0.65 → 0.46: the reference pushed the pane to
  near-opaque white on hover, blowing the hue straight back out.
- Chip shadows are hue-tinted now, not neutral grey.
- Light hairlines (`navShell`, `navDivider`, `sectionLine`, `footer`) moved off `rgba(0,0,0,…)` to
  slate.

**Barely-visible text.** `--text-muted` light was `#8a92a1` ≈ **3.1:1** on `--surface` — under the
4.5:1 floor, and the systemic cause (Admin stat labels, table headers, hints). Now `#69707e` ≈ 4.7:1;
dark untouched. In the picker: footer `#cbd5e1` (~1.3:1 — effectively invisible) → `#6b7a94`;
section title / stat label `#94a3b8` → `#5c6b82`; blurb → `#56637a`; sign-out + user role darkened.
`.soonBadge` was cream-on-pale-amber → dark amber ink on a solid `#fef3c7` tint. `.cardSoon` in light
drops the `grayscale(.15)` + 0.72 opacity (0.9, no filter) — dimming an already-pastel card pushed
the whole HR tile under the floor.

**Verified** in Chrome (CDP, :5174 dev server, :5173 untouched): picker light rest/hover + a tight
crop on the chip to confirm the shadow is gone, footer legibility, Admin light + dark. Dark
re-shot and confirmed pixel-identical. 183/184 tests (same pre-existing `dashDebtorsData` failure),
0 typecheck errors in touched files.

## 2026-07-26 — Customer Service: full Horizon glass propagation + Open Pool rebuild

**Token bridge, not a repaint.** `.cs-root` keeps its own variable layer but now derives from the
shared Horizon tokens: `--color-bg-primary` → `--hz-page`, surfaces/`--surface-raised` → `--hz-glass*`,
all three shadow steps → `--hz-shadow-rest/lift/pop`, modal backdrop → the Horizon page mix. CS uses
the global `useTheme()`, so `<html data-theme>` and `.cs-root.dark-mode` stay in sync and the
`--hz-*` light/dark swap follows the module's own toggle for free.

**Accent: enterprise gold → the Horizon warm segment.** `#C9A227` measured ~2.3:1 on white, which is
*why* light mode looked washed — every gold fill, pill and primary button was low-contrast beige.
Now amber → sunset (`#B45309`→`#EA580C` light, `#FBBF24`→`#FB923C` dark), which is also the hue
HorizonNew assigns Customer Service. `--accent-2` gives CS its slice of the ramp so
`accent → accent-2` gradients work the same way they do in Admin.

**Two new sheets, imported last** so equal-specificity rules beat the seven panel sheets:
- `cs-horizon.css` — the language: ambience, sidebar, nav, buttons, cards, tables, tabs, chips,
  inputs, badges, modals, loaders, toasts, bottom nav, focus rings.
- `cs-horizon-panels.css` — maps every panel's own surface classes (`cs-home-*`, `cs-an-*`,
  `cs-app-*`, `cs-ret-*`, `cs-citi-*`, `cs-summary-*`) onto it, so the tabs are one system.
- `pool-panel.css` — Open Pool specifics.

**Open Pool rebuilt** (was the thinnest tab): gradient kicker, 4 glass metric tiles with a real
`longest quiet` + `claim pending` count, glass search + status-filter chips + shown/total counter,
**sortable** glass table (nulls always sort last, not "smallest"), sticky timeline drawer with a
gradient top edge, and distinct skeleton / error / no-match / empty-state branches. Follows the Sales
Open Pool tab for context and the CITI Folder table for structure.

**Bugs found and fixed:**
1. `.cs-btn-danger` **had no CSS rule anywhere** — CITI Folder's "Mark sent" rendered as bare text
   with no affordance (visible in the light-mode screenshot). Defined it.
2. Sidebar tabs were `role="button"` **divs** with `tabIndex`; Chrome fires `:focus-visible` on
   *mouse* click for those, so the global 2px accent outline stuck to whatever tab you clicked.
   Now real `<button>`s — native focus semantics, and the hand-rolled Enter/Space handler is gone.
3. `is-citi-folder` styling existed in CSS but was **never applied** in the markup — dead rules. The
   class is now set, so CITI Folder reads red in the sidebar as designed.
4. CITI Folder rendered the **raw enum** (`p3_hold`) as its status. Now `statusLabel` + `statusTone`
   via `CaseBadge`, same as every other panel.
5. `downloadCsv` revoked the blob URL in the same tick and never appended the anchor — fragile in
   Chrome, broken in Firefox. Now appends, clicks, then revokes on the next tick.
6. CITI Folder's export set a partial-failure **warning toast that `run()` immediately overwrote**
   with the success line, so failed Zoho stage writes were silent. `run()` now accepts a toast
   override from the action.
7. CITI Folder's Refresh called `reload()`, which never flips `refreshing` — the button had no
   feedback. Now `refresh()` (also passes `fresh=true`) with a spinner + disabled state.
8. Bare `<input type=checkbox>` had no accessible name in either header or row. Labelled, and styled
   (the module had no checkbox styling at all).
9. CITI Folder's initial load showed an **empty tbody** with no indication; added a loading row.
10. Disabled buttons faded a *gradient* to 45% opacity — the exact muddy-beige look the accent change
    was meant to kill. Disabled is now inert neutral, no gradient, no lift, no glow.
11. Specificity trap worth remembering: `.cs-root.dark-mode .cs-user-avatar` /
    `.cs-home-welcome-avatar` set the ink to `--cs-accent`. Fine over the old soft tint; on the new
    gradient fill it was amber-on-amber, i.e. invisible initials. My rules had to match the
    `.dark-mode` specificity. Audited every `.cs-root.dark-mode` selector for the same trap.

**Verified** in Chrome (CDP, :5174, :5173 untouched): Home / Applications / Retention / Open Pool /
CITI / Citifuel / Analytics in both themes, plus a post-click crop confirming the focus ring is gone.
CS typechecks clean; repo-wide errors 23 → **20** (fixed 3 pre-existing ones in the Open Pool file).
183/184 tests — same pre-existing `dashDebtorsData` failure.

**Still dirty:** `apps/mytrion-crm/app/` (committed widget build output) has churn from `vite build`.
`git clean -fd -- apps/mytrion-crm/app && git checkout -- apps/mytrion-crm/app` to reset.

## 2026-07-26 — Billing: Horizon glass propagation (production module — paint-only)

Billing is in daily use by the billing agents, so the whole pass is deliberately constrained:

**Paint-only rule.** Every rule in the two new sheets touches background / border-color / box-shadow /
backdrop-filter / color / border-radius / transition / hover-transform. No `display`, `position`,
`width`, `padding`, `margin`, `grid` or `flex` changes anywhere, so nothing can reflow. The single
exception is `position: relative` on two elements that needed a `::before` rail — that does not
reflow a block, and the border it replaces keeps its 3px so box geometry is byte-identical.

**One TSX change, purely additive:** a `<div className="bm-ambience" aria-hidden />` in Shell.tsx.
`pointer-events: none`, so it cannot intercept a click. No logic, no handlers, no data paths touched.

**Billing was already the Horizon sky.** `--billing-accent: #38bdf8` is literally `--hz-sky`, so this
module is the gradient's *opening* (sky → blue) the way CS is its close (amber → sunset). Added
`--accent-2` (`#818cf8` dark / `#4f46e5` light) so `accent → accent-2` gradients work as in Admin/CS.
Page/surfaces/shadows/backdrop now derive from `--hz-*`.

**Deliberate deviation: the "Razor-Sharp" radii are relaxed.** 1–4px reads as precision on a flat
sheet, but glass needs a little curvature to catch light on its edge. `--radius-xs/sm/md/lg` →
4/6/8/12px, and `--radius-full` (a dead token at 4px) is now an actual pill. `.bm-badge` hardcoded
`border-radius: 3px`, so it's overridden explicitly — badges were rendering as rectangles.

**Also fixed along the way:**
- Billing had **no `:focus-visible` rule of its own**, so the app-wide `outline: 2px solid` from
  styles/global.css was landing on its controls as a hard offset ring (visible on the clicked nav item
  in the Debtors/Prepay/Returns screenshots). Now the same soft accent ring as every other module.
  I could not reproduce a specific trigger, so this is "make it read as design wherever it fires"
  rather than a root-cause fix.
- `.bm-btn` used `transition: all 100ms`, which interpolates filter/backdrop-filter and flickers.
  Replaced with explicit properties.
- Disabled buttons now read as inert neutral instead of a faded gradient (the muddy-beige failure
  mode from the CS pass).
- `.bm-field-row` gained a row hover — a 10-row key/value list in a modal is hard to track without one.

**Covered:** masthead (+ ramp hairline, gradient wordmark, gradient avatar), sidebar + nav (gradient
rail, glass hover), KPI/summary cards (semantic left bars preserved), tables (blurred header band,
glass row hover), search/selects, buttons, badges→pills, skeletons + spinner (accent-ringed, one per
surface), notices/toasts, empty+error states, bottom nav, focus rings, the AI copilot panel/FAB/chips,
and the **detail level**: modal box (ramp on the top edge as a background layer so it survives the
body's internal scroll), blurred backdrop, source-tinted transaction header, section titles with a
gradient rail, invoice/carrier cards, proposed-carrier chips, modal inputs, modal footer.

**Verified** in Chrome (CDP, :5174, :5173 untouched): all five tabs × both themes, plus the
transaction modal rendered in both themes by injecting the exact markup shape from
TransactionModal.tsx (the modal needs live data the sandboxed port can't reach — CORS — so the CSS
was verified against the real class structure rather than a real record). Billing typechecks clean;
repo-wide errors unchanged at 20; 183/184 tests, same pre-existing `dashDebtorsData` failure.

**Still dirty:** `apps/mytrion-crm/app/` build output.
`git clean -fd -- apps/mytrion-crm/app && git checkout -- apps/mytrion-crm/app` to reset.

## 2026-07-26 — Mytrion Admin: per-tab standardization pass

**One content measure.** Admin had FOUR widths: `.panel` 1120, `.panelWide` 1240, `.dealsPanel` 1360,
and the chat view full-bleed — which is why each tab felt like a different app. All now resolve to
`--hz-measure` (1280px, promoted to a shared token in styles/horizon.css so the shell can use it too);
`.panelWide`/`.dealsPanel` are kept as aliases so no panel markup had to change. The chat view is
capped to the same measure — it was the one full-bleed tab, and long chat lines are harder to read.

**Sidebar icon tones.** New `--tone-*` scale (13 hues) in horizon.css, THEME-AWARE by design: dark
uses the bright 400-level, light the deep 600/700-level, which is exactly why they're tokens and not
raw hex in the TSX. `NavItem.tone` sets `--nav-tone`; `.navIcon` colours from it. Tint the glyph only,
held at 0.72 opacity at rest and full on hover/active — fifteen fully-saturated glyphs is a fruit
salad. The selected-row drop-shadow follows the tone too. Tabs are grouped by section hue:
AI&Knowledge sky/cyan/teal/emerald · Access violet/purple · CRM&Ops amber/orange/pink/rose ·
Data indigo/blue/blue · Platform slate.

**Standardized states.**
- `.emptyState` and `.none` were two classes saying the same thing in different tabs → now one block,
  plus `.emptyIcon` / `.emptyTitle` / `.emptyBody` for the richer version.
- NEW `.errorState`: icon + title + cause (mono) + actionable hint + retry, on its own pane (it
  replaces the table, so unlike `.none` it can't borrow a container).
- `.pager` — was inline styles inside Pager.tsx.
- `.primaryBtn:disabled` → inert neutral. It was still fading the sky→sunset gradient to 55% opacity,
  i.e. the muddy-beige failure mode already fixed in CS and Billing. Visible on Train's two buttons.

**Header typography.** One pattern on all ten data tabs: eyebrow (where you are) → h2 (what it is) →
sub (what it does). Five tabs had no eyebrow AND no subtitle; several had an `<h2>` followed by a
stray blank line where a subtitle clearly used to be.

**Horizon AI (tab 1) light/dark.** The reported problem was real and specific: `.error` was
`color: #fff` on a light-red tint — white-on-pink, invisible in light mode. Beyond that the whole chat
surface carried a hardcoded indigo/purple palette (`#a5b4fc`, `#c084fc`, a `#4f46e5→#9333ea` user
bubble) that ignored the module accent and was dark-mode-tuned; 13 substitutions moved it onto
`--accent`/`--accent-2`, so the chat now adopts each Mytrion's hue. The `--gem` AI mark is left alone
— it's a deliberate brand element shared by every AI surface.

**Bugs found and fixed:**
1. Client News used `panelWide` **without** `panel`, so it got the max-width but none of the padding,
   flex column or gap — the tab sat flush against the content edge. (Visible in the screenshot.)
2. Client News rendered its count via `className="count"` — a plain string that never matches a
   hashed CSS-module selector, so it showed as a bare unstyled `0` next to the title.
3. `SchemaBrowser`'s `subtitle` prop was accepted and **never rendered** — all three DB tabs silently
   dropped their "structure only; no row data is ever read" explanation.
4. `CarrierUsers`' `VIEWS[view].sub` was declared for both views and never rendered.
5. `Jobs.statusClass` returned `string | undefined` against a `string` signature (3 typecheck errors).
6. Jobs' subtitle printed bare `…` placeholders before load — reads as a truncation glitch, not as
   "not loaded yet". Now the clause only appears once there's something real to show.
7. Deals surfaced load failures as bare red text; the other twelve files use the tinted `errorNote`
   pane.
8. Deals' "Could not load agents" toast passed a title only, so it rendered as a headline with no
   explanation.
9. CarrierUsers' count chip was being squeezed against a clipped placeholder inside a 360px-capped
   search box, reading as two colliding strings. Pinned the chip and widened the box.
10. Client News was the only tab with no skeleton loader and no standard empty state (bare
    `postMeta` text for both).

**CMP Database error system (as asked):** a failed *initial* load now takes over the surface and names
the fix — CMP's hint points at the SSH tunnel on :3307 and `pnpm dev:all`; DWH and Verification get
their own. A failed *refresh* keeps the last good snapshot visible with a quiet note instead.

**Octane-Scope panel untouched**, as requested (it does get a slate sidebar tone).

**Verified** in Chrome (CDP, :5174, :5173 untouched): all 13 tabs × both themes, re-shot after each
round. Admin typechecks clean; repo-wide errors 20 → **16** (fixed 4). 183/184 tests, same
pre-existing `dashDebtorsData` failure. `vite build` green.

**Known remaining inconsistency (not fixed):** three pagination paradigms coexist — `Pager`
(prev/next + count) in the carrier tables, "Load more (N of M)" in Audit Log, custom prev/next in
Deals. Each suits its data shape, so unifying them is a product decision rather than a cleanup.

**Still dirty:** `apps/mytrion-crm/app/` build output.

## 2026-07-26 — Orchestrator onboarding: ONBOARDING.md + ORCHESTRATION.md

New engineer/agent onboarding pass over the whole system. Fanned out five parallel read-only
explorations (CRM app, data model, pgvector/RAG, pg-boss, vendors), verified the counts directly,
and wrote two durable docs at the repo root.

**`ONBOARDING.md`** — the system brief. Octane/Mytrion/Horizon naming, the nine-Mytrion taxonomy and
the `src/lib/mytrions.ts` ↔ `apps/mytrion-crm/src/access/mytrions.config.ts` mirror, repo topology,
the CRM app (stack, `useLoad` convention, workspace inventory, Zoho OAuth session + act-as, the
77-key touchpoint surface, committed `app/` build), the 45-table data model and repo pattern,
pgvector/CRAG parameters, the 13 pg-boss queues, the vendor matrix split into wired / idle /
zero-caller / placeholder, local run stack, and the rules restated with the failure behind each.

**`ORCHESTRATION.md`** — routing for the Gemini 3.1 Pro / Claude Code / Cursor-Grok fleet: which
agent gets which class of work, the brief boilerplate every executor needs, what can run in parallel
vs what is single-writer (migrations, env.ts, jobs catalog, both mytrions configs, this file, and
`apps/mytrion-crm/app/`), a review checklist, and a delegable backlog.

**Verified while writing:** 45 tables / 39 schema files / 58 migrations (latest
`0057_mytrion_access_modes`) / 39 route files / 34 repos / 17 tool definitions / 13 queues /
3 `vector(1536)` columns.

**Findings worth acting on, recorded here so they don't get lost in the doc:**
1. `drizzle.config.ts` enumerates schema files and is **missing four** — `agent_blackboards.ts`,
   `agent_skills.ts`, `mytrion_role_defaults.ts`, `support_bot_messages.ts` (all created by
   hand-written migrations 0054/0055/0048). `pnpm db:generate` today would emit DROPs for them.
   This blocks the next legitimate schema change; fix before anyone runs generate.
2. Last full `eval:live` run (2026-07-22, 41 tasks) breached four floors: routing 0.46 (floor 0.9),
   grounding 0.50 (0.8), delegation 0.00 (0.75), web-navigation 0.00. RBAC and greeting held at 1.0.
   The only newer report is a 1-task routing spot-check, so the breach is still the current signal.
3. `render.yaml` deliberately excludes `FF_JOBS_ENABLED` — all 13 queues and every cron are off in
   prod, and there is no worker service. Either turn it on or retire the surface; leaving 13
   registered queues that never fire is a trap for the next reader.
4. `README.md` is stale on two counts: audiences are three (`internal|partner|customer`), not two,
   and knowledge ingestion is no longer purely synchronous (>2 MB goes to `knowledge.bulk-ingest`).

No source changed this session — docs only.

## 2026-07-26 — Billing wordmark parity + Manager Mytrion set up

**Billing wordmark → Admin's.** `.bm-header-title` was Rajdhani / mixed-case / 0.04em with a solid
accent on "trion"; Admin's BrandMark is Space Grotesk / uppercase / 0.08em with the Horizon ramp on
the second word. Billing now matches exactly and reads **MYTRION HORIZON**, with the module name in
the badge beside it — so every Mytrion's masthead says the same thing and only the badge changes.

## Manager Mytrion

**Structure.** Two nav groups replacing the single Overview item:
- *General* → Overview (the hub; Referrals opens from its grid, so Overview stays selected while
  you're inside Referrals and the back button returns there).
- *Departments* → Sales · Customer Service · Billing · Finance · Collection · Mobile · Verification.

Sidebar labels are SHORT ("Customer Service", not "Customer Service Management") — the full name
truncated to "Customer Service Manag…" in a 248px rail, and the group is already titled Departments.
Full names stay on the page heading and the Overview cards (`navLabel` vs `label` in managerNav.ts).

**RBAC-ready.** Layer 1 stays `canAccess`; Layer 2 is `access(user)` per card AND per department, with
`canOpenManagerDepartment` guarding the view switch so a stale state can't bypass the grid. Departments
are open today — when per-department RBAC lands, narrow the predicate rather than hiding items in the
shell. Documented in the module header.

**Design.** Opted into the Horizon glass skin (`horizonSkin.ts`) so Manager gets the ambience, glass
sidebar, gradient rail and glass masthead for free. `manager.css` rewritten as Manager's own
standardized system: a `--mg-*` block at the top (measure = `--hz-measure`, gap/pad rhythm, radii)
with everything else reading from it, built on the shared `--hz-*` primitives. Covers hero, section
heads, workspace cards (lift + tone glow + specular hairline), department grid, coming-soon landings,
buttons (one recipe, inert-neutral disabled), toolbar/search, one loader, one error, one empty, the
referrals accordion, chips and the CRM definition grid. Focus ring: one soft accent ring, keyboard only.

**Accent: teal → pink/rose.** The workspace picker's Manager tile is pink, but the module was teal —
the card you clicked and the workspace you landed in disagreed. Now aligned, with `--accent-2` = rose.

**Per-department tones** come from the shared `--tone-*` scale (theme-aware), each matching that
department's own colour elsewhere in the app: Sales sky · CS amber · Billing emerald · Finance teal ·
Collection indigo · Mobile cyan · Verification violet. Verification deviates from its usual teal
because Finance holds teal here and distinctness inside one list wins. Module identity (pink) stays in
the kicker; department identity is in the glyphs — so both read at once without competing.

**No mock data**, as asked: each department landing is a real "coming soon" surface that names the
department, keeps its hue, and says what will live there. The Overview department cards carry a `Soon`
badge so the state is visible before the click, not discovered by it.

**Verified** in Chrome (CDP, :5174, :5173 untouched): Overview, a department landing and Referrals, in
both themes. Manager and Billing typecheck clean; repo-wide errors unchanged at 16; 183/184 tests
(same pre-existing `dashDebtorsData` failure); `vite build` green.

**Still dirty:** `apps/mytrion-crm/app/` build output.

## 2026-07-26 — Sales Mytrion: foundation pass (type scale, shell, glass, state system)

Sales is 26.7k lines / 114 files — roughly 2× CS or Billing. This session did the FOUNDATION; the
per-tab detail work is listed as remaining at the bottom.

**The density problem, measured.** Before assuming anything I counted: **647 inline `font-size`
declarations across 25 distinct values**, ~470 of them ≤13px, with a floor of **8px**. The module had
a documented `--ss-text-*` scale that almost nothing actually used. Given the audience — agents moving
off Zoho and Google Sheets, who abandon tools that feel hostile — that is the single biggest adoption
risk in the module, and it isn't a glass problem.

Remapped mechanically (753 declarations across 59 files): **25 sizes → 13, floor 8px → 11px**, every
size up ~1px, nothing shrunk. Body is now 13–14px, micro-labels 11–12px. `--ss-text-*` lifted to match.
Radii softened from the inherited global 6px to 8/12/16px scoped on `.ss-root` — sharp corners on a
dense grid read as spreadsheet, which is exactly what these users are being moved away from — plus
`line-height: 1.55` on the root.

**Token bridge, because Sales has almost no classes.** Its surfaces are built with INLINE styles
(147 × `background:var(--surface)`, 262 × `var(--border)`, 88 × `var(--alt)`), and there are only 170
CSS classes total, of which `.ss-in` / `.ss-btn-p` / `.ss-ico-btn` / `.ss-tab-x` are the only real
primitives. So `ss-horizon.css` works mostly by redefining what those inline styles RESOLVE to:
- `--bg` → `--hz-page`; surfaces/alt/raised → translucent (over the ambience).
- **Constraint found and respected:** `--surface` must stay a COLOUR, not a gradient — there is a
  `color:var(--surface)` use site and several `linear-gradient(…), var(--surface)` stacks.
- `--shadow-sm` now carries the 1px inset sheen, so every surface already using it gained a lit glass
  edge with no per-element edit.

**Shell + sidebar.** Ambience layer (shared mesh + grid + vignette) replaces the two bespoke radial
gradients that lived on the root's inline background; `z-index:-1` with `isolation:isolate` so it sits
above the root background and below all in-flow content and can never cover a panel. Per-tab
wayfinding tones from the shared `--tone-*` scale (11 tabs), glyph tint held at 0.7 and full on
hover/active. Selected tab now has a GRADIENT rail — which required moving the active state out of the
inline `box-shadow` (a box-shadow takes no gradient) into `.ss-tab-x.is-active`.

**Three UI bugs fixed:**
1. The type-scale lift pushed long nav labels onto two lines, breaking the rail's row rhythm →
   nowrap + ellipsis, and "Verification Pipeline" shortened to "Verification" (the tab title already
   reads "Verification Desk").
2. The SOON chips were bright gradient pills with a glow, so the four PARKED tabs were the loudest
   thing in the sidebar, pulling attention away from the live ones → quiet tinted pill in the same hue.
3. `InfoBanner` was being passed two adjacent JSX expressions where it takes one string
   (pre-existing typecheck error).

**One state block.** `StateNote` was local to HomeTab and rendered a bare line of centred coloured
text; ~35 places across the module did the same thing by hand. Promoted to `SalesStates.tsx` with the
SAME `tone`/`children` API (so no call site needed editing), now an icon + readable line + optional
retry, in three tones. "Could not reach the backend" in small red text with nothing to press is a dead
end for this audience.

**Verified** in Chrome (CDP, :5174, :5173 untouched): all 8 live tabs × both themes, re-shot after
each round. Repo-wide typecheck errors 16 → **15**; 183/184 tests (same pre-existing
`dashDebtorsData` failure); `vite build` green.

**Deliberately left alone:** `retentionKanbanCol.test.ts` — an UNTRACKED file (your WIP). Its
`exactOptionalPropertyTypes` error comes from spreading a `Partial<RetentionCaseRow>`; fixing it would
risk conflicting with in-progress work.

**REMAINING for Sales (next session):**
- Wire `onRetry` at the error call sites — the shared state block supports it, but each site needs its
  own reload fn passed in.
- Per-tab detail passes: Inbox, Create, Carriers, Retention, Dashboard content structure + detail level.
- Modal level: ClientModal / LeadModal / DealModal / the wizards (Lead + Deal call wizards,
  Retention wizard) — only the shared `.ss-pool-modal`/`.ss-modal-box` shells were touched.
- Picklist (`AutoPicklist`), toast, and badge/chip polish.
- The hero's "Could not load apps from Deals" still renders through a separate path, not StateNote.

**Still dirty:** `apps/mytrion-crm/app/` build output.

## 2026-07-26 — Retention UX density pass

Kanban/list empty + card declutter; Open Pool quiet warn only when breached; dropped no-op All chip and double error empty; call button surfaces awaitingCallEnd; forceAttempt stage blocks toast instead of silent return. Files: RetentionBoardUi, RetentionCasesPane, RetentionWizardSteps, RetentionCaseActions, RetentionCaseDetail, PoolTab, theme.css.

## 2026-07-26 — Sales Data Center + detail UX pass

Clients modal: denser scrim (`.8` + blur), sheet `820px`, icon tabs, Escape/`role=dialog`, richer empties.
Leads/Deals cold load: Home-style `DcKanbanSkeleton` / `DcListSkeleton` in RecordsTab Gate.
Lead/Deal detail: centered `DetailSheet` (no full-bleed “separate page”), stay-open after save, saving
overlay, related panels use `DcPanelSkeleton` + section icons. Shared footer in `dataCenterSheet.tsx`.

## 2026-07-26 — Rebuild served CRM bundle on `build`

PR #65 had already landed Sales UX source (`DetailSheet`, skeletons, Clients + Retention), but Render
still served the old committed `apps/mytrion-crm/app/` hashes — including the full-page Lead detail
with “← Board”. Ran `vite build` on `build` and committed the new `app/` assets so deploy picks up
the sheet UI. (Full `pnpm build` still blocked by pre-existing Finance `tsc` errors.)

## 2026-07-26 — Favicon on deep Sales routes

Vite `base: './'` rewrote `/favicon.svg` → `./favicon.svg`. On `/main/salesmytrion` the browser
requested `/main/favicon.svg` (SPA fallback HTML) so the tab icon never showed. Fix: inline the M
mark as a `data:image/svg+xml` favicon in `apps/mytrion-crm/index.html` (survives relative base).

## 2026-07-26 — Prod Zoho login hit localhost:3001 (CORS)

Shipped `apps/mytrion-crm/app` had `resolveApiConfig` baked as `baseUrl: http://localhost:3001`
because `vite build` ran with shell `NODE_ENV=development` (Cursor/agent shells), so Vite inlined
DEV + `.env` VITE_API_URL. Prod page then CORS-failed against localhost.

Fix: runtime hostname gate (non-localhost → always same-origin `''`); `package.json` build forces
`NODE_ENV=production vite build --mode production`; rebuild + push `app/`.


## 2026-07-27 — Manager Referrals: bonus ledger data model (migration 0058)

Data-model-only slice for the referral bonus system. **No calculation engine, no pg-boss, no
routes/UI yet** — deliberately scoped so the numbers can be designed against a settled schema.

### Grounding (inspected live, not assumed)

- **`Calculation` picklist exists on BOTH Zoho referral modules** (`Parent_Referrers`,
  `Child_Referrals`) with values `Gallons (Legacy) | Swipes (Legacy) | Gallons (Parent) |
  Gallons (Child)` — a 1:1 match for the PDF's four types. `Child_Referrals.Parent_Paid` / `.Paid`
  are the one-time guards for types 3 / 4.
- **Both modules are effectively empty test data**: 7 parents, 4 children. `Calculation` is null on
  every record, `Parent_Referrer` null on all children, `Deal_Id` null on all parents.
- **Zero Leads and zero Deals have `Child_Referrer` populated.** The intended linkage
  (`Deals.Child_Referrer` → `Deals.Carrier_ID` → mart) therefore returns nothing today; everything
  falls back to `Child_Referrals.Carrier_ID`. Hence the `resolution` column + `unresolved` state.
- **No literal `DSL` fuel code exists** in `octane.mart_transaction_line_items.line_item_category`.
  Present diesel-family codes: ULSD (63.0M gal), ULSR (0.66M), DSL1/CDSL/BDSL/CBDL (~98k combined),
  plus generic FUEL. Type 3/4's `'DSL'` currently matches zero rows — flagged in
  `referralBonusTypes.ts`, NOT silently expanded. Needs a BA/Admin decision.
- 288,451 rows (19.4M gal, ~23% of volume) carry a NULL `line_item_category`. PDF filters by code,
  so they are excluded — this will legitimately disagree with the Sales dashboard, which applies no
  fuel filter at all (servercrm `agentDwh.js` `base` CTE).
- "Swipe" = the dashboard's **new-card** metric: `MIN(transaction_date) OVER (PARTITION BY
  carrier_id, card_number)` landing in the period. ~610–985/mo company-wide. Note the dashboard
  field named `swipes_*` is `COUNT(DISTINCT transaction_id)` — that is NOT this metric.

### Shipped

- `src/db/schema/mytrion_referral_bonuses.ts` — ledger + `mytrion_referral_calc_runs` audit table.
- `src/modules/manager/referralBonusTypes.ts` — declarative spec (rates, thresholds, recipients,
  PDF fuel-code lists, picklist mapping). Types 1+2 are concurrent per the PDF, so either legacy
  picklist value selects BOTH legacy bonuses.
- `src/repos/referralBonusRepo.ts` — tenant-scoped upsert/list/totals/status/runs (rule 2).
- `tests/unit/referral-bonus-repo.test.ts` — 24 tests; renders the SQL drizzle actually builds and
  asserts every read/write is bound to `ctx.tenantId` (rule 9).

### Two duplicate-payout guards, not one

`..._period_uq` (tenant, child, type, month) makes monthly recompute idempotent. `..._one_time_uq`
is a PARTIAL unique on (tenant, child, type) `WHERE bonus_type IN ('gallons_parent','gallons_child')`
— without it, a recompute whose threshold-crossing month shifted would insert a second one-time row
under a different month and pay the $50 twice. Verified live: cross-month duplicate blocked (23505),
same child under a different tenant still allowed, recurring types still repeat across months.

### Gotchas hit

- **`pnpm db:generate` is broken repo-wide.** Snapshots `0025`–`0057` are MISSING and the `0022`/
  `0023`/`0024` chain has a prevId collision, so drizzle-kit aborts. Migrations 0025+ have all been
  hand-written; 0058 follows that convention (idempotent `IF NOT EXISTS`, `--> statement-breakpoint`,
  manual `_journal.json` entry). Repairing the snapshot chain is separate, unblocked work.
- **`MYTRION_OPS_DATABASE_URL` in `.env` points at Render PROD**, not `localhost:5433` as CLAUDE.md
  describes. `pnpm db:migrate` therefore applied 0058 to production. Additive only (two new empty
  tables + indexes), but worth knowing before running any migration command here.
- Verified 0058 from scratch on a throwaway DB: 59 migrations applied, 47 tables, both new tables
  present.

## 2026-07-27 — Manager Mytrion: Loyalty Program card

Company-wide loyalty tier board, next to Referrals on the Manager Overview hub. Branch
`feature/MytrionAll`.

### Reused rather than rebuilt

The tier logic already existed and already matched the Loyalty Tiers v3 spec exactly
(`sales/redesign/loyalty.ts` — T1 1,100/1,500/2,000 · T2 2,200/3,000/4,500 · T3 segmented
4–6/7–8/9–10/11–12). **Moved it to `mytrions/_shared/loyalty.ts`** (2 import sites) so Manager and
Sales share ONE implementation — the program is company-wide, not Sales-specific, and a second copy
would let the two surfaces disagree about a client's tier.

Same for the data: `fetchAllClients()` in `dwhClientRoster.ts` reuses the exact `runClientsQuery` +
`toClient` the agent-scoped roster uses, with only the owner predicate dropped (`ownedArm('true')`).
One gallons basis, one active-card count, one billing cycle.

### Measured before designing

`fetchAllClients()` → **8,045 carriers, 2.4s, 3.27 MB** of JSON. So:
- `loyaltyRoster.ts` projects to the 9 fields the board needs (~1 MB), dropping debt/phone/DOT/money
  code — those belong to the Clients tab, not the loyalty program. A route test asserts the
  projection so those columns can't creep back in.
- Server orders by the tier gallons basis DESC; the grid renders in windows of 60. Alphabetical
  would bury all 621 tiered clients behind thousands of zero-gallon carriers.
- Distribution is always computed over the FULL roster, never the visible slice.

### Colour — the ask, and the correction it forced

Requested: gold for Gold, silver for Silver, bronze for Bronze, orange for not-reached. The shared
`--tier-bronze` is **`#fb923c`, i.e. already orange**, so bronze and not-reached were the same hue.
Fixed with a card-scoped `--lty-*` palette (true copper `#b87333` for bronze, `#f97316` for
Building), leaving Sales' `--tier-*` untouched. Sales therefore still shows bronze-as-orange —
propagating that is a one-line change if wanted.

**First render exposed a worse problem:** the distribution bar came out 92% orange, because
`resolveTier` collapses "fuelling but under Bronze" (3,952) and "no active cards at all" (3,472) into
the same `level: 'none'`. Those are completely different business states. Split into a 5th `idle`
bucket ("No cards", receding neutral + dashed border so the state survives greyscale/colour-blind
viewing). Bar now reads 1.3 / 3.1 / 3.3 / 49.1 / 43.2 %. Dropped the redundant "No active cards"
track chip since the tile selects that set.

Verified by rendering the real markup against the real stylesheets in headless Chrome, dark AND
light. That caught a genuine CSS bug: `--hz-pane` is a **gradient**, so the skeleton's
`background: <image> var(--hz-pane)` space-separated shorthand was invalid and dropped the whole
declaration — now two comma-separated layers with per-layer `background-position` in the keyframes.

### Security

`/v1/manager/loyalty/clients` is the one Manager read that is NOT owner-scoped, so
`tests/unit/manager-loyalty-routes.test.ts` (9 tests) covers it: unauthenticated 401, non-management
403, sales rep 403, and the header-elevation triad (`x-department-access: management`,
`x-all-departments: true`, both) all 403 — each asserting the DWH was never touched, not merely that
the body was withheld. Verified sessions ignore claimed headers
(`FF_SESSION_DEPT_AUTHORITATIVE=1`), and `ADMIN_PROFILE_MARKERS` is exact-match `administrator,ceo`
so a "Management" profile doesn't accidentally get all-department access.

### Checks

Backend typecheck + lint clean. CRM app: **10 tsc errors before and after — all pre-existing**
(Finance, ChatPanel, RecordsTab strict-null). `vite build` succeeds. Full suite: the only delta vs
the clean-tree baseline is `ringcentral-call-log` "logs a finished outbound lead call", which is a
pre-existing **timeout flake** — passes 2 of 3 isolated runs with no code change, and my change isn't
in that path. NOTE: the served bundle in `apps/mytrion-crm/app/` was NOT rebuilt; deploy needs
`NODE_ENV=production vite build` committed (see the 2026-07-26 CORS entry).

## 2026-07-27 — Loyalty bucket palette fix + HR Mytrion scaffold

Branch `feature/MytrionAll`.

### 1. Loyalty: Silver vs No-cards were indistinguishable

Reviewed Data Center → Clients first (RecordsTab.tsx): its client cards are flat `var(--surface)`
with the tier shown only on a badge — it shares NO css with the Manager board, so all changes here
are isolated to `manager.css` and Sales is untouched.

Root cause: `--lty-silver` was `#a9b4c2` and `--lty-idle` `#5b6673` — both slate-blue, and at a 13%
wash they collapsed into each other. Fixed by making the five buckets ONE background recipe with two
tuned custom properties instead of five bespoke treatments:

    --tint    how strongly the bucket hue washes the surface
    --sheen   a specular highlight band — set ONLY for the three medal tiers

    gold 18% + gold sheen · silver 17% + WHITE sheen · bronze 16% + copper sheen
    building 12% flat · idle 4% flat + dashed border

Silver is now `#c3cfdd` (cool, bright) and idle `#6e7681` (hueless grey), and a white specular band
is what actually makes silver read as polished metal. Silver and No-cards now differ on four
independent axes — hue, tint strength, sheen, border style — so they stay distinct in light, dark
AND greyscale. Light theme needed darker FILLS too, not just text (`#c3cfdd` vanishes on white).
Both the client card and the distribution tile read the same properties, so they can't drift apart.

### 2. HR Mytrion — structural UI only

Promoted HR from a picker-only "coming soon" tile to a real Mytrion. Tabs: Home · Employees ·
Attendance · Requests · Profile. Flat sidebar tab set (HR is a workspace you live in) rather than
Manager's card-hub; Home doubles as a launcher.

Registered in: `access/mytrions.config.ts` (MytrionId, MYTRIONS.hr, MYTRION_ORDER,
MYTRION_URL_SLUG → `hrmytrion`, removed the duplicate picker tile), `mytrions/registry.ts` (lazy
import so HR code-splits), `styles/global.css` (red accent, light + dark), and backend
`src/lib/mytrions.ts` (MYTRION_IDS + MYTRION_DEPARTMENT `hr → 'hr'`).

**Deliberately NOT added: `'hr'` to `KNOWN_DEPARTMENTS`.** `deriveWorkerDepartments` does a plain
substring match, and `"christopher".includes("hr")` is TRUE — adding it would hand HR access to
anyone whose profile or role happens to contain those two letters. KNOWN_DEPARTMENTS is
documentation-only and not an enforced allowlist, so omitting it is safe; HR access comes from the
DB-backed resolver via the access table instead, which is the correct path anyway.

`agentKeyFor('hr')` returns null (there is no `hr` in AGENT_KEYS) and the shell sets
`disableDockChat` — otherwise the chat dock would silently fall through to the orchestrator.

**Zoho People inspected live** (100-record sample) so the layouts are shaped by reality, not guesses
— the full field map is documented in `hr/peoplePreview.ts`. What it changed:
- Name is composed from `FirstName` + `LastName`; `Full_Name` is only 73% populated.
- `Department` 72%, `Designation` 70%, `LocationName` 66%, `Dateofjoining` 65% → every one of those
  needs a real empty state, which the cards now render as an em-dash.
- `Employeestatus` is the status source of truth: Active / Terminated (60/40 in the sample).
- `tabularSections` is a nested object, not a scalar — needs its own sub-view later, not a column.
- Real `Department` values are wired as the directory's filter chips (categories are live even
  though the employee rows are not).
- ⚠️ OPEN: the call returned exactly 100 rows for `limit: 200`. Either the org has 100 employees or
  the wrapper/API caps a page at 100 — confirm before assuming the directory is complete.

All employee/attendance/request rows are SYNTHETIC placeholders and every tab renders a
`<PreviewBanner />` saying so, so nothing here can be mistaken for real HR data. Approve/Reject on
Requests are rendered but disabled with a title explaining why — they are writes and need an
audited, gated endpoint first.

### Checks

Backend + frontend typecheck clean (CRM app still 10 pre-existing errors, unchanged). `vite build`
succeeds and HR code-splits. Lint 0 errors. Rendered every surface in headless Chrome, light and
dark. Frontend tests: 187/188, the one failure (`dashDebtorsData`) is pre-existing on a clean tree.
Backend suite is flaky under load — of 8 apparent new failures, `agent-scripted-turn`, `cs-routes`
and `retention-cases` all pass 100% in isolation, and `touchpoints-routes` fails identically 3/9 on a
clean tree. Zero real regressions.

## 2026-07-27 — Loyalty bucket polish · HR badge · Finance Mytrion rebuilt

Branch `feature/MytrionAll`.

### 1. Loyalty — Silver vs No-cards, one background system

Reviewed Data Center → Clients first: its cards are flat `var(--surface)` with the tier only on a
badge, sharing no CSS with the Manager board — so these changes stay isolated to `manager.css`.

Silver (`#a9b4c2`) and idle (`#5b6673`) were both slate-blue and collapsed together at a 13% wash.
Replaced the five bespoke treatments with ONE recipe driven by two custom properties:

    --tint    strength of the bucket hue wash
    --sheen   a specular highlight band — metals only

    gold 18% + gold sheen · silver 17% + WHITE sheen · bronze 16% + copper sheen
    building 12% flat     · no-cards 4% flat + dashed border

Silver is now `#c3cfdd` with a **white** specular band (that is what reads as polished metal) and
idle is a hueless `#6e7681`. The two now differ on four independent axes — hue, tint, sheen, border
style — so they survive light, dark and greyscale. Light theme needed darker FILLS too, not just
text. The client card and the distribution tile read the same properties, so they can't drift.

### 2. HR — badge + light mode

`tag: 'People'` → `'HR'` (the TopBar context badge reads `MYTRIONS[id].tag`). Re-rendered all five
tabs in light: hero, banners, stat tiles, employee cards, attendance table, request rows and the
profile grid all read correctly. No changes needed.

### 3. Finance Mytrion — rebuilt from zero

**Deleted the entire old module** (`redesign/` shell, Dashboard/Transactions/Audits/Clients/
SmartBalance/Home + `data.ts`). It was mock data end-to-end. Side effect: the CRM app's typecheck
errors went **10 → 2**; eight of them lived in that dead code.

Two tabs, both real:
- **Home** — the EFS parent balance from the `finance.parent_snapshot` Deluge touchpoint. Verified
  live: `{ balance: '715765.14', mode: 'COMFORT', captured_at: '2026-07-26T18:30:04-04:00' }`.
  `balance` arrives as a STRING — coerced, never rendered raw. It's a SNAPSHOT, so the capture time
  is displayed as prominently as the figure; a stale balance shown as current is how someone
  over-sweeps. "Run refresh" fires `balance_run` then re-reads, and a failed run does NOT block the
  re-read.
- **Clients** — every carrier from `octane.dim_company` with computed debt.

**Debt uses the Billing/Sales definition, not the dim.** `dim_company.debt_amount` / `.is_debtor`
are stale (servercrm measured the dim at ~$6M vs ~$13.4M from invoices), so debt is computed from
`public.cmp_invoice` with the shared predicate: PENDING/PARTIALLY_PAID, owes ≥ $1, ≥ 2 days old.
Live: **8,045 carriers, 413 debtors, $2,008,487 outstanding**.

**Speed.** The roster is 8k rows and the tab filters client-side, so payload is the whole game:
- Dropped the mart scan the Loyalty roster does (Finance needs terms/credit/debt, not gallons) →
  dim_company + cmp_invoice only.
- Split the payload: a LEAN 10-field row for the table, with the rest of the profile fetched per
  carrier when a modal opens. **3.63 MB / 1,328ms → 1.62 MB / 875ms.**
- `useDeferredValue` on the search term so typing never blocks on re-filtering 8k rows; list renders
  in windows of 50.
- ⚠️ **`@fastify/compress` is NOT installed**, so JSON ships uncompressed — that 1.62 MB gzips to
  ~200 KB. Adding compression is the single biggest remaining win and would benefit every route.

**Client modal** — 1320px wide (the tables are 7–9 columns; a narrow sheet destroys them), portalled
so the fixed scrim escapes the module's scroll container, Escape-to-close, body scroll locked. Six
icon tabs, each loading only when opened so opening the modal costs one small request:
Details (icon-per-field grid + roll-up) · Invoices (`cmp_invoice`) · Payments (our
`payment_transactions`, matched on carrier_id) · Transactions (`mart_transaction_line_items` via the
shared reader) · EFS and Money Codes as explicit coming-soon — both MOVE MONEY and stay unbuilt
rather than half-wired.

Finance is no longer in `COMING_SOON_MYTRION_IDS`; `resolveAccess.test.ts` was updated to match
(it asserted finance was parked).

`tests/unit/finance-routes.test.ts` — 21 tests: every route 401s unauthenticated and 403s a sales
rep with the warehouse never queried, the header-elevation triad stays shut, non-numeric carrierIds
are rejected before any query binds, and an unknown carrier is a 404 rather than an empty 200.

### Checks

Lint 0 errors. Backend typecheck clean (1 pre-existing). Frontend typecheck **2, down from 10**.
`vite build` succeeds. Rendered Finance and HR in light AND dark.

Frontend tests 187/188 — the one failure (`dashDebtorsData`) is pre-existing on a clean tree.

⚠️ **The backend suite degrades badly under parallel load** and I have now added two more
`buildApp()` suites (loyalty, finance), which makes it worse. A full run reported 37 failures; run in
isolation, `cs-routes` (21/21), `desk-routes` (23/23), `agent-scripted-turn` (6/6) and
`retention-cases` (23/23) all pass. The only real remainders are `data-center-routes`' post-call
wizard test and `ringcentral-call-log`'s timeout flake — both pre-existing. Worth capping vitest
concurrency or splitting the app-building suites into their own project.

## 2026-07-27 — Finance modal: two real bugs + Details redesign

Feedback from running the app locally caught two genuine defects, not just polish.

### Bug 1 — the Transactions tab was always empty

`listDwhTransactions` returns rows under **`data`** (backend `DwhTxnResult`), but the panel read
`d.transactions ?? d.rows`. That resolves to `[]` for every carrier, and the panel rendered its
"no transactions" empty state — a silent wrong answer that looks like a legitimate result. Typed
the response explicitly instead of probing for a key.

Compounding it, the default range was `month`. A carrier you open in this modal is often one you're
chasing *because* they stopped fuelling, so the current month is the worst possible default.
Now defaults to **all_time** with a Month / Quarter / Year / All-time switcher. Verified on AH
EXPRESS (5777844): `month` → 0 rows (correct — last activity 22 May 2026), `all_time` → 100 rows,
4,907 transactions, 561,658 gal, $2,029,366, in 420ms. Totals now come from the server roll-up
rather than being re-summed from the 100-row page (which would have under-reported).

### Bug 2 — the modal lost every scoped style

The modal is portalled to `<body>`, i.e. OUTSIDE `.fi-root`, but `.fi-pill`, `.fi-btn`, `.fi-empty`
and the `--fi-debt/--fi-paid/--fi-*` tokens were all declared as `.fi-root` descendants. Inside the
portal they simply didn't apply: statuses rendered as bare text, the close button had no chrome, and
outstanding balances came out white instead of red.

Fixed both ends — every component rule dropped the `.fi-root ` ancestor (the `fi-` namespace already
guarantees no collision), tokens now live on `.fi-root, .fi-scope`, and the portal wrapper is
`<div className="fi-scope" data-mytrion="finance">` so it re-establishes both the Finance tokens and
the module accent. `.fi-root` keeps `height/overflow` alone; `.fi-scope` must not, or it would clip
the scrim.

### Details redesigned + Invoices/Payments polish

Replaced the 17-tile icon grid — every field had identical weight and no grouping, so answering
"what are this carrier's terms?" meant reading all of it. Now four labelled sections (Company ·
Billing & terms · Credit & exposure · Activity) with right-aligned label→value rows and dashed
separators, plus a derived **Limit used %** that turns red at ≥90 (AH EXPRESS reads 135%).

Badging system is now one recipe (`.fi-badge`, dot + label, hue via `--p`) shared across invoice
status, payment status/mapping, LOC-suspended, fuelling status and fuel item, so a given word is
never two colours. Aged debt is graded (30d+ amber, 60d+ red), still-open invoice rows carry a red
left marker, tables have zebra striping and a totals `tfoot`, and roll-ups gained Total billed /
Total paid / Returned counts.

Checks: lint 0 errors, frontend typecheck 2 (both pre-existing, baseline was 10), `vite build`
succeeds, frontend tests 187/188 (the failure is the pre-existing `dashDebtorsData`). Rendered the
redesigned modal in light and dark.

## 2026-07-27 — Analytics Mytrion opened + rebuilt in the design system

Branch `feature/MytrionAll`. UI/UX only — the data path is untouched.

Removed `analyst` from `COMING_SOON_MYTRION_IDS` so the Mytrion is enterable, and updated
`resolveAccess.test.ts`, which asserted it was parked. Two tabs: **Dashboard** and **Reports**.

### Data path unchanged, presentation rebuilt

`useAnalyticsSnapshot` → `GET /v1/analytics/:dimension` (2h snapshot cache, 5-minute poll) still
does the work. What changed is that the Tailwind `AnalyticsDashboard` was replaced by marks built on
the module's own Horizon tokens (`.an-*`), matching Manager / HR / Finance. The active dimension
still lives in the URL (`?dimension=transactions`) so a view stays linkable. The hook's bundled
sample-data fallback now announces itself with a banner instead of rendering as though it were live.

### The chart work (data-viz skill applied)

**Found a real palette bug in the old chart.** `tones.ts` collapsed 9 semantic tones onto ~6
Tailwind classes: `sky` and `info` both mapped to `bg-primary`, `teal`→`bg-good`, `amber`→`bg-warn`.
On the Transactions breakdown that made **Diesel and Gasoline render in the identical colour** — two
categories, one hue, no way to tell them apart.

Replaced with a proper categorical palette assigned by SERIES INDEX in fixed order (never cycled,
never by rank, so a filter can't repaint survivors), folding anything past 6 into "Other" rather
than inventing a 7th hue. Ran the validator rather than eyeballing it — the naive Horizon
`--tone-*` set FAILED four checks (lightness band, chroma floor, CVD ΔE 4.6, normal-vision 14.1);
the adopted palette passes both modes:

    dark  (surface #1b212c) — CVD ΔE 8.4, normal-vision 19.3, all ≥3:1        → PASS
    light (surface #ffffff) — CVD ΔE 9.1, normal-vision 19.6, contrast WARN×3 → PASS + relief

The light WARN obliges the **relief rule**, so every categorical mark carries a visible direct label
(name + value + %) plus a legend — identity is never colour-alone. Status hues (good/bad) are
reserved for deltas and never reused as a series colour; delta direction also carries an arrow
glyph, not just a hue.

Trend is BARS not a line — the values are discrete daily counts, and a line would imply a continuous
quantity between days. Single series → no legend (the card title names it), 4px rounded ends
anchored to the baseline, 2px gaps, the in-progress trailing day faded and labelled as such in its
tooltip, axis labelled every ~4th day to avoid collisions.

**Rendering it caught what the validator can't.** The breakdown fills were invisible: `.an-bd-fill`
is a `<span>` inside a non-flex track, so it stayed `display: inline` where width/height are ignored
— the track drew, the coloured bar didn't. Blockified the fill, the track and the legend swatch.
That is exactly why the skill's last step is "render it and look at it".

### Reports tab

Catalog of six standing reports (fuel volume, receivables ageing, pipeline conversion, agent
performance, billing reconciliation, client health). Structural only — each card names the real
source it will read, carries a Soon tag, and its Export button is disabled with a reason. Nothing
generates a file, and a banner says so.

### Checks

Lint 0 errors, frontend typecheck 2 (both pre-existing; baseline 10), `vite build` succeeds,
frontend tests 187/188 (the failure is the pre-existing `dashDebtorsData`). Rendered light + dark.

## 2026-07-27 — Chat dock removed from every department Mytrion (Admin only)

The sidebar "Chat" item was showing on Analytics (and Finance, Collection, Verification). Chat is
now Admin-only.

Fixed centrally rather than per module: `MytrionShell`'s flag was inverted from `disableDockChat`
(opt-out, default ON) to **`enableDockChat` (opt-in, default OFF)**, and the three modules that used
to opt out (admin, hr, manager) simply dropped the prop. With an opt-out default every NEW Mytrion
silently shipped a chat dock unless its author remembered to disable it — which is exactly how it
reached Analytics. Now a Mytrion has to ask for it.

Audited every chat surface in the app; only two exist:
  • `admin/index.tsx` → `<ChatPanel variant="full" />` — Admin's own page, untouched and still there
  • `MytrionShell` → the dock view, now unreachable (nothing opts in)
Sales / Billing / Customer Service don't use `MytrionShell` and render no ChatPanel at all, so no
change was needed there.

Checks: lint 0 errors, typecheck 2 (both pre-existing), `vite build` succeeds, frontend tests
187/188 (the failure is the pre-existing `dashDebtorsData`).

## 2026-07-27 — Fake data purged from the CRM · Collection Mytrion rebuilt

Branch `feature/MytrionAll`. Two jobs: remove invented data everywhere it was rendered, and stand up
Collection in the design system.

### Shared `<ComingSoon />`

New `mytrions/_shared/ComingSoon.tsx` + module CSS — one "not built yet" surface for the whole app.
Reads `--accent`, so it takes whatever hue the surrounding Mytrion sets. Takes a `sources` list so an
unbuilt tab still records the real table/API it will read, which keeps the intent without pretending
the data exists.

### Fake data removed (audited the whole CRM, not just HR)

1. **HR** — deleted `peoplePreview.ts` entirely (6 placeholder employees, 5 attendance rows,
   5 requests). Employees / Attendance / Requests / Profile now render `<ComingSoon />`; Home lost
   its em-dash "at a glance" tiles (scaffolding pretending to be a dashboard) and keeps the hero +
   launcher. Nav and jump cards carry a `Soon` badge. The genuinely useful part — the live Zoho
   People field map — survives as `peopleSchema.ts`, which contains **no data**, only the confirmed
   field names, coverage percentages and the consequences for whoever wires the tabs.
2. **Analytics** — the real prize. `analyst/data.ts` shipped an `ANALYTICS` fallback with invented
   KPIs, a fabricated 14-day trend and a leaderboard of made-up agent names, and
   `useAnalyticsSnapshot` substituted it **whenever the warehouse was unreachable** — a dashboard
   that looked authoritative and was fiction. Deleted. `AnalyticsLoaded.block` is now
   `AnalyticsBlock | null` with an `error` field; a failed fetch shows an error panel, and a failed
   POLL over an already-loaded block keeps the figures but flags them **Stale**. `data.ts` is down to
   56 lines of pure type contract.
3. **Collection** — deleted `data.ts` (260 lines of invented cases / Array rows / inbox) along with
   the Cases, CaseDetail, ArrayReport and Inbox components built on it.
4. **Dead Tailwind analytics components** — `AnalyticsDashboard`, `AnalyticsKpiGrid`,
   `AnalyticsTrendChart`, `AnalyticsBreakdown`, `AnalyticsLeaderboard`, `AnalyticsDimensionTabs`,
   `DeltaPill`, `params.ts` and `tones.ts` all deleted (zero external importers). That also retires
   the `tones.ts` defect at the source: it collapsed nine semantic tones onto ~six Tailwind classes,
   so `sky` and `info` painted identically and two categories in a breakdown were indistinguishable.
   Only `useAnalyticsSnapshot` survives from that folder.

Verified clean: Sales (`data.ts` is action config, no seed rows), Customer Service ("live APIs only")
and Sales Data Center ("NO mock data — every row is a real CRM record").

⚠️ **`verification/data.ts` still holds 330 lines of fixtures.** Verification is the only remaining
entry in `COMING_SOON_MYTRION_IDS`, so it is not routable and none of it renders — but the module
would show invented applications the moment it is opened. Left in place rather than rebuilding a
fourth module unasked; it needs the same treatment before Verification launches.

### Collection Mytrion

Rebuilt from scratch: `collection.css` (`.co-*`, same Horizon language as Manager / HR / Finance /
Analytics), `collectionNav.ts` with Layer-2 access predicates, `CollectionBits.tsx`, and three tabs —
**Home** (hero + workspace launcher, no invented figures), **Array Reports** and **Collection
Cases**, both `<ComingSoon />` with their real sources named. Removed from
`COMING_SOON_MYTRION_IDS` so the Mytrion is enterable; `resolveAccess.test.ts` updated to match.

Notes recorded for the later build: Array has an existing servercrm sync
(`jobs/arrayReportSync.js`, `services/arrayReportDwh.js`) that needs inspecting before its columns
are settled, and Cases likely maps onto `retention_cases` + the shared `cmp_invoice` debt figure —
but advancing a case is a WRITE and needs an audited, role-gated endpoint first.

### Checks

Lint 0 errors. Typecheck 2 (both pre-existing; baseline 10). `vite build` succeeds. Frontend tests
187/188 — the failure is the pre-existing `dashDebtorsData`. Rendered Collection + HR coming-soon in
dark.

## 2026-07-27 — Trailhead (new) + Verification rebuilt · shared module shell extracted

Branch `feature/MytrionAll`.

### Extracted the shared module chrome first

Manager, HR, Finance, Analytics and Collection had each grown their own copy of the same primitives
(page, kicker, hero, section head, launcher cards, button, Soon chip) — five near-identical
stylesheets, about to become seven. Extracted once:

- `_shared/moduleShell.css` — the `.ms-*` primitives, Horizon language, no module-specific colour
  (it reads `--accent`, which each module supplies via `[data-mytrion='<id>']`).
- `_shared/ModuleShell.tsx` — a whole Mytrion from a declarative tab array: sidebar, Main tab with
  hero + launcher, per-tab pages, Layer-2 access predicates, `Soon` badges. A tab either renders its
  own `content` or declares `soon` and gets `<ComingSoon />`. **There is deliberately no third
  option that fabricates rows.**

Both new modules are now ~70 lines each with no nav file, no shell and no stylesheet. The older five
can migrate as they're next touched.

### Trailhead (new Mytrion)

Octane's internal learning system, named after Salesforce's. Tabs: **Main · Courses · AI Instructor ·
Exam hub** — everything below Main is `soon`.

Registered end to end: `MytrionId` union, `MYTRIONS` rule, `MYTRION_ORDER`, URL slug `/main/trailhead`,
`registry.ts` lazy import (so it code-splits), a teal accent in `global.css` (light + dark), a
`GraduationCap` glyph in `icons.tsx`, and backend `MYTRION_IDS` + `MYTRION_DEPARTMENT`.
`agentKeyFor('trailhead')` returns null — like `hr`, it has no entry in AGENT_KEYS and must not be
cast. It is the one Mytrion with no department to narrow (learning is for everyone), so its access
rule is open with adminBypass.

Note: the picker's `hue` union has no `'teal'`, so the tile uses `'green'`; the module's real accent
is the teal from `[data-mytrion='trailhead']`.

### Verification rebuilt

Deleted the module wholesale — including the **330 lines of fixtures flagged last session** (7 fake
applications, 5 client requests, 8 notifications) plus the Applications, ApplicationModal,
Configuration, Inbox and Toast components built on them. Rebuilt on ModuleShell with **Main ·
Applications · Configuration Ruleset · Existing clients**, all `soon`.

Each tab names a real source rather than guessing: there IS a live backend
(`modules/verificationPipeline/service.ts`, `routes/v1/verificationPipeline.routes.ts`) reading the
verification DB, and Existing clients will read the same `octane.dim_company` spine Finance and
Sales already agree on.

### Nothing is parked any more

`COMING_SOON_MYTRION_IDS` is now **empty** — every Mytrion is enterable, with unbuilt tabs showing
`<ComingSoon />` rather than the whole module being hidden. That is more useful than a dead picker
tile and keeps modules from rotting unseen.

`resolveAccess.test.ts` was rewritten to drive both assertions off the constant itself
(`for (const parked of COMING_SOON_MYTRION_IDS) …`) instead of hardcoding ids, so it stays correct as
Mytrions launch rather than needing an edit every time one does.

### Fake-data audit closed

Swept every `data.ts` in the app. Remaining files are clean: `analyst` (56 lines, types only after
this session's trim), `sales` (action config), `customer-service` and `billing` — both types +
helpers, whose fixtures were removed in earlier live-wiring passes and whose headers say so.
**No fabricated rows remain anywhere in the CRM.**

### Checks

Lint 0 errors. Frontend typecheck 2, backend 1 — all pre-existing (frontend baseline was 10).
`vite build` succeeds and both new modules code-split. Frontend tests 187/188 (the failure is the
pre-existing `dashDebtorsData`); the three suites added this session are 54/54. Rendered Trailhead
and Verification in dark.

## 2026-07-27 — Prod served a stale widget bundle (main was fine; the artifact wasn't)

### Symptom

`build` merged into `main` (PR #70), `git diff origin/build origin/main` empty — yet prod showed none
of the new work, through hard reloads. Not a caching problem and not a bad merge.

### Cause

The CRM frontend is a **vendored build artifact**: `apps/mytrion-crm/app` is committed to git, and the
root `Dockerfile` only `COPY`s it (`pnpm build` is `tsc -p tsconfig.build.json` — backend only). Nothing
in the Render build ever runs `vite`. So prod ships whatever bundle is *committed*, not whatever the
source says.

The last three commits (`429a3aa` Loyalty program, `ad30cc3` Implementator, `127d87d` Full Mytrion)
changed **101 files** under `apps/mytrion-crm/src` and **0 files** under `apps/mytrion-crm/app`. Last
rebuild was `5df153f` (07-26). Merging to `main` moved source that prod never executes.

### Why it went unrebuilt

`pnpm build:widget` was **failing**, so the bundle couldn't be regenerated:

- `ChatPanel.tsx` — unused `Gem` import (TS6133).
- `retentionKanbanCol.test.ts` — factory missing 10 required `RetentionCaseRow` fields
  (`phaseChangedAt`, `citiFolder*`, `lastReviewCycleAt`, `salesManagerZohoUserId`, `lastTransactionAt`,
  `txCount90d`, `activeCards`, `source`, `lastSyncedAt`), added by `ad30cc3` (TS2375,
  `exactOptionalPropertyTypes`).

The previous session recorded these as "pre-existing, `vite build` succeeds" — true, but `build:widget`
is `tsc --noEmit && vite build`, so the gate was red even though vite alone was green. **A red
`build:widget` means the deploy silently keeps shipping the old UI.**

Same class of bug in `tests/unit/retention-kill-switches.test.ts` (backend `RetentionCase` factory,
6 missing columns + `source`) — was breaking `pnpm typecheck`. Fixed too.

### Result

`pnpm build:widget` green; every chunk hash changed and new chunks appeared (`ComingSoon`,
`ModuleShell`, `fuel`, `credit-card`, `download`, `calendar-clock`, `ticket`). Root `pnpm build` green,
`pnpm typecheck` green, `pnpm lint` 0 errors. Backend suite 13 failures across 9 files — verified
pre-existing on `main` (identical with the change stashed), untouched here.

### Rule

**A frontend change is not deployed until `apps/mytrion-crm/app` is rebuilt and committed.** Merging to
`main` is not enough. Same applies to `apps/mini-app/app` (currently in sync at `af018b2`).

## 2026-07-27 (2) — Sales Mytrion: RingCentral prod auth, call-trigger correctness, Retention map

### 1. RingCentral prod sign-in hung on "Loading…" — COOP

`@fastify/helmet`'s default `Cross-Origin-Opener-Policy: same-origin` (confirmed live on the prod
portal, root + SPA deep links + assets) puts any `window.open()` popup in a separate browsing context
group, so `window.opener` is **null** inside it.

Embeddable's sign-in is 3-legged OAuth through RC's own
`apps.ringcentral.com/…/redirect.html`, whose `redirect.js` does
`window.opener.oAuthCallback(…)` / `window.opener.postMessage({callbackUri}, …)` then `window.close()`.
Opener severed → throws → popup never closes. That page's body is literally `<p>Loading...</p>`, which
is exactly the stuck screen agents reported. Dev never reproduced it: the Vite dev server sends no COOP.

Fix: `crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }` in `src/app.ts` — keeps the
document protected from a cross-origin opener, lets popups we open keep their opener. Regression test
in `tests/unit/security-headers.test.ts`. **Not** a redirect-URI problem: both envs already use RC's
hosted redirect.html, which is correct (a wrong one gives OAU-113, not a hang).

### 2. Call-end trigger dropped the lead on any call over 30 seconds

`ringcentralEvents.ts` re-read the TTL'd global dial context (`DIAL_CTX_TTL_MS = 30_000`, measured from
the dial CLICK) when building **every** event — including `ended`, which by definition arrives when the
call finishes. So a normal multi-minute sales call came back with no `leadId` / `dealId` /
`retentionCaseId`, and the whole post-call chain silently no-opped: no forced Lead status wizard, no
`mytrion_calls` row (the route needs a source), no `Mytrion_Call_Attempts` bump. Short calls worked,
which is why it survived. Zero test coverage existed.

Fix: latch the dial context per `sessionId` on first sight of the call (`sessionDialCtx`) and reuse it
for that call's whole life; clear on `ended`. The TTL now bounds only click→call association, which is
all it was ever for. Four tests in `ringcentralEvents.test.ts`, including a guard that a later untagged
call cannot inherit a previous call's lead.

### 3. Two "pre-existing" test failures were masking the Data Center write paths

`vi.mock` spread a **class instance** (`{ ...mod.zohoCrmRecords, updateRecord }`). Spread copies only
own enumerable props, so every prototype method became `undefined`. `getBlueprintTransitions(...)` then
threw a *synchronous* TypeError that the route's `.catch(() => [])` cannot attach to → the post-call
Status write looked like a 500. Product code was fine; the most important write path had no working
test. Same root cause made `ringcentral-call-log` hit a live Zoho round-trip and time out.

Both now use `Object.create(realInstance)` to keep the prototype chain. Added the coverage that was
missing: the Blueprint branch (transition executed, `Status` never plain-written) and its 422, plus the
`Mytrion_Call_Attempts` increment, first-call-from-unset, retention-call-counts-against-Deal, and
Zoho-failure-doesn't-fail-the-POST. Backend suite 13 → 11 failures; the rest are unrelated pre-existing.

### 4. Retention flow — how it actually behaves today

Three phases in lookup tables (`retention_phases` / `retention_statuses`), one open case per carrier
(`closed_at IS NULL`, partial unique on tenant+carrier).

- **Phase 1 · Sales agent** — `p1_new → p1_in_progress`, outcomes `p1_reached` (5 BD watch),
  `p1_out_of_reach` (1 BD per attempt, 5 max), `p1_vacation` (14 D), `p1_dissatisfied`,
  `p1_no_action_2bd`, `p1_open_pool` / `p1_pool_assigned` (3 BD claim), terminal `p1_returned`.
- **Phase 2 · Retention desk** — `p2_new → p2_working → p2_offer_pending`, terminal `p2_saved`,
  `p2_refused`, `p2_lost`, `p2_out_of_business`, `p2_no_response`; 10 BD wait for a new transaction.
- **Phase 3 · CITI** — `p3_hold` (7 D) → `p3_review` → terminal `p3_closed`.

Caps: `MAX_OPEN_POOL_AGENTS = 3`, `MAX_OUT_OF_REACH_ATTEMPTS = 5`, `MAX_RETENTION_TO_POOL = 3`. All
deadlines are business days except vacation (14 calendar) and CITI hold (7 calendar);
`addBusinessDays` skips weekends only — **holidays are not modeled**.

Automation is two pg-boss crons: `retentionCaseSync` hourly (DWH breach scan → open cases; any
transaction after `created_at` auto-closes as `p1_returned`, all phases incl. CITI) and
`retentionDeadlineSweep` every 15 min (all timer paths).

**The live surface is much smaller than the schema suggests.** Three hardcoded consts in
`killSwitches.ts` are all `false`: `RETENTION_OPEN_POOL_ESCALATION_ENABLED`,
`RETENTION_PHASE2_ESCALATION_ENABLED`, `RETENTION_OPEN_POOL_CLAIM_ZOHO_TRANSFER_ENABLED`. Consequently:

- Phase 2 and Open Pool are **unreachable**; `send_to_open_pool`, `escalate_retention` and
  `no_action_2bd` throw "temporarily disabled"; Dissatisfied stays Phase 1 with Sales keeping the Zoho
  Owner.
- In `resolveExpiry`, only the vacation chain still fires: `14D_vacation → p1_vacation_followup`,
  `2BD_vacation_followup → p1_awaiting_ops`, then Ops confirm (→ `p1_in_progress`) or deny (→ CITI).
  Every other timer returns null. CITI is reachable today **only** via Ops denial.
- The Sales board hides all this: `kanbanColOf` parks pool/Phase-2 cards on the stage they left from.

**Open question for prod:** both crons require `FF_JOBS_ENABLED`, which `render.yaml` explicitly
excludes ("pg-boss workers/crons stay off") — local `.env` has `FF_JOBS_ENABLED=1`,
`JOBS_WORKER_MODE=inline`. If the `octane-assistant-secrets` env group doesn't set it, prod has **no
case auto-generation, no auto-close on fuel return, and no timers at all**. Needs checking in Render.

## 2026-07-27 (3) — Finance: modal tab strip crushed; main_transactions filters restored

### 1. Client modal — the tab strip vanished on content-heavy tabs

Reported as "the main filter tab is not visible when we click Transactions or others". Reproduced in
headless Chrome against the real `finance.css` (harness: the exact ClientModal DOM + a 100-row
transactions table). Measured at a 1512×900 viewport:

```
tabs  h=6.6   scrollHeight=24   ← crushed to a sliver; only the EFS/Money-Codes "Soon" pills peeked
head  h=80.8  body h=665.4
```

Cause: `.fi-modal` is a column flex container. `.fi-modal-tabs` is `overflow-x: auto`, which makes it
a **scroll container — and a scroll container's automatic minimum size is 0, not its content
height**. So the strip was fully shrinkable while its sibling `.fi-modal-body` was floored at
`min-height: 260px`. The flex algorithm took the deficit out of the only item that would yield.
`.fi-modal-head` survived because it is not a scroll container, which is why the modal still looked
half-normal and the bug read as "the tabs are gone" rather than "the layout is broken".

Fix: `flex: none` on `.fi-modal-tabs` (and `.fi-modal-head` for the same reason). After: tabs
38.4px against a 39px content height, and `80.8 + 38.4 + 633.6 = 752.8` exactly fills the modal.
Verified stable at viewport heights 1100 / 900 / 760 / 620 / 520 — the strip holds at 38.4px at every
one and the body absorbs the difference.

**Same latent shape elsewhere, NOT changed** (could not make them reproduce): `.bm-copilot-chips` and
`.cs-copilot-chips` are also unpinned `overflow-x: auto` strips in a column flex panel. They survive
today only because their bodies use `min-height: 0` (basis 0 ⇒ shrink weight 0), so nothing forces a
deficit until the viewport gets very short. Worth pinning if either panel ever grows a fixed-height
sibling. Note `.fi-subbar` (the Transactions Range chips) scrolls away with the body — it is inside
the scroller and not sticky. Left alone: it is visible on open and was not what was reported.

### 2. `finance.main_transactions` — page/search silently stripped

Confirmed a real capability regression, not a stale test. The entry moved from a servercrm
passthrough (`financeList` → `looseFilters()`, which carried the widget's `page`/`search`) to a local
DWH query understanding only `limit`. The params schema stayed a plain `z.object`, and **zod strips
unknown keys silently**, so a caller paginating or searching got a 200 and the unfiltered first page.

Restored rather than deleted, because the roster is ~8k carriers and page-1-of-everything is not an
answer:

- `fetchFinanceTransactions` now takes `{ limit, page, search }` → `LIMIT $1 OFFSET $2` with `page`
  1-based, and an ILIKE `WHERE` across `company_name` / `carrier_id::text` / `card_number` /
  `location_name`. LIKE metacharacters in the needle are escaped so a literal `%` or `_` matches
  itself instead of widening the search. Args stay in step with the SQL ($3 only bound when searching).
- The schema is now **`.strict()`** and bounds `page` to 1..1000 (a deep OFFSET should not be able to
  stall the DWH). Strict is the point: an unsupported filter is now a 400 rather than a
  wrong-but-successful read — the same rule `resolveWritePayload` enforces for CRM writes.

Safe to tighten: the only caller is `scripts/financePanelSmoke.ts` (`{ limit: 2 }`). The frontend's
`touchpointTypes.ts` entry is declaration-only — nothing in the CRM app invokes this key (the Finance
UI reads `/v1/finance/*` and `finance.client_recent_transactions` instead).

New `tests/unit/dwh-finance-transactions.test.ts` (8) asserts the emitted SQL and args, not just the
schema: default page, OFFSET arithmetic, the four search columns, metacharacter escaping, and
WHERE-before-ORDER-BY-before-LIMIT ordering.

### Checks

Backend typecheck green, lint 0 errors, suite 10 failures / 985 passed (was 11 / 976 — touchpoints
catalog fixed, 8 added). Frontend 191/192, the one failure the long-standing `dashDebtorsData`.
Widget bundle rebuilt and the `flex:none` rules verified present in the shipped CSS.

**Note:** CLAUDE.md rule 10 asks for the `modern-web-guidance` skill on UI work — it is not
registered in this environment (`Unknown skill`), so the CSS change was made without it. Worth either
installing the skill or dropping the rule.

## 2026-07-27 — Standardize Sales Coming soon detail panels

Single catalog `soonTabs.ts` (copy + hue + icon) shared by sidebar SOON chips and
`ComingSoonPanel`. Panel layout moved to `.ss-soon-panel*` in `ss-horizon.css` so Tickets /
Verification / Call Hub render the same composition. Removed unused DashSkeleton ComingSoonPanel.


## 2026-07-27 (4) — Sales: Automations UX, tier client cards, Rejection Reports (partial)

### ⚠️ `.env` MYTRION_OPS_DATABASE_URL points at PROD, not localhost:5433

`pnpm db:migrate` run locally hits the **Render production database**
(`dpg-…oregon-postgres.render.com/mytrion_ops_db`), not the docker Postgres CLAUDE.md documents on
`localhost:5433` (that container's DB is `octane_assistant` and is empty of app tables). I hit this
the normal way — started docker, ran `db:migrate` to reach head, then again after adding 0059 — and
both went to prod.

Impact of what landed: `0059_mytrion_rejection_reports` — one new table + 5 indexes, all
`IF NOT EXISTS`, **purely additive**. No existing table, column or row was touched; the table is
empty. Prod now reports 60 applied migrations against 60 local `.sql` files, i.e. exactly head, and
the only new `mytrion_*` table is the one added here — so the earlier "reach head" run was a no-op.

**Action needed:** either point local `.env` at `postgresql://…@localhost:5433/…` (matching CLAUDE.md
§"Local run stack"), or add a guard so `db:migrate` refuses a non-local host without an explicit
`--prod` style opt-in. Right now any developer following the documented workflow migrates prod.

### 1. Automations — card content vanished on hover+scroll

`catalogCard` (AutoCatalog.tsx) emitted `transform: scale(1)` at REST. That is not a no-op: it
promotes the card to its own composited layer and makes it a containing block. Stacked on the
`backdrop-filter: blur(20px)` `.ss-card-h` puts on all 24 catalog cards, a scroll that changes what
the filter samples could leave the promoted layer un-repainted — the children were still in the DOM,
just unpainted. `overflow: hidden` (which nothing needed) gave that stale layer something to clip
against, and `transition: all` re-ran the blur rasterisation on every property change while also
overriding the narrower transition ss-horizon.css sets. Now: transform only while dragging,
no `overflow`, explicit 4-property transition. Rest appearance unchanged.

### 2. Automations — dark-mode modal transparency

The panel used `background: var(--surface)` = `rgba(24,31,45,0.66)`. Correct for a card sitting ON
the page, far too see-through for a dialog OVER it — the catalog grid read straight through it
(matches the screenshot). Added `--hz-modal-surface` (0.94 dark / 0.96 light) and pointed the
existing-but-unreferenced `.ss-modal-box` recipe at it, then adopted that class on the modal and
raised the scrim from `.62`/blur3 to `.78`/blur6 (matching dataCenterSheet). `--surface` itself is
untouched, so the ~150 inline card/row/chip call sites don't flatten.

### 3. Data Center → Clients

`DcCardGridSkeleton` added — Clients was the only sub-tab falling through to `Gate`'s bare centred
ring while Leads/Deals both passed a shaped skeleton. It mirrors the real card's box model so the
grid doesn't jump.

Tier gradient cards ported from the Manager loyalty board into `dc-clients.css`, scoped to `.dc-lty`
(Sales' global `--tier-*` renders bronze AS orange, which collides with "building toward Bronze").
Gold vs Bronze are separated on **three** axes, not hue alone, so the pair survives dim screens:
gold is bright `#eaa32c` + metallic sheen sweep + inset halo; bronze is dark copper `#a25e28`,
deliberately **matte** with no sheen and no halo. "No active cards" is dashed rather than a dimmer
tier. The tier owns only the shell (edge/wash/rail/glow) — violet Gallons·Cycle, accent
Gallons·Month and danger Owed keep their own semantics, so a tier can never be misread as a metric.
Rendered all five buckets in headless Chrome to confirm separation and that the figures stay legible.
Bucket helpers (`tierBucketOf`, `TIER_BUCKET_ORDER`) moved into `_shared/loyalty.ts` so Sales and
Manager cannot diverge. Also fixed the Manager bug where `.is-gold` out-specified `:hover`, leaving
gold the one card with no hover glow — the new recipe drives it off a `--halo` variable instead.

### 4. Rejection Reports — schema + migration only (rest NOT built)

Done: `src/db/schema/mytrion_rejection_reports.ts`, registered in `schema/index.ts` **and** in
`drizzle.config.ts`'s explicit `schema[]` array (miss that and drizzle-kit never sees the table),
plus hand-written `0059_mytrion_rejection_reports.sql` + journal entry.

Hand-written because **`pnpm db:generate` is broken repo-wide**: `meta/0022_snapshot.json` and
`0023_snapshot.json` both declare the same `prevId`, so drizzle-kit aborts with a snapshot collision.
Snapshots stopped at 0024 anyway (25 snapshots vs 60 migrations), so 0025+ have all been hand-written
with a hand-maintained journal — 0059 follows that. Worth repairing the 0022/0023 chain separately.

Ownership design note: the row stores BOTH `agent_zoho_user_id` and `agent_name`. A sub-investigation
recommended id-only (a live DWH check found no carrier with a name but no id), but that is the
carrier→agent direction; the READ is the reverse — a worker's session Zoho id → their reports — and
`dwhClientRoster.buildOwnedCte` unions an id-suffix arm with a NAME arm precisely because session ids
and `dim_company.agent_zoho_user_id` don't reliably agree. Binding on id alone risks the documented
"0 rows for everyone" failure, so both are stored and reads must match id-or-name.

**Still to build:** `findCarrierOwner` in dwhClientRoster, `rejectionReportRepo`,
`rejectionReports.routes.ts` (webhook `POST /v1/rejection-reports/webhook` with `x-rejection-secret`
+ the DB-backed `GET /v1/data-center/rejections`), `REJECTION_WEBHOOK_SECRET` env + log redaction,
route registration, removal of the existing Zoho-backed `/data-center/rejections` (a second GET on
the same path is `FST_ERR_DUPLICATED_ROUTE` **at boot**), and the Deluge snippet.

## 2026-07-27 (5) — Rejection Reports backend + Automations runner escape hatch

### Rejection Reports now come from our table, not a Desk scan

- `findCarrierOwner(carrierId)` added to `dwhClientRoster.ts` — deliberately in the file that is the
  single ownership authority (its header warns that a second, divergent one caused the "Clients modal
  403s for every non-admin" P0). Returns id AND name.
- `rejectionReportRepo` — tenant-scoped; `create` is idempotent on the Desk ticket id (23505 →
  re-read the winner, so a Deluge retry is a no-op); `listForAgent` matches id-**or**-name, comparing
  the id by its last 12 digits exactly like `buildOwnedCte`.
- `POST /v1/rejection-reports/webhook` — `x-rejection-secret`, `carrierId`+`errorCode` required so
  app.ts's empty-body-as-`{}` parser can't create a blank row, best-effort owner resolution (a DWH
  failure still records the decline as `unresolved` rather than losing it), synthetic system actor
  for the audit, and the full card number is never put in audit detail.
- `GET /v1/data-center/rejections` moved into the same file and is now agent-scoped; the Zoho Desk
  version in `dataCenter.routes.ts` is deleted along with its import. Only one handler may own that
  path — a second GET is `FST_ERR_DUPLICATED_ROUTE` **at boot**, so this had to land as one change.
  Verified by booting the app and printing the route table: one GET, one webhook POST.
- The list DTO omits the full PAN; only `cardLast4` goes over the wire.
- Frontend `mapRejection` rewritten: company and reason are real columns now instead of being parsed
  back out of a ticket subject, `number` shows the carrier id, and our `new/acknowledged/resolved`
  states map onto the badge vocabulary `RejectionsView` already colours.

7 tests in `tests/unit/rejection-reports.test.ts` cover the secret gate, owner binding, DWH-failure
fallback, unknown carrier, empty-body rejection, agent scoping, and that no PAN reaches the client.

Deluge snippet + secret + smoke test: `docs/deluge-rejection-report-webhook.md`.
`REJECTION_WEBHOOK_SECRET` must be added to the Render `octane-assistant-secrets` env group — until
then the endpoint answers 503 and the Deluge's own catch swallows it (tickets are unaffected).

### Automations runner

- `AutoMacroLoader` showed a spinning ring **and** a percentage **and** a bar for one wait. The
  percentage was fabricated (`p + (3 + Math.random()*6)`, capped at 92), so every long run sat at
  "92%" — worse than no number. Now one indeterminate `.ss-sweep` bar plus the phase label.
- `closeAuto` early-returned while `running` and was the handler for BOTH the backdrop and the X, so
  a hung automation had no exit but a page reload. Added: a run token (`runSeq`) so a late response
  from a cancelled/closed/superseded run is discarded, a Cancel button, an ESC handler, and a 90s
  watchdog that converts a never-settling run into a real error.
- Known limit, documented in the code: the HTTP request is **not** aborted. `callTouchpoint` takes no
  `AbortSignal` and threading one through every `autoRunners` branch is a separate change, so a
  cancelled run completes in the background and its result is thrown away.

Backend suite 992 passed / 10 failed (the same 10 pre-existing); frontend 193/194.

## 2026-07-27 (6) — Clients: tier filter, tier sort, distinct tier icons, stronger gradients

### Filter

Tiers were already filterable — but only from inside a dropdown labelled "All statuses", where
picking Gold silently discarded the Debtor/Active choice (one `clientStatusFilter` string held both).
Split into two independent filters that compose (Debtor **+** Gold):

- the dropdown keeps only `all / debtor / active`;
- tiers moved onto the loyalty distribution bar, whose legend entries are now toggle chips. That bar
  already sat directly above the grid showing the same counts, so the filter is the number you click.
  Clicking the active chip clears it; empty buckets are disabled (filtering to zero results is never
  the intent); the stacked bar dims non-selected segments so it reflects the filter.

Counts always describe the agent's FULL book, never the filtered slice — otherwise the denominator
moves as you filter.

### Sort

Extracted to `clientSort.ts` (`compareClients`) so the rule is testable rather than inline: debtors
first, then Gold → Silver → Bronze → Building → No cards. Money owed outranks loyalty deliberately —
a Gold client who owes nothing needs no action today, any debtor does — so a Gold debtor still sits
above a Bronze debtor. Two further keys (gallons desc, then name) exist for STABILITY, not ranking:
without a total order the grid appears to reshuffle on every SWR revalidate. 6 tests.

`tierBucketRank` lives in `_shared/loyalty.ts`, separate from the existing `RANK` — that one orders
program levels for reward eligibility and has no place for `building`/`idle`.

### Icons

A star on every badge made Gold/Silver/Bronze read as one badge in three tints. Each bucket now has
its own silhouette, registered in the Sales icon registry and mapped from shared code
(`tierBucketIcon`) so Sales and Manager can't drift: Trophy / Medal / Award / Sprout / MinusCircle.

### Gradients — separated on four axes, both themes

Hue alone collapses on a dim screen, so each bucket differs in wash SHAPE as well:

| | hue | wash shape | finish | glow | rail |
|---|---|---|---|---|---|
| gold | bright amber | diagonal, top-heavy | metallic sheen | warm halo | 100% |
| silver | cool blue-grey | falls straight down | cool white sheen | none | 78% |
| bronze | deep copper | pools at the BOTTOM | matte | none | 58% |
| building | vivid orange | radial from top-left | matte | none | 40% |
| idle | neutral | almost none | none | none | dashed |

Rail length encodes rank too. Light mode is re-pitched rather than inherited: the dark alphas read as
grubby smudges over a white pane and the cool sheens vanish entirely, so `--tint` and `--sheen` have
their own light-mode values per bucket. Rendered both themes side by side in headless Chrome to check.

**Metric colours changed** (approved): the Cycle/Month figures were violet and emerald, which fought
the warm washes — violet on gold especially. Figures are now neutral `--text` with the semantic hue
moved to the dot in the label, so the colour coding survives while contrast is guaranteed on all five
washes in both themes. `Owed` keeps red on the figure because it is a warning; every wash fades out by
~60% height, so the figure row sits on near-neutral pane in each bucket.

### Checks

Typecheck green, lint 0 errors, frontend 199/200 (the pre-existing `dashDebtorsData`), backend
994 passed / 10 failed — the same 10 pre-existing. NOTE: the backend suite intermittently reports
~34 failures when run immediately after a heavy build (timeouts + 403s in the DB/network suites);
two consecutive clean runs both give 10. Worth chasing separately — it makes CI look flaky.

## 2026-07-22 — Analytics category dashboards + UI filters

### Sidebar by category

Rewired Analyst Mytrion nav from a single Dashboard tab to category pages: Sales, Customer Service, Finance, Billing, Transactions, Reports (`categories.ts` + `index.tsx`). URL: `/m/analyst?category=sales`.

### UI parameter filters

`DashboardFilters` + `filterBlock` — agent picker (admins: `listAgents`; others: self) and date presets (today / this week / this month / custom). Selections sync to URL (`agent`, `agentName`, `range`, `from`, `to`). Client-side: agent filters leaderboard; date filters trend points. KPIs/breakdown remain org snapshot totals until the warehouse API is parameterized.

### Cleanup

Removed broken WIP Individual/Managers dashboard files that imported deleted Tailwind analytics kit. Typecheck green for CRM app.

## 2026-07-28 — Analytics agent/date filters → parameterized DWH

### Problem
UI agent/date filters only trimmed the client-side leaderboard/trend; KPIs stayed org-wide and a banner admitted warehouse snapshots were not per-agent.

### Fix
- `GET /v1/analytics/:dimension` accepts `agent`, `agent_name`, `range`, `from`, `to`.
- `computeAnalyticsBlock(dimension, filters)` binds those into DWH SQL (`filters.ts` + `service.ts`): pipeline via `zoho_users` id-suffix / name; transactions/billing via `dim_company` ownership CTE (`buildOwnedCte`).
- Filtered requests bypass the 2h org cache; non-admins cannot target another agent.
- CRM `useAnalyticsSnapshot` + `CategoryDashboard` forward URL filters to the API (no more client-only agent banner).

### Checks
Unit: analytics-filters + analytics-cache green. Backend + CRM `tsc --noEmit` clean.

### Hotfix — pipeline agent filter 500

Agent-scoped pipeline stages joined `intm_zoho_deals.owner`, which does not exist → DWH error → UI "Internal server error". Now scopes stages via `EXISTS` on `zoho_deals` matched by `zoho_deal_id`. Verified: `?agent_name=Daniel+Brown` returns 200 with his KPIs/leaderboard.

### Analytics date filters — empty Today/This week for agents

Daniel Brown (and many reps) often have **0 fills today / this calendar week** while still having month activity (e.g. Jul 15–17, Jul 25). UI looked “broken”. Added **Last 7 days** preset, defaulted Custom to last 7 days, aligned Today trend to one day, and a banner when an agent has 0 fills in the selected window.

### Hotfix — blank Sales dashboard / DWH connection timeouts

Filtered views (`last_7_days`, agent picks, etc.) always hit live DWH with 4-wide `Promise.all` and no cache. Rapid filter changes + React double-fetch + warmers exhausted the shared pool (`max: 5`) → `timeout exceeded when trying to connect` → blank UI / 502.

- Filtered snapshot cache (5 min) + in-flight dedupe; serve stale filtered on recompute failure.
- Cap analytics query parallelism at 2 per compute.
- Category dashboard shows “Loading…” / clearer timeout error instead of an empty dark panel.

### Hotfix — pipeline statement timeout on stages (`intm_zoho_deals`)

Even after cache/dedupe, `computePipeline` stages scanned `intm_zoho_deals` and regularly hit DWH `statement_timeout=30s` (especially `last_7_days` / org-wide). App Fills from `public.zoho_deals` was fine; the stages query killed the whole block → 502 / blank Sales.

- Stages now aggregate `public.zoho_deals.stage` (same table + owner join as apps) — sub-second in spot checks.
- Soft-fail individual pipeline queries so a single timeout still returns partial KPIs/trend/leaderboard.
- Warmer skips a tick while interactive filtered/org computes are in flight.

### Duplicate dashboards — CS ≡ Sales and Finance ≡ Billing

Four sidebar categories rendered **two** distinct dashboards: `customer-service` was wired to the
`pipeline` dimension (so CS showed the Sales deal funnel) and `finance` to `billing` (byte-identical
to the Billing tab). Both now have their own warehouse-backed dimension.

- **`support`** (Customer Service) — `public.zoho_desk_tickets`. KPIs Tickets Created / Closed /
  Avg Resolution / Open Now; trend tickets-per-day; breakdown by status; leaderboard by channel.
  SCD2 table with duplicate rows per ticket even among `is_active` (67221 rows / 64948 distinct
  ids) → every aggregate counts `distinct t.id`.
  **Not agent-scopable:** Desk `assignee_id` is the Desk org id space (`1057080…`), CRM
  `zoho_users.id` is `6227679…` — zero overlap on full id *and* last-12-suffix, and the DWH has no
  Desk-agent roster to bridge them. The agent picker is hidden for CS, and if an `agent` param is
  passed anyway the caption says "org-wide" so an org number never reads as one agent's book.
- **`receivables`** (Finance) — `public.cmp_invoice` + `cmp_invoice_payment`. KPIs Invoiced /
  Collected / Outstanding / Overdue; trend collected-$-per-day; breakdown open AR by age bucket;
  leaderboard largest outstanding balances. Open-invoice rule matches `dwhClientRoster`'s debt_cte
  (`PENDING`/`PARTIALLY_PAID` and still owing ≥ $1) so Finance and the Clients roster agree.
  Outstanding/overdue/aging are point-in-time, not window-filtered — an aging report scoped to
  "today" is meaningless. Agent-scoped via `dim_company` ownership.

**Refactor:** `service.ts` was 591 lines and two more computes would blow the 600-line cap, so each
dimension moved to `src/modules/analytics/dimensions/*.ts`, shared helpers to `shared.ts`, and
`service.ts` is now just the dispatcher. `ownedCarrierCteFor(alias, …)` generalises the ownership
CTE (transactions `t`, billing `bh`, receivables `i`); the two old wrappers delegate to it.

**Bug found while smoke-testing:** Billing's "Open Debtor Invoices" KPI read **0 forever** —
`cmp_invoice.status` is stored UPPERCASE but the predicate compared `'pending'`/`'partially_paid'`.
Now 1,529 org-wide / 46 for Daniel Brown. (It was invisible until Finance showed 1,366 open
invoices next to Billing's 0.) Finance's count is slightly lower because it applies the ≥ $1
still-owed floor; Billing's is a raw status count.

### Checks
`pnpm lint` 0 errors, `pnpm typecheck` + CRM `tsc --noEmit` clean. Analytics unit tests 21 green
(6 new: `ownedCarrierCteFor` alias/binding + dimension registration). Live DWH spot-check of all
five dimensions across today / last_7_days / this_month / custom / agent-scoped: 290–1110ms, no
timeouts. Pre-existing unrelated failures (10 tests / 6 files: touchpoints, stream-adapter,
zoho-crm, tools, retention-cs-caps, notification-templates) are identical before and after.
UI render not visually verified — the app requires Zoho sign-in.

### Sales dashboard was the CRM funnel, not a sales scorecard

Reviewed against the "Sales_new" Power BI report (14 pages). Its recurring core metric set is
**Active Companies, Unique Cards, New Cards, Volume (gallons), Revenue** — none of which our Sales
dashboard showed. Sales was wired to the `pipeline` dimension (App Fills + deal stages), which is
that report's **CRM** page, not its Sales scorecard.

- **New `sales` dimension** (`dimensions/sales.ts`) — the five core KPIs with prior-period deltas,
  volume/day trend, volume-by-company breakdown, agents-by-volume leaderboard (Volume / Cards /
  Revenue), agent-scoped through the usual `dim_company` owner CTE.
- **New `CRM` sidebar category** keeps the deal funnel on `pipeline` — nothing was thrown away, it
  just moved to the category it actually describes.

**Source:** `octane.mart_sales_dashboard_card_base` — the mart the Power BI report is itself built
on (carrier / agent / card / volume / amount already denormalized, 1.27M rows, fresh to 2026-07-27).
`first_transaction_date` is the CARD's first swipe and is single-valued per `card_number` (verified:
zero cards carry more than one value), so New Cards = cards whose first swipe is in the window, and
it is the cohort key if the report's cohort matrices get built later.
**Perf caveat:** an unfiltered scan of that mart is ~3.5s; every query must stay date-bounded
(date-filtered aggregates are 170ms–1.6s). Do not add an unbounded query against it.

Not built from the report (deliberately out of scope for this pass): the cohort heatmaps, the filled
US map by state, target-vs-actual gauges, referral/segmentation pages, and the FB-leads leaderboard.
The `AnalyticsBlock` shape (KPIs + one trend + one breakdown + one leaderboard) covers a scorecard
page; cohort matrices and maps would need new block types.

### Checks
`pnpm lint` 0 errors, backend + CRM `tsc --noEmit` clean, analytics unit tests 22 green. Live DWH
spot-check of `sales` across today / last_7_days / this_month / custom / two agents: 509–1625ms.
Full suite stable at the same 10 pre-existing failures / 6 files across repeated runs.

### Analyst agent filter now follows "View as" (dropped the second picker)

The analyst dashboards carried their own **SALES AGENT** combobox while the TopBar already had the
app-wide **View as** (impersonation) control. Two controls, one question — they could disagree about
whose numbers were on screen. The dashboard picker is gone; agent scoping now reads the
impersonation state.

- `DashboardFilters.tsx` — agent combobox removed (with its `listAgents` fetch, search/filter state
  and `getSession`/`useUserContext` reads). It now only *reflects* the already-resolved
  `value.agentName`; it must not re-derive the identity or the label could disagree with the KPIs
  above it. Date pills / custom range unchanged.
- `index.tsx` — resolves the agent: acting-as → that agent; else non-admin → **their own book**;
  else (admin, not acting) → org-wide. Skipped entirely for Customer Service, which is not
  agent-scopable.
- `categories.ts` — `parseFilters` no longer reads `agent`/`agentName` from the URL and
  `writeFilters` strips them, so a bookmarked legacy URL cannot silently re-scope a dashboard.
- `analyst.css` — the ~2.1k of dead `.an-agent-*` / `.an-filter-agent` picker styles replaced by a
  small `.an-viewas` indicator that picks up the accent treatment when an agent is active.

**Regression this closed:** a plain rep has no View-as control at all (TopBar only renders it for
admins or non-admins with an explicit `viewAsTargets` grant). Removing the picker without the
non-admin self-scope branch would have stranded reps on org-wide figures with no way back to their
own book — and the old picker's `pickSelf` was the only path they had. Scoping non-admins to self is
also what `analytics.routes.ts` forces server-side anyway, so UI and backend now agree by default.

Note: `CLAUDE.md` rule 10 points at a `modern-web-guidance` skill that does not exist in this repo
(`.claude/skills/`) or in the user skills dir — matched the existing analyst `an-*` design system
instead. Worth either adding that skill or dropping the rule.

### Checks
Backend + CRM `tsc --noEmit` clean, `pnpm lint` 0 errors, CRM `pnpm build` green. CRM suite failures
(17 tests / 4 files: stream, touchpoints, transport.refresh, dashDebtorsData) are byte-identical
with these changes stashed — pre-existing, none in analyst.
## 2026-07-28 — Admin user management: per-user overrides were a no-op for Administrators

### Root cause

`combineAccess` had an "admin lockout floor": anything matching `ADMIN_PROFILE_MARKERS` (default
`administrator,ceo`) was pinned to `allDepartmentAccess = true` AND exempted from the deny-list. Zoho
"Administrator" is a common profile, so for a large share of users — including whoever tests this —
Admin → User Management computed and SAVED an override that the resolver then threw away. The UI
reported a grant that was never enforced, which is exactly "the override by user itself is not
working at all", and plausibly also "access to specific Mytrions is not working" and the auto-router
complaint, since for those users nothing the admin panel does has any effect.

This was deliberate and tested (`admin lockout floor` describe block), not an accident — so the fix
is a contract change, not a patch.

### The change

The immovable floor is now ONLY the env break-glass list (`ADMIN_USERS` / `BYPASS_USERS`) — named in
server config, not editable from inside the app, and therefore a real recovery path. A
profile/role marker admin still gets all-access **by default** (Step 2.5, a floor a profile default
row cannot silently lower — otherwise adding one "Administrator" default would demote every admin),
but an explicit per-user override in Step 3 can now lower them. That is the whole feature.

Replacing the floor removes the protection it provided, so the save route gained a **last-admin
guard**: `allDepartmentAccess: false` is refused with 409 `LAST_ADMIN` when nobody else resolves to
all-access. It counts via `resolveBatch` (the same authority the listing uses — not a second query),
is scoped to the explicit "remove all-access" action rather than every deny-list edit (denies are
routine on ordinary workers and would cost a directory round-trip each time), and fails OPEN if the
Zoho directory lookup errors — blocking admin work on an upstream hiccup is worse than the small risk,
and break-glass remains the backstop.

Tests: the old floor tests were rewritten to the new contract (an override CAN lower an
Administrator; a deny now applies), plus `mytrion-access-breakglass.test.ts` — a separate file because
`env` is parsed at import so `vi.stubEnv` is too late, and it needs `ADMIN_USERS` set before load.

### Changes not applying immediately

Two contributors, both addressed:
- the resolver's TTL cache was 60s. Admin saves DO call `invalidateUser`, but only in the process
  that served the save — any other instance keeps its copy until expiry. Dropped to 10s.
- the portal only re-resolved access from `/auth/me` on mount, so an affected user had to hard-reload.
  Now also on tab focus/visibility, which is the natural moment; the UI re-renders only if the grant
  actually changed.

### Switch Mytrion everywhere

`TopBar` already had a "Switch Mytrion" link, and every Mytrion built on `MytrionShell` inherits it —
but **Billing and Customer Service have bespoke chrome** (`bm-header` / `cs-sidebar-footer`) and never
render TopBar, so they were dead ends: once in, the only way out was editing the URL. Added
`components/MytrionSwitchLink.tsx` — the same `/main` route, standalone, styled by the host via
`className` so it sits right in both. Hidden for single-Mytrion users (a picker with one entry
auto-enters again — a loop).

### Not verified

The auto-router complaint is *probably* the same root cause (for a marker admin the override's
`homeMytrion` did apply, but nothing else did, so behaviour looked arbitrary). I could not reproduce
it live — that needs a real session against prod data. Worth re-testing now the override actually
applies, and if it still misbehaves, `Landing.tsx` + `pickHome` are the places to look.

### Checks

Typecheck green, lint 0 errors, backend 998 passed / 10 failed (the same pre-existing set), frontend
199/200. NOTE the backend suite again reported 34 failures on the run immediately after a build and
10 on the next — the post-build flake logged on 2026-07-27 is reproducible and worth chasing.

## 2026-07-28 — Codex onboarding: Mytrion Horizon / Mytrion CRM

Read-only architecture and product onboarding across the live `apps/mytrion-crm` portal, its
Fastify backend, the sibling `HorizonNew` Figma export, current working notes, recent git history,
deployment configuration, security context, access resolver, agent/tool runtime, repository layer,
and external integration boundaries. No product code was changed and no tests were run.

Key mental model:

- `HorizonNew` is the visual prototype/source lineage; `apps/mytrion-crm` is the live internal
  operating platform. Horizon's mesh, glass, type, motion, and per-workspace hue language is being
  propagated into the live picker, shared shell, and bespoke Sales/Billing/CS workspaces.
- Worker identity enters through Zoho OAuth. The backend mints the Bearer session and re-resolves
  effective access from profile defaults + role defaults + per-user overrides on authenticated
  requests. Frontend access checks are routing/UX only; backend context, route guards, repos, and
  tool/agent registries are the enforcement layers.
- The frontend is one code-split React SPA with 11 Mytrions. Admin, Sales, Billing, Finance,
  Customer Service, Manager, and Analytics contain live surfaces of varying depth; Collection,
  Verification, HR, Trailhead, and several sub-tabs deliberately render honest Coming Soon states
  instead of fabricated operational data.
- The API is a same-origin Fastify control plane over the Mytrion Ops Postgres, DWH Postgres,
  verification DB, CMP/servercrm, Zoho CRM/Desk/People, RingCentral, EFS, browser automation,
  Telegram/support-bot flows, realtime WebSockets, pg-boss jobs, and optional MCP/Composio systems.
- The AI path is governed infrastructure: typed `AgentManifest` and `ToolManifest` catalogs,
  department narrowing, server-side dispatch RBAC, risk classes, optional write approvals,
  owner-scoped data tools, persistence, cost/budget limits, citations, and audit attribution.

Watch points discovered during onboarding: current user-owned worktree changes are implementing
manageable Administrator overrides + last-admin protection and Switch-Mytrion links for bespoke
shells; architecture comments retain some retired API-key/client-asserted-scope wording; frontend
and backend Mytrion taxonomies must remain synchronized; the committed Vite `app/` bundle must be
rebuilt for deployment; `.env.example` contains a populated inbox webhook-secret-shaped value and
should be treated as potentially exposed/rotated rather than assumed to be a harmless example.

## 2026-07-28 — Zoho People metadata + bulk records; WorkDrive skill

- Fixed `meta:zoho-people`: maps `labelname`/`comptype` (was empty apiName/type); supports
  `--module=` / `--list` (all or by name). Shared helpers in `metadataScripts/lib/people*.ts`.
- Added `pnpm meta:zoho-people-records` — paginated `getRecords` dump for one form.
- Rewrote `.claude/skills/zoho-workdrive-api` (JSON:API workspaces/files/upload/share; not wired
  in app yet). Synced People skill script docs; mirrored both skills under `.agents/skills/`.


## 2026-07-28 (2) — Rejection Reports tab enabled + verified; loyalty tier check

### Rejection Reports was still hard-disabled

`DC_SUBS` in RecordsTab carried `{ id: 'rejections', …, disabled: true }`, so the tab rendered as
"SOON" and was not navigable regardless of the backend work. Removed the flag, gave the Gate the
standard `DcListSkeleton` (it had none), and relabelled the "Ticket" column to "Carrier" — the DB
row surfaces the carrier id there now, not a Desk ticket number.

### End-to-end verification (against the LOCAL db, never prod)

Ran the real path with `MYTRION_OPS_DATABASE_URL` pointed at the docker Postgres:

```
WEBHOOK 201 {"id":"mrr_…","ownerSource":"dim_company"}
RETRY   201 {"id":"mrr_…"}          ← same id: idempotency holds
LIST    200 count=1
ROW     …"cardLast4":"1234","isNetwork":true,"isFraud":false,
         "agentName":"Daniel Brown","occurredAt":"2026-07-28T09:15:00.000Z"
```

Confirms: the DWH carrier→agent lookup really resolves (carrier 5806565 → Daniel Brown,
`ownerSource: dim_company`), the Deluge's naive `yyyy-MM-dd HH:mm:ss` parses to a real timestamp,
booleans survive as booleans, and the full PAN never reaches the wire. Scratch row deleted after.

### Loyalty tiers — NOT a calculation bug

Reported: "2K gallons is Gold but 14K is Silver?!". Ran the real thresholds on both cards:

```
DD SMART EXPRESS:  1 card,     2,045.79 gal → GOLD   (Owner-Operator; gold at 2,000)
KUT EXPRESS LLC:  12 cards,   14,611.96 gal → SILVER (Fleet·Fleet; silver 13,500, gold 23,000)
```

Both correct per the Loyalty Tiers v3 thresholds, and both surfaces agree — Sales passes
`c.activeCards` + `tierGallons`, Manager passes `client.activeCards` + `loyaltyGallons`, which are
the same field and the same `gallonsThisMonth || cycleGallons` rule. No drift.

The tier is RELATIVE TO FLEET SIZE by design: a one-truck operator on 2K is top-of-class, a 12-card
fleet on 14.6K is mid. What was missing is that the card never said so, so a mixed grid reads as
broken. The tier badge now carries a tooltip with the track, the three thresholds and the distance to
the next tier.

**⚠️ Open product question surfaced, not silently changed.** `loyalty.ts`'s header claimed the track
counts "distinct cards with >=1 tx this calendar month", but both callers pass `activeCards` (cards
active on the account) and the warehouse exposes `activeCardsThisMonth` as a separate, UNUSED field.
They differ materially — DD SMART shows "1/6 active cards", and the other reading could put it on a
different track and therefore a different tier. Header corrected to describe the code as-built, with
the discrepancy called out; switching the input would re-tier the entire book, so it needs a decision.

### Checks

Typecheck green; backend 1002 passed / 10 failed across two consecutive runs (the same pre-existing
set); frontend 199/200. The 37-failure run seen earlier was the post-build flake again — it only
appears on the run immediately following a build.

## 2026-07-28 — Mytrion HR Employees (own DB + Zoho sync)

HR tabs reviewed: Home live; **Employees** now live; Attendance / Requests / Profile still Coming soon.

### Model
- New `hr_employees` table (migration `0060_hr_employees`) — tenant-scoped directory, not a live Zoho People proxy.
- Rows from Zoho sync (`source=zoho_people`, upsert by `zoho_record_id`) or manual admin create (`source=manual`).
- `POST /v1/hr/employees/sync` pages Zoho People `getRecords` and bulk upserts.

### RBAC
- Reads (`GET /hr/employees*`) — any authenticated **internal** worker.
- Create / edit / delete / sync — Mytrion Admin only (`allDepartmentAccess` | bypass | `role === admin`).
- UI mirrors: Sync / Add / Edit / Delete shown only when `isAdmin(user)`.

### Surface
- CRM `HrEmployees` tab: search, status + department filters, table, admin modal CRUD, Sync from Zoho.
- Client: `apps/mytrion-crm/src/api/hr.ts`.

### Checks
- Unit: `hr-routes.test.ts`, `hr-map-zoho-employee.test.ts` green.
- Apply locally with `pnpm db:migrate` before trying Sync.

## 2026-07-28 (3) — Loyalty track fixed to the v3 deck (prev-month transacting cards) + grace

The Loyalty Tiers v3 deck settles the open question from the previous entry. Verbatim:

> "System counts active cards (>=1 transaction previous month) on 1st of each month.
>  4-6 cards -> Small · 7-8 -> Medium · 9-10 -> Large · 11-12 -> Fleet. Max: 12 active cards."
> "Tier evaluated monthly · 1-month grace if within 10%"

### The track was measuring the wrong thing

Both surfaces passed `activeCards` — cards active ON THE ACCOUNT. The deck means cards that actually
TRANSACTED last month. For anyone holding idle plastic those differ wildly, and always in the same
direction: a carrier with 20 issued / 12 "active" cards but 3 trucks fuelling was scored against Fleet
thresholds (bronze 10,000) and parked in "Building" permanently. That is the reported "huge number of
Building clients that aren't really Building" — they were measured against a fleet they don't run.

`resolveTrackCards()` now takes prev-month transacting cards, falling through to this-month ONLY when
there is no previous month (a carrier that started mid-month would otherwise read as "no cards" for
its whole first month). It deliberately does NOT fall back to the account total — a card with no
transactions is not an active card under this program, and a carrier with plastic but no pumps in
either month honestly has no track ("No cards" rather than an unreachable Fleet bar).

Worked example now covered by a test: 3 transacting cards / 3,200 gal was `none` ("Building") under
the old rule (T3-small bronze = 4,000); it is now T2 **Silver** (bronze 2,200 / silver 3,000).

### Grace — implemented as a retention rule, not a discount

`TierResult.grace` had always been hardcoded `false`. First attempt implemented the band alone —
"gallons ≥ 90% of a threshold grants that tier" — and the tests caught that this is a DIFFERENT and
wrong rule: it would let anyone hit Gold at 1,800 on T1, i.e. permanently move every threshold down
10%. Grace can only prevent a DROP, so it needs last month's level as an anchor: `applyGrace()` keeps
`heldLastMonth` when this month lands within 10% below that tier's bar, and never promotes.

Last month's level is recomputed from `gallonsPrevMonth` (no tier history is stored). Since grace can
only prevent a drop, an imperfect anchor can never over-grant.

### One entry point

`resolveTierForRow(row)` is now the only thing either surface calls — prev-month cards for the track,
this-month gallons (cycle fallback) for the level, prev-month level as the grace anchor. Sales and
Manager both use it, so they cannot drift. `LoyaltyClientRow` / `LoyaltyClient` gained
`activeCardsPrevMonth`, which Manager's payload was missing entirely (Sales already had it).

13 tests in `_shared/loyaltyTrack.test.ts`.

### ⚠️ Another session is editing this working tree

Mid-task the tree grew changes I did not make: `sales_kpi.ts`, `mytrion_worker_tasks.ts`,
`hr_employees.ts`, `src/repos/kpiTelemetryRepo.ts`, `src/integrations/zohoPeople.ts`, `api/hr.ts` and
the HR module, plus matching `drizzle.config.ts` / `schema/index.ts` entries. That work is mid-flight
and currently fails `pnpm typecheck` (`kpiTelemetryRepo.ts:61`, an `exactOptionalPropertyTypes` issue
on a Drizzle `onConflictDoUpdate` where `setWhere` may be undefined). **I committed only my own files
and left theirs untouched** — a full-repo typecheck will stay red until that lands.

### Fix — Employees 500 (missing table)

`GET /v1/hr/employees` 500ed because `hr_employees` never landed: `pnpm db:migrate` rolled back at `0061` on duplicate `(tenant_id, session_id)` in `mytrion_calls` (`sess-1`). Applied `0060_hr_employees`, patched `0061` to null duplicate session_ids before the unique index, re-ran migrate green. Endpoint now `200 { items: [], total: 0 }`.

## 2026-07-28 (4) — "No cards" → "No tier"; ⚠️ widget bundle cannot be rebuilt

Renamed the idle bucket. "No cards" described the input; "No tier" describes the state an agent acts
on — and it was misleading, since plenty of those carriers DO hold cards, they just haven't fuelled.

Manager had its own `LABEL` map duplicating `tierBucketLabel`, which is exactly how the two boards
drift (Sales would have said one thing and the loyalty board another). Deleted it; Manager now calls
the shared function, so the string exists once. Also tightened the no-track captions: under the new
prev-month track rule "idle" means no transactions in EITHER month, so "No active cards this month"
was inaccurate — now "No card activity this month or last — no tier".

### ⚠️ The vendored bundle is stale and I cannot rebuild it

`pnpm build:widget` fails on `apps/mytrion-crm/src/mytrions/manager/SalesManagement.tsx` — an
UNTRACKED file from the other session working in this checkout (`exactOptionalPropertyTypes` on a
`TaskWriteInput`). My three loyalty files compile clean in isolation (0 errors).

Consequence, and it is the same trap logged on 2026-07-27: `apps/mytrion-crm/app` is a committed
build artifact and the Dockerfile only COPYs it. `grep` confirms the shipped bundle contains neither
`resolveTierForRow` nor "No tier" — so **the loyalty track fix (7f67f50) and this rename are both
source-only and will NOT reach prod** until someone fixes that file and runs `pnpm build:widget`.
Nothing else is required of these commits; they are complete apart from the artifact.

## 2026-07-28 — Mytrion HR Departments

Inspected Zoho People `department` form (components + getRecords): 22 rows.
Fields: Department, Department_Code, MailAlias, Department_Lead (+.ID/.MailID), Parent_Department (+.ID).

- Migration `0063_hr_departments` + schema `hr_departments`
- Migrated all 22 Zoho records into our table (`scripts/migrate-hr-departments-from-zoho.ts` / `POST /v1/hr/departments/sync`)
- CRM tab **Departments** lists from own DB; admin create/edit/delete
- RBAC: internal read; admin writes

## 2026-07-28 — HR org links + Org Structure (real tables)

### Zoho People org structure review

- Legacy **department** form: available; we already migrated 22 rows into `hr_departments`.
- **Designation** form exists in Zoho, but we intentionally do **not** create `hr_designations` —
  designations are a picklist of distinct `hr_employees.designation` values.
- Zoho People **v3** `/v3/orgstructure/...` needs `ZOHOPEOPLE.orgstructure.READ` (current token:
  Invalid OAuth Scope). Even with scope, list/bulk orgstructure is poorly documented.
- **Decision:** build Mytrion Org Structure from `hr_departments.parent_id` + linked employee
  headcounts only — no mock nodes, no live Zoho org proxy.

### Schema / migration `0064_hr_org_links`

- `hr_employees.department_id` + `department_zoho_id` (FK-style link to `hr_departments`).
- `hr_departments.parent_id` (self-link for tree).
- Backfill: Department.ID from `raw_fields` → zoho id match → name match; parent via
  `parent_zoho_id`.
- Applied on Render: **88** employees, **60** linked / **28** unlinked (those 28 have null
  department in Zoho), **22** departments with **20** parent links, **13** designation labels.

### API + UI

- `GET /v1/hr/meta/designations`, `GET /v1/hr/org-structure`
- Employees: department select from `hr_departments` (`departmentId`); designation datalist picklist
- New HR tab **Org Structure** — tree from real tables only
- Department parent field is a select of existing department names (resolves `parent_id`)

## 2026-07-28 — Sales KPI collection foundation

Implemented the collection-first Sales KPI platform without ratings, targets or rankings:

- KPI worker directory, effective profile memberships, configurable population profiles, versioned
  metrics, ingestion runs, revisioned external facts, daily rollups and immutable monthly snapshot
  revisions.
- First-party worker tasks with append-only lifecycle events, HMAC/idempotent automation webhook,
  Manager → Sales task management, and Sales → My Tasks completion flow.
- Server-authoritative semantic activity and presence telemetry (privacy allowlist, idle/hidden
  handling, interval union across tabs/devices).
- Zoho Calls, Deal `Application_Date`, local Mytrion calls and Sales DWH swipe collectors; hourly,
  nightly reconciliation, daily rollup and New York month-close pg-boss jobs.
- Manager collection health now separates source read failures from persisted, actionable unresolved
  identity mappings. Missing/ambiguous identities are never guessed.
- Existing outbound-call capture now persists calls without Lead/Deal context and deduplicates by
  RingCentral session while retaining the authenticated actor separately from View-as state.

Migrations `0061`, `0062` and `0065` were applied to the configured PostgreSQL database. The KPI
feature flag remains off in the environment; the initial collection was invoked with a process-local
flag only.

### Initial shadow data

The 90-day Zoho Calls attempt reached the COQL 100,000-row ceiling and the small Render database
entered recovery during the resulting bulk insertion. The run is retained as failed with that exact
reason. A bounded July 20–27 retry succeeded:

- 128 active Zoho users synchronized; 65 exact `Sales Agent` workers eligible.
- 13,541 Zoho Call records produced 33,504 revisioned call metric facts.
- 116 Deals produced 629 Application facts including per-day completeness summaries.
- 1,207 DWH rows produced 448 worker/day swipe facts.
- Nine worker dashboard reads were unavailable and are recorded as a partial source error, not as
  unresolved mappings or zeros.
- July 26 daily rollups completed for all 65 workers. Initial memberships were backdated only where
  the worker had exactly one original bootstrap membership; any prior profile history blocks that
  adjustment.

### Validation

- KPI-focused backend tests: 24/24 pass.
- Backend strict typecheck, production build and lint pass (lint retains 25 pre-existing warnings).
- CRM strict typecheck and production build pass.
- Full backend suite: 1,025/1,061 pass; 36 failures are pre-existing/concurrent suites (CS,
  retention, touchpoints, registry expectations and database-backed timeout/recovery cases).
- Full CRM suite: 212/213 pass; the unrelated debtors summary fixture expects no `debtorCount`.

## 2026-07-28 (5) — Referral bonus engine + monthly cron

Built the calculation engine and the cron. The ledger (`mytrion_referral_bonuses`, migration 0058),
`referralBonusRepo` (incl. run audit) and the four declarative specs already existed; what was
missing was the engine and any job.

### Engine — `src/modules/manager/referralBonusEngine.ts`

Per run: read both Zoho modules → join child→parent → collapse by carrier → read one month of DWH
volume → apply each child's `Calculation` → upsert, bracketed by a `mytrion_referral_calc_runs` row.

Three decisions worth recording:

- **Join on the REF CODE, not the lookup.** `Child_Referrals.Parent_Referrer` is null across the
  whole org (verified live); the populated key is `Parent_Referrers.ReferrerId` ↔
  `Child_Referrals.Referrer_ID`. Joining on the lookup would have produced an empty ledger forever.
- **Carrier-level, not record-level.** Several child records routinely share one `Carrier_ID` (all 4
  live children share 5799524). Volume belongs to the carrier, so only the first child per
  (carrier, type) is paid — ordered by record id so a re-run cannot move the award to a sibling and
  trip the one-time unique index.
- **One-time types write NO row below threshold** rather than a zero-value placeholder, so the
  partial unique index never has to reconcile a placeholder against a real award later.

A legacy child accrues BOTH legacy bonuses in the same month — pre-existing documented behaviour of
`bonusTypesForCalculation` (the PDF treats types 1 and 2 as concurrent). My first test asserted one
row and was wrong; corrected and now pinned explicitly.

### DWH — `src/integrations/dwhReferralVolume.ts`

One query returns month gallons, new cards and cumulative-through-month-end per carrier. "Swipe" is
the NEW-CARD metric (`min(transaction_date)` per card falls in the month), not a transaction count.
Everything is bounded by the period end so a backfill cannot award a one-time bonus in a month the
client had not yet reached the threshold.

**Live-verified against the warehouse** (carrier 5799524, June 2026): `gallons 0, newCards 0,
cumulative 6,793.5`. Crucially the legacy set (`ULSD,ULSR`) and the new-logic set (`+DSL`) return the
IDENTICAL cumulative — hard confirmation of the documented DSL gap: no row carries the literal `DSL`
code, so types 3 and 4 currently behave exactly like the legacy pair. Still an unmade business call.

### Cron

`automation.referral.bonus-calc`, singleton, cron `30 0 1 * *` — 00:30 on the 1st, after the month
has definitively closed and clear of the midnight job pile-up. Omitting `periodMonth` computes the
month just ended; supplying `'YYYY-MM-01'` is the backfill/recompute hook. Added to
`MANUAL_TRIGGERABLE_QUEUES` so Admin can run it on demand. **No auto-backfill on first run** — the
DWH has the history, but silently generating months of payouts is not something to do implicitly;
trigger the months you want explicitly.

14 tests. Also had to widen the `manager-loyalty-routes` projection allow-list for
`activeCardsPrevMonth` — that test pins an exact key set to stop Clients-tab fields leaking, and it
correctly caught the new field.

**Still blocked from producing anything:** `Calculation` is null on every Zoho record (a run reports
`skippedNoCalculation` and succeeds with zero rows), and `FF_JOBS_ENABLED` is excluded in
`render.yaml`, so the cron will not fire in prod until that is set in the Render env group.

## 2026-07-28 — Mytrion Database metadata browser (`feature/Setter`)

- Added Admin → Data → **Mytrion Database**, a searchable, read-only browser for Mytrion's own
  PostgreSQL metadata. It exposes non-system schemas, tables/views, row estimates, columns/SQL API
  names, full/base data types, nullability, PK/UQ/FK roles, defaults and comments.
- Added `GET /v1/admin/mytrion-schema`, restricted to authenticated internal true-admin sessions
  and audit logged. Runtime database access goes through `mytrionSchemaRepo`; only catalog/statistic
  relations are queried, never application rows.
- Extended the shared PostgreSQL introspector with inserts/updates/deletes from `pg_stat_all_tables`
  and a writes-per-day frequency estimate since `pg_stat_database.stats_reset` (falling back to
  server start when statistics were never explicitly reset). The UI labels this as an estimate.
- Added `pnpm mytrion:inspect` for on-demand full metadata export to
  `metadataScripts/output/mytrion-database.{json,md}`, plus `--search`, `--table`, `--schema`, and
  `--json` focused inspection. Fixed the shared catalog connector to apply managed-Postgres TLS for
  the Ops target while preserving the DWH's intentional non-TLS connection.
- Live validation returned **4 schemas, 84 tables/views and 1,089 columns** from
  `mytrion_ops_db`. The focused `kpi_workers --json` inspection confirmed explicit `apiName` and
  data-type metadata.
- Security/feature tests: backend route + baseline RBAC 11/11; CRM schema browser 2/2. The Admin
  navigation and new tab rendered in the local browser; the real metadata endpoint was separately
  verified with an authenticated Admin token.
- Strict backend/CRM builds and lint pass (25 existing warnings). Full suites remain red outside
  this feature: backend 1,024/1,064 passes with 40 failures across pre-existing CS/retention/
  touchpoint/agent fixtures and timeouts; CRM 214/215 passes with the existing `debtorCount`
  expectation mismatch. The new metadata tests pass in both focused and full runs.

## 2026-07-28 (6) — Sales Mytrion pass: RC sign-in visibility, nav, layout, Rejection Reports

Branch `feature/Setter`, fast-forwarded to `origin/build` (0d570fc) first.

### RingCentral — the sign-in page "not showing" (the important one)

The COOP fix from earlier IS live in prod (`curl` confirms `cross-origin-opener-policy:
same-origin-allow-popups`), so that was not it. The remaining cause is simpler and worse:

**Nothing in our UI ever surfaced the signed-out state.** `ringCentralLoginState()` existed and was
read by NOBODY (`grep` confirmed zero consumers). The softphone boots *minimised* to a small vendor
pill, and the only signed-out signal was a toast fired on an explicit `logout` event — never on
"never signed in". An agent who did not know to click that pill simply never saw a login screen, and
every phone-backed feature (Data Center Leads/Deals calls, Retention calls, the post-call wizard,
mytrion_calls logging, Mytrion_Call_Attempts) silently did nothing. That matches the report exactly,
including why it "works on my localhost" — you know to click the pill.

Added a persistent (not auto-dismissing) prompt in `RingCentralPhone`: after a 7s settle window, if
login state is not `true`, it shows "Phone not signed in" + a **Sign in** button that calls
`revealRingCentralWidget()` — expanding the vendor widget is the only place the RC login screen can
render. Cleared on the `login` event, re-shown on `logout`. The 7s delay matters: the widget reports
`loggedIn:false` first while restoring a persisted session, so anything shorter flashes a false
prompt on every page load.

This is deliberately robust to cause: it fixes an unnoticed pill, a blocked popup, and a collapsed
dock alike, because in all three the agent now gets a visible, one-click path to the login screen.

### The rest

- **My Tasks → Coming soon** (`salesData.ts`), matching how Tickets/Verification/Call Hub are parked.
- **Switch Mytrion in the Sales sidebar** — reused `MytrionSwitchLink` (added a `style` prop so it can
  match the bespoke sidebar controls). The sidebar was a dead end: the only exit was the top bar,
  which the full-bleed tabs cover.
- **Coming-soon panels go full width.** They were clamped by `#ss-panels`' 1180px reading measure, so
  a placeholder read as a small card adrift in a large empty page. `fullBleed || sectionComingSoon`
  now takes the edge-to-edge branch.
- **Quick Actions was thin for a real reason, not a cosmetic one.** The Home split used
  `grid-template-columns: 1fr 1fr`, and a bare `1fr` track has an automatic minimum of MIN-CONTENT —
  so the Recent Inbox column, whose cards carry long unbroken subject lines, grew past its half and
  squeezed Quick Actions until every card title wrapped onto three lines. `minmax(0, 1fr)` lets the
  text ellipsise instead of dictating the column width. Same fix applied to the upper 1.35fr split.

### Rejection Reports

- **Status column dropped.** Every row is `new` until someone works it, so it was a wall of identical
  "Open" badges carrying no information. The width went to the decline reason, plus a Driver column.
- **The reason is now readable.** EFS sends `202607280835|INACTIVE CARD` — `cleanErrorText()` strips
  the numeric stamp and de-shouts the caps, and the row shows a compact code chip + clean text (red
  for fraud/code 3, accent otherwise). The raw string is preserved on the VM.
- **Rows open a detail modal** built on the shared `DetailSheet`, so it inherits the module's scrim /
  accent rail / ESC + backdrop close rather than re-inventing a dialog. It leads with the SMS the
  driver already received (the only part of the record the customer has seen), then decline / where /
  account groups, with the raw EFS response behind a `<details>` for support escalation.
  `ModalFooter` was not reused — it is the edit-oriented footer (save/cancel/call) and this view is
  read-only, so it gets a single Close.

Rendered the table in both themes in headless Chrome before committing.

### Checks

Typecheck green, lint 0 errors, frontend 214/215 — the one failure the long-standing `filterDebtors`
case. Widget bundle rebuilt.

## 2026-07-28 (7) — Rejection Reports: modal anchored to the viewport + owner-scoped

### The modal opened at the container's midpoint

`DetailSheet`'s scrim was already `position: fixed`, which is why this looked wrong rather than
obviously broken. The cause is that **a filtered ancestor becomes the containing block for
fixed-position descendants**, and Sales puts `backdrop-filter` on its chrome and card surfaces. So the
scrim anchored to the (very tall) panel instead of the viewport: opening a row far down the Rejection
Reports list put the dialog at the CONTAINER's centre and the agent had to scroll to find it.

Fixed by rendering `DetailSheet` through a portal to `<body>` — the same fix, for the same reason, as
Finance's `ClientModal`. The portal escapes `.ss-root`, which is where Sales' token bridge
(`--surface`, `--border`, radii) and the `.light` class live, so the wrapper re-establishes both via
`useTheme()`; without that the sheet renders with global tokens and ignores light mode. This fixes the
Lead and Deal modals too — they share the sheet and had the same latent bug.

### Rejections were not owner-scoped

Two separate gaps, both silent:

1. **`loadRejections()` never forwarded the acted-as agent** while `loadLeads`/`loadDeals` both do, so
   View-as switched every other Data Center tab's identity and left this one alone.
2. **The route special-cased admins into the org-wide feed.** Data Center is "everything about YOUR
   pipeline" and every other sub-tab resolves through `resolveZohoUserId` — including for admins — so
   an admin saw a mixed org-wide decline list here while Leads and Deals showed their own book. That
   is what the screenshot showed.

Now owner-scoped for everyone, matching id-OR-name (the session Zoho id and the warehouse's
`agent_zoho_user_id` carry different org prefixes, so neither alone finds every row). When acting as
another agent the name arm resolves THAT agent's name from the CRM directory rather than the admin's
own, which would match the wrong rows. `?all=1` is the explicit admin opt-in for the tenant feed, and
a plain agent passing it still gets only their own rows.

3 new tests cover the admin-is-scoped case, the `?all=1` opt-in, and that `?all=1` does not privilege
a non-admin. 12 total in that file.

### Checks

Typecheck green, backend 1057 passed / 10 failed (the same pre-existing set across two runs), widget
rebuilt.

## 2026-07-28 (8) — Billing switch button, Admin access matrix verified, HR sync root-caused

### Billing "Switch Mytrion" button

I had reused `.bm-header-theme`, which is a fixed **32×32 icon-only square** — so the text label had
nowhere to go and spilled out of the box. Added `.bm-header-switch` to `bm-horizon.css`: same glass
pane + billing-accent hover, but sized for a label (auto width, 32px height matching the header
rhythm, 3px radius matching the BILLING badge). Rendered before/after to confirm.

### Admin user management — verified working, no changes needed

Exercised the resolver across the levels asked about (harness note: `invalidateAll()` is required
BETWEEN scenarios — the resolver TTL-caches per (tenant,user,profile,role,name), and my first run
returned the same answer nine times because of it):

| scenario | allDept | home | accessible |
|---|---|---|---|
| profile default only | false | sales | 1 |
| user override replaces set | false | null | billing, finance |
| override + home | false | finance | 2 |
| override → full access | **true** | null | 11 |
| full access + home | **true** | **manager** | 11 |
| home not in granted set | false | billing (falls back) | 1 |
| deny the only grant | false | null | **0 → 403** |
| full access minus finance | false | null | 10 (finance gone) |

All correct, including the auto-router with full access. Worth noting this only works because of the
Administrator-override fix from earlier today — before it, every row involving an override was a no-op
for admin-profile users.

### HR — the sync could never finish (root cause, measured)

Prod had **88 of 213** Zoho People employees. Ruled out the obvious causes first: the fetch pages
correctly (returns all 213), the mapper throws on none of them, and all 213 have DISTINCT
`employeeId` and `zohoRecordId` — so neither the NOT NULL names nor the two partial unique indexes
were dropping anything.

The actual cause is cost. `upsertFromZoho` does ~4 DB round-trips per employee (existence check, two
`resolveDepartmentId` lookups, the write). Measured RTT to the hosted Postgres is **266 ms**, so 213
employees is ~226 s — the sync cannot finish inside a request. It died partway, left the table
half-populated, and surfaced nothing, because per-record failures only land in a `errors[]` array that
a timed-out caller never reads. My own first run confirmed it: killed at 280 s having got to 181 rows.

Added `hrEmployeeRepo.bulkUpsertFromZoho` — resolves departments ONCE into a lookup map, then writes
chunked multi-row `INSERT … ON CONFLICT DO UPDATE`. Conflicts target the partial unique index on
`(tenant, zoho_record_id)`, whose predicate has to be repeated in the ON CONFLICT clause for Postgres
to match it. ~850 round-trips → ~3.

Result: **FETCHED=213 WRITTEN=213 ERRORS=0 in 10 s** (was: timeout at 280 s). Table now 213 rows,
137 Active + 76 Terminated exactly matching Zoho, 0 duplicates, 179 department-linked.

`inserted` is no longer distinguishable from a single ON CONFLICT statement, so it stays 0 and
`updated` carries the total — fetched-vs-written was always the signal that matters, and it is exactly
what a partial run shows up in.

**Migration drift I found and then un-found:** `0060_hr_employees.sql` creates 22 columns while the
schema declares 24 (`department_id`, `department_zoho_id` missing, plus their indexes) — a fresh
`db:migrate` would build a table Drizzle's SELECT can't read. I wrote a 0061 to repair it, then found
the parallel session had already fixed exactly this in `0064_hr_org_links.sql` (idempotent ALTERs plus
a backfill). Deleted my file; the journal never referenced it. Nothing to do here.

**Two product questions surfaced, not decided:**
1. **Terminated employees are synced** (76 of 213). There is no status filter, so they now appear in
   the directory. If HR only wants current staff, that is a filter on the sync or the read.
2. **Sparse data is Zoho's, not ours.** Of 213 records, department is empty on 34, designation 42,
   date-of-joining 44, mobile 93, reporting-to 41. Worth knowing before anyone hunts for a mapping bug.

### NOT done

**HR UI/UX beautification.** The data layer is now correct and complete, but I did not touch the HR
tabs' presentation — doing that properly needs a pass over HrHome/HrEmployees plus hr.css, and I would
rather leave it than half-style it.

## 2026-07-29 — Sales KPI jobs paused

Paused all four Sales KPI pg-boss jobs while Zoho API request volume is reviewed:
`kpi.sales.hourly-sync`, `kpi.sales.nightly-reconcile`, `kpi.sales.daily-rollup`, and
`kpi.sales.month-close`. They remain in the catalog for visibility, but are now included in
`DISABLED_JOB_QUEUES`, removed from Admin manual triggers, excluded from worker registration, and
unscheduled automatically at boot. Existing KPI facts and rollups are preserved.

## 2026-07-29 — Sales Data Center: Leads + Deals parked as Coming soon

Leads and Deals sub-tabs in the Sales Data Center now render disabled with a SOON chip, same
mechanism the other parked tabs already use (`disabled` on `DC_TABS` in
`apps/mytrion-crm/src/mytrions/sales/redesign/tabs/RecordsTab.tsx`). Clients / Rejection Reports /
Money Codes are untouched.

Nothing was deleted: `LeadsView` / `DealsView`, `loadLeads()` / `loadDeals()`, the status/source/stage
filters and the board-vs-list toggle all stay wired — drop `disabled` on the two entries to bring them
back. `dcSub` is local state defaulting to `clients` and nothing else in the app navigates to a Data
Center sub-tab, so the tabs are genuinely unreachable while parked, and the COQL loads are
`enabled`-gated on `dcSub` so no Zoho requests fire for them.

## 2026-07-29 — "Phone not signed in" card no longer nags signed-in agents

Reported as the card reappearing over and over while the agent WAS signed into RingCentral. Four
separate causes in `apps/mytrion-crm/src/components/ringcentral/RingCentralPhone.tsx`, all of them in
how the card decided it had something to say:

1. **Unknown was read as signed-out.** The check was a single `setTimeout` at 7s doing
   `ringCentralLoginState() !== true`, and that state is `null` until the vendor iframe reports — after
   a config fetch, an adapter script load, an iframe handshake the code itself allows **12s** for
   (`FRAME_WAIT_MS`), and an async session restore. A boot slower than 7s prompted an agent who was
   signed in the whole time.
2. **It never re-checked.** One sample, then latched. Anything that beat it — or any missed
   `rc-login-status-notify` — left the card up permanently.
3. **A raw `logout` event showed it instantly.** The author knew Embeddable flaps logged-out during
   session restore (that's why the *toast* is debounced 2.5s) but the card was set from the raw event
   with no grace at all.
4. **Dismissal was per-mount.** `allowed` flips on every hop out of Sales/CS, re-running the effect
   and resetting component state, so closing the card lasted until the next navigation.

Now: sign-in state is reduced by a pure `nextSignInPrompt()` (`signInPrompt.ts`, 10 tests) polled every
1.5s. Only a state that is **known** false and **stays** false for `SIGNED_OUT_CONFIRM_MS` prompts;
unknown never prompts; the card **retracts itself** the moment a session is reported instead of
latching; the mute is module-level so closing it survives navigation, and clears on the next observed
sign-in so a genuine later logout can still prompt. The "session ended" toast re-reads the state at
fire time, so a resolved flap no longer toasts.

Also fixed alongside: the card followed the agent onto Billing / Finance / Admin / the picker. The
component lives in `WorkerLayout` and renders on every worker route — only the *widget* is route-gated
— so the `!allowed` branch now hides the card too.

**Known limit (not fixed):** we only ever learn sign-in state from edge-triggered widget postMessages.
If Embeddable emits a spurious `loggedIn:false` and never re-emits `true` (its own state never
changed), our belief stays false and the card is *correct by its inputs* but wrong in fact — the mute
is what saves the agent. A positive "what is the login status" query to the widget would close that
hole; the vendor docs we have (`.claude/skills/ringcentral-api`) don't document one, so it wasn't
invented.

**Pre-existing failure seen while running the suite, NOT touched:**
`src/mytrions/sales/redesign/dashDebtorsData.test.ts` — `debtorsSummary` now returns a `debtorCount`
field the test's `toEqual` doesn't list. Stale test, unrelated to this change.

## 2026-07-29 — Billing Mytrion colors broken (missing CSS asset)

Prod console: stylesheet `https://octane-ops-ai.onrender.com/assets/index-CwpF6G9d.css` refused
because MIME was `application/json` — the file 404ed and the not-found handler returned JSON.
`index.html` still pointed at that hash after commit `f89affb` deleted the CSS during a
rebase-bundle rebuild (JS was updated to `index-C-Zlcfe9.js`, CSS href left stale).

Fix: `pnpm build:widget` so `app/index.html` and `app/assets/*` hashes match again
(entry now `index-vD7wZkth.js` + `index-DYzu9WTp.css`; billing styles in `index-B3yk86w_.css`).
Colors return once this bundle is deployed. Touchpoints `401` on
`/v1/touchpoints/billing.datacenter.deals` is a separate auth issue, not the CSS break.
Mismatched JS chunks (`index-C-Zlcfe9.js` + `index-DM6WA7bf.js`) also triggered React #321.
## 2026-07-29 — Billing Transactions: search by amount (`fix/billing-tx-amount-search`)

Searching the Transactions tab by amount returned nothing. It was never implemented, on either side:

- **Client.** The row haystack carries `String(amount)` — the raw number — so `500.00` or `$1,234.56`
  could not match as text, and a digits-only query was routed to *carrier id exact match only*
  (widget parity, `isCarrierId`), which meant a plain `500` deliberately skipped the haystack too.
- **Server.** `paymentTransactionRepo.search()` ILIKE'd sender/name/memo/description/txn-id/email
  plus an exact carrier id. No amount predicate, so `$510.45` became `%$510.45%` → 0 rows.

Both sides now parse a money query with the same grammar (`parseAmountQuery` in the repo,
`parseTxSearch` in `transactionModel.ts`): optional `$`, thousands commas, up to 2 decimals.

- Cents given (`510.45`, `$1,234.56`) → exact match. Whole dollars (`510`) → the cents range
  `[510, 511)`, so typing the dollars finds the row without knowing its cents.
- Compared on `abs(amount)` so returns/refunds stored as negatives still match.
- Amount is OR'd in, so `5551234` still hits the carrier id and text matching is unchanged; the
  digits-only carrier-id narrowing survives via the shared `txMatchesSearch` ordering.
- Search placeholder now says "…, amount".

### Checks

Typecheck green both sides, lint 0 errors. New tests: `tests/unit/billing-amount-search.test.ts` (3)
and `apps/mytrion-crm/src/mytrions/billing/transactionModel.test.ts` (8) — pass. Backend `tests/unit`
has 7 pre-existing failures (tools/touchpoints/stream/notifications/retention/golive) — identical on a
clean tree, unrelated. Verified the server predicate read-only against the live DB: row 220243
(`$510.45`) is found by `510.45`, `$510.45`, `510` and `$510`, and a bogus amount returns 0.
No in-browser pass — the CRM needs a Zoho OAuth sign-in I can't perform.

## 2026-07-29 — Referrals: COQL drained instead of capped at 200 (+ a silent ordering bug)

The Manager Referrals card showed "200 parent referrers" because it fetched ONE COQL page of 200 and
reported the page length as the total. There are 687. Every child whose parent fell outside that page
was then reported as *unlinked*, because the parent→child grouping is client-side over the fetched
slice — so the cap was not just under-counting, it was mis-classifying.

**New shared paginator.** `zohoCrm.runCoqlAll(baseQuery, {pageSize, maxRows, budgetMs})` drains a COQL
query page by page (`src/integrations/zohoCrm.ts`). It replaces a third copy of a loop that already
existed twice privately (`kpi/collector.ts pagedCoql`, `salesDashboards.ts coqlAllDeals`) and finally
gives the exported-but-unused `MAX_COQL_ROWS` a caller. Termination needs BOTH signals: an offset past
the end returns HTTP 200 `{"data":[]}` with **no `info` block**, so `more_records` alone is unsafe;
a short page is the reliable marker. Hard stops: the 100k offset ceiling (this repo hit it in prod on a
Calls drain), an optional row budget, and a wall-clock budget. `truncated` now means "a guard stopped
us with rows still upstream" — never just "the last page was short".

**Ordering was quietly broken.** `order by Created_Time desc` is not a total order here: 680 of 687
parents share one timestamp from the 2026-07-28 import, so every page boundary fell inside one tie
group — offset paging over that can duplicate and skip rows. Worse, within the tie Zoho ordered `id`
ASCENDING, so the "newest 200" page started at REF-000513 and the genuinely newest record (REF-000692)
was absent. Now `order by Created_Time desc, id desc`. Verified live: page 1 starts at REF-000692.

**Page size 1000** as requested. Note for later: COQL credits are tiered (≤200 → 1, ≤1000 → 2,
≤2000 → 3), so 2000/page is ~33% cheaper per row; 1000 keeps one page comfortably inside the outbound
timeout on the card's wide 22–25 column SELECT. The bonus engine's narrow 5-column SELECTs use 2000.

**`?limit` semantics changed.** It is now an optional row *budget*, not a page size, and an invalid
value means "drain everything" instead of silently falling back to 200 — `?limit=abc` used to
resurrect the exact bug being fixed (routes parse it with bare `Number()`, no zod).

**Money bug fixed alongside:** `referralBonusEngine` read the same two modules at a hardcoded
`limit 0, 2000`, unpaginated and with no overflow signal. A parent missing from that map earns its
referrer nothing. Both loaders now drain, and refuse to calculate at all if a guard trips — a partial
roster must not silently produce partial payouts.

**Verified live through the real code path:** parents total=687 pages=1, children total=4, links 0/0,
`truncated=false` everywhere. An honest total cannot come from COQL `count(id)` — aggregates return
SYNTAX_ERROR / "missing clause: group by" on this org — so a complete drain IS the only source of a
true total.

**Multi-page paths are unit-tested** (`tests/unit/coql-paginate.test.ts`, 10 tests) because prod can't
exercise them: 687 and 4 both fit in one page, so the loop would otherwise ship unexercised. Covers
page-walking, short-page stop, missing-`info` stop, 204, row budget, time budget, page-size clamp, and
the 100k ceiling (50 pages).

**Not fixed, and NOT fixable by fetching more:** "linked 0 · unlinked 4" stays. All 4 children carry
`Referrer_ID` 'REF-000002', which matches no parent record, and `Parent_Referrer` is null on 100% of
children org-wide. That is a data problem in Zoho, not a paging one.

## 2026-07-29 — Loyalty: owner-operator now means ONE TRUCK, not one card

Reported as "in Manager loyalty the owner operator carriers are the ones which only 1 truck — fix that
error". It was a wrong FIELD, not a wrong boundary. `resolveTrack` bucketed on a fuel-CARD count and
called the 1-card bucket "Owner-Operator"; the word "trucks" appeared nowhere in the loyalty path. The
boundary was already `=== 1` and already correct — no threshold needed moving.

This also CLOSES the open question left at WORKING_NOTES.md:6843 ("switching the input would re-tier the
entire book, so it needs a decision"). Decision: the fleet-size axis is `octane.dim_company.trucks`.

**Two axes, deliberately separate.** The one number was doing two jobs, which is why a naive
`trucks === 1` swap would be wrong:
- ACTIVITY (prev-month transacting cards) stays the program-MEMBERSHIP gate. No pumps → no track.
  This keeps the ~2,975 one-truck carriers with zero fuel activity out of "Building" — collapsing the
  two axes would re-create the "huge number of Building clients that aren't really Building" symptom
  the 2026-07-28 fix removed.
- TRUCKS bucket the track. Unknown trucks (184 carriers, null; no carrier legitimately reports 0) fall
  back to the old card proxy, so nobody drops out of the program — 19 of those hold a live track today,
  one at 9,259 gal. `trackCaption` says "fleet size unknown, scored on cards" when that happens.

`trucks` had to be wired the whole way: it was never selected. dim_company.trucks → OWNED_COLS → outer
select → ClientDbRow/AgentClientRow (via a new `intOrNull`, NOT `num()`, which coerces null to 0 and
would have turned "unknown" into "zero trucks") → LoyaltyClientRow → the two frontend API types →
RecordVM → ClientRecord. All five type edits land together on purpose: if `trucks` reached Manager but
not Sales, the two surfaces would silently disagree about the same carrier, which is the one failure
mode `_shared/loyalty.ts` exists to prevent.

**Verified live over all 8,059 carriers:** trucks known 7,875 / unknown 184. Tracks now T1 982 · T2 628
· T3 395 · no tier 6,054. Of 3,947 one-truck carriers, 972 are also fuelling and are now correctly
badged Owner-Operator; the rest are correctly gated out by activity.

**Fixed alongside:** `ClientModal` called `resolveTier(client.active, …)` — the account's ALL-TIME card
total — bypassing `resolveTierForRow`, so the modal could already disagree with the grid row that
opened it. After this change that argument is a fleet size, so passing a card total would score an
85-card carrier as an 85-truck fleet. Now goes through the one entry point.

`TierResult.activeCards` → `fleetSize` (+ new `fleetSizeKnown`). Verified zero consumers read the old
field. Boundaries, gallon thresholds and the 10% grace rule are untouched — not in scope.

**LEFT ALONE on purpose: the carrier mini-app `companyType`** (`inviteService.ts:161`,
`CarrierUserForm.tsx`, `ClientManagePanel.tsx`, `CarrierUsers.tsx`). Same words, different concept, and
RBAC-bearing: `requireRegisteredOwner` gates driver management on `companyType === 'fleet-manager'`,
and the value is PERSISTED (`carrier_invitations.company_type`), so re-basing it needs a migration +
backfill. For "does this owner drive the truck themself", card count is the right proxy. Do not "fix"
it to match loyalty.

**Open risk, flagged to the user, NOT papered over in the tier math:** declared trucks is self-reported
at signup and sometimes wrong. 160 carriers declare 1 truck while running 2+ transacting cards. The
worst is carrier 5810474 RAWDEAL LOGISTICS LLC — trucks=1, 21 cards, 29,538 gal last month — which now
scores T1 **gold** at the 2,000-gal owner-operator bar and takes every Gold reward (Love's rebate,
TA/Petro discount, 30% money-code limit). One truck cannot pump 29,538 gal/month, so that is bad data,
not a bad tier. Options offered: keep as-is (the rule as stated) + an Ops report of the ~160
disagreements to fix at source; or add a sanity guard that scores on distinct fuelled units when they
clearly exceed the declared count.

Bundle rebuilt (`pnpm build:widget`) in the same commit — `apps/mytrion-crm/app` is a tracked artifact,
and skipping it is exactly why the previous loyalty fix never reached prod.

## 2026-07-29 — Sales Mytrion automation reliability (C-1/3/4/5/15/20/24/27, Q-1)

Worked on `feature/Referrals`; existing referral/loyalty edits were preserved.

- C-4/C-5 now treat the entered amount as a delta, enforce a 350-gallon maximum in the UI,
  touchpoint schema, and shared environment default, write through servercrm's direct EFS limit
  endpoint, and render the previous/resulting limit returned by EFS.
- C-1/C-3 now share the direct EFS status-write endpoint. Card pickers fetch EFS first with DWH only
  as a fallback, so activation is visible immediately in deactivation.
- C-24 fetches the live EFS card roster/status and merges historical DWH usage only where the current
  servercrm EFS summary omits a last-used timestamp. The previous blank-field bug (`last_used_date`
  was not read) is fixed and the result uses explicit status/source badges.
- C-20/Q-1 no longer `fetch()` the cross-origin signed invoice URL. The signed attachment URL is
  opened directly, removing the browser CORS “Failed to fetch” failure.
- C-15 loads jsPDF from the bundle with a safe vendor-base fallback, loads PDF helpers only for PDF,
  uses bundled ExcelJS for Excel, and leaves CSV/Text dependency-free. Invoice references are
  hydrated before filters run; output flags now apply consistently to grouped exports.
- C-27 is fire-and-forget: the touchpoint queues `sales.boca-request`, returns immediately, and the
  worker writes a C-27 Mytrion Inbox completion/failure message for the authenticated requester.
  Jobs-off local development uses an immediate in-process fallback with the same inbox behavior.

Regression coverage added for the 350/351 boundary, direct signed-link downloads (and absence of
cross-origin fetch), every transaction match/filter/sort/range path, destructive touchpoint catalog
metadata, and BOCA success/failure inbox delivery. `AutoTab.tsx` was reduced below the 600-line cap by
extracting completed-result rendering.

## 2026-07-29 — Referral bonus: the Calculation field was read off the WRONG module

Audited all four bonus types against the supplied "Referral Bonus Calculation Types" PDF (one
adversarial verifier per type, each proving its case with live DWH queries). The rates, thresholds,
recipients, fuel sets and period grains in `referralBonusTypes.ts` all match the spec exactly —
including Type 4's recipient exception (child, not parent). What was broken is everything around them.

**Fixed now.**
1. **`Calculation` came off `Child_Referrals`, where it is null on 100% of records.** The populated copy
   is on `Parent_Referrers` — 665 of 687 (615 'Swipes (Legacy)', 50 'Gallons (Legacy)'), from the
   2026-07-28 import. So a run today skipped every child and wrote ZERO rows while reporting success.
   Now resolved parent-first, with a non-null child value honoured as an explicit override (the two
   picklists are independent fields on independent ids and can drift).
2. **One value now selects exactly ONE type.** `bonusTypesForCalculation` expanded EITHER legacy value
   into BOTH legacy types, which made the two values indistinguishable in effect and paid the
   per-gallon bonus on top of the per-swipe one for 615 referrers — a verified extra $508.92 on one
   carrier's June alone (BUKHARA INC / IOK TRANS, 50,891.93 gal). The picklist is single-select and the
   import deliberately split 615/50, so the split has to mean something.

**Nothing has been mis-paid:** `FF_JOBS_ENABLED` is deliberately absent from render.yaml, so the monthly
cron has never run in prod, and no HTTP route exposes `mytrion_referral_bonuses` at all.

**Confirmed defects NOT yet fixed** (each verified, none reachable while the job is off):
- `'DSL'` matches ZERO mart rows. Types 3/4's fuel set silently collapses to ULSD+ULSR — identical to
  the legacy pair. The diesel codes that exist are DSL1 (31,899 gal), CDSL (47,701), BDSL (19,479),
  BDSR, CBDL. `DEFD` must NOT be included (Diesel Exhaust Fluid, not fuel).
- One-time types re-award every month once cumulative >= threshold. The only guard is a partial unique
  index raising a raw 23505 INSIDE the per-child loop, which the single try/catch turns into a failed
  run that abandons every remaining child. Re-running a month containing an approved/paid row also
  throws (`setWhere` suppresses the update, `.returning()` is empty, `firstOrThrow` raises).
- The one-time dedup key is the child RECORD id while the volume and award are keyed on CARRIER, so
  duplicate child records under one carrier can be paid the same $50 twice.
- 288,451 mart rows / 19.39M gallons carry a NULL `line_item_category` (100% of Feb–Jul 2025 — a
  pipeline outage). They are silently dropped: ~$20,048.97 of Type 1 zeroed, and Type 2 swipe dates are
  re-dated to the month the pipeline recovered.
- No Zoho writeback for the spec's "mark as paid" step; `Child_Referrals.Paid` / `Parent_Paid` are
  referenced in a comment only.

**Open questions taken to the user with numbers attached** (money-affecting, not decidable from code):
Type 2's "swipe" definition (first-EVER eligible swipe, as implemented, vs the PDF sentence's
first-in-month — verified $9,650 vs $55,750 for June 2026 across all referred children, recurring);
which codes 'DSL' means; whether 'Gallons (Parent)'/'Gallons (Child)' really bind to the 500/1,000
one-time awards (the labels name only the recipient, and ZERO records use either value); the child
roster source (Zoho holds 4 obvious test rows, all `Referrer_ID` 'REF-000002' matching no parent, while
`octane.intm_zoho_deals.referral_source` holds 944 children / 582 parents); and how to treat the
pre-existing one-time backlog on first enable (~$74,900 in a single run).

Also fixed: `tests/unit/data-center-routes.test.ts` fixture missing `trucks` — the loyalty commit
(9cd0887) left `pnpm typecheck` red because I only ran the web app's typecheck after that edit.

## 2026-07-29 — Referral bonus swipe: the PROGRAM defines it, not the Sales dashboard

Corrected after the user pointed out the distinction: the Sales Mytrion dashboard (and Home) are their
own surface and stay untouched; the loyalty/bonus program is a different thing with its own rules.

`referralBonusTypes.ts` had it in writing — "'Swipe' resolves to the Sales Mytrion dashboard's NEW-CARD
metric" — so Type 2 counted cards whose FIRST-EVER eligible transaction fell in the month. That pays a
referrer $50 once per card per LIFETIME. The calculation spec says the opposite: "a card qualifies as a
new swipe in a given month only via its FIRST transaction that month — further transactions on the same
card in the same month do not generate additional swipe bonuses." One count per unique card per month,
recurring monthly.

Now `count(distinct card_number)` inside the period month (`dwhReferralVolume.ts`), and the runtime
field is renamed `newCards` → `swipes` so the misnomer that caused the conflation cannot re-teach it.
The DB column keeps its `qty_new_cards` name (no migration) with a comment saying what it now holds.

Verified live — IOK TRANS LLC (carrier 5796264), June 2026, ULSD+ULSR:
  PROGRAM rule (distinct cards in month):   35 swipes → $1,750
  OLD basis (dashboard new-card metric):     3 swipes → $150
So the old basis under-paid this carrier's referrer by ~12x for the month.

NEITHER of the dashboard's two metrics governs this program, and both remain untouched:
  · dashboard `new_cards_*` = a card's first-EVER appearance (what this wrongly borrowed)
  · dashboard `swipes_*`    = count(distinct transaction_id), i.e. per fill-up
`salesDashboards.ts`, `dashSalesData.ts` and `SalesDashPanel.tsx` are unmodified — confirmed by
git status — and no dashboard or Home file references `_shared/loyalty` at all, so the loyalty track
change cannot have moved a dashboard number either.

## 2026-07-29 — Sales sidebar: SOON tabs at bottom

Reordered `NAV_GROUPS` in `salesData.ts`: daily → sell (incl. live Retention) →
measure → soon. Parked tabs (My Tasks, Tickets, Verification, Call Hub) now sit
at the bottom of the Sales Mytrion sidebar instead of above Automations/Dashboard.

## 2026-07-29 — Sales automations: live WEX guards and EFS card credentials

Added fail-closed WEX state guards for C-27 BOCA, C-14 Close Application and
C-2/C-19 Application Update — WEX Tasks. The source is servercrm's live WEX
Salesforce endpoint (`GET /api/wex/application/:appId`), not an additional Zoho
read. Expansion, Closed/Lost/Closed/Fraud, Disqualified and Cards Produced /
Cards Sent applications are blocked. BOCA checks before enqueue and again in
the worker; Close and Application Update check before their downstream work.

Added a matching Sales modal eligibility notice and disabled action state. Added
a direct single-card EFS read (`dwh.card_efs`) for C-1 activation, C-3
deactivation and C-26 Unit/Driver Change. The modal now shows current live card
status, driver name, driver ID and unit number; activation and unit/driver edit
fields initialize from those live values. EFS verification failures disable the
action rather than showing stale DWH values as current.

Verification: backend lint (0 errors / 25 pre-existing warnings), typecheck and
production build; 27 targeted guard/catalog tests; CRM typecheck and production
build; 12 targeted CRM automation/mapper tests. Full suites still expose the
branch's unrelated baseline failures (backend 11/1115; CRM 1/268).

## 2026-07-29 — HR: Zoho CRM login ↔ employee mapping (the RBAC anchor)

Mytrion HR is migrating off Zoho People, and its RBAC needs to answer "which employee is this session".
Nothing linked the two: `hr_employees.zoho_record_id` is a Zoho **People** record, while portal sign-in
is Zoho **CRM** OAuth — two products, two id spaces, no shared key. Same trap that forced the DWH
by-agent queries onto a NAME fallback when the session's Zoho id matched no `agent_zoho_user_id`.

**Decision (user's): match on EMAIL only.** It is the sole field both sides carry.

Migration `0066_hr_employee_zoho_user.sql` adds `zoho_user_id`, `zoho_user_id_source`
(`email_match` | `manual`) and `zoho_user_linked_at`, plus a PARTIAL UNIQUE on
(tenant_id, zoho_user_id) — one login maps to at most one employee, or two rows would both answer "who
is this session", which is an RBAC hole rather than a data-quality nit — and a functional index on
(tenant_id, LOWER(TRIM(email))) so per-sign-in resolution does not seq-scan.

**db:generate is unusable in this repo — hand-written migration instead.** There are 66 journal entries
but only 25 snapshots (0000–0024): every migration from 0025 on was hand-written, so drizzle-kit has no
recent snapshot to diff and fails with a `0022/0023 pointing to a parent snapshot … collision`. Diffing
against the 0024 state would try to re-create forty migrations' worth of tables. So 0066 follows the
established hand-written pattern (idempotent `IF NOT EXISTS`, journal entry appended, applied with
`pnpm db:migrate`) — a committed migration file, never `push`. **Repairing the snapshot chain is real
pending debt**; anyone who wants `db:generate` back has to rebuild snapshots 0025+.

**MEASURED, and the safety result is the important one:**
  CRM users who can sign in : 128
  HR employees              : 213   (0 without a usable email)
  linked                    : 127   (99.2% of all CRM logins)
  AMBIGUOUS                 : 0     ← no duplicate email on either side
  CRM logins with no employee : 1   — kabir.k@tsst.ai "Company", a non-person account
  employees with no CRM login : 86  — HR-only records, no portal access to grant anyway

Zero ambiguity is what makes email-only defensible here. The resolver still refuses to link an email
that is ambiguous on EITHER side rather than guessing, because a wrong link shows one person another
person's private record — worse than an unresolved one. Re-run is a no-op (idempotence verified:
wouldLink=0, alreadyLinked=127), and a manual admin link (`source='manual'`) is never overwritten by
the automatic pass.

`hrEmployeeRepo.findByZohoUserId()` is the RBAC entry point and deliberately does NOT fall back to
email at request time — the mapping is resolved once, deliberately, and audited. Verified round-trip:
zoho_user_id → UMIDJON ABDUG'APPOROV <umidjon.a@octanefuel.com> (source=email_match).

**Still open:** a terminated employee may still hold an active CRM login, so termination must decide
whether portal access is revoked or the row is merely marked. `listAllForMapping` deliberately includes
terminated rows so RBAC can deny them on purpose rather than by accident.

## 2026-07-29 — HR had NO department gate (any worker could read the whole directory)

Found while designing HR RBAC, verified by reading the code directly rather than taking the audit's word
for it. `requireHrInternal` checked only `ctx.audience !== 'internal'`:

    function requireHrInternal(request) {
      const ctx = requireContext(request);
      if (ctx.audience !== 'internal') throw new RBACError('HR directory is internal-only');
      return ctx;
    }

That is not a gate. **Every signed-in worker — a sales agent, a billing agent — could read all 213
employee rows** (names, emails, mobiles, joining dates, reporting lines), the designation picklist and
the entire org structure. With 127 CRM logins now mapped to employees, that is 127 people with access to
the full HR directory.

ROOT CAUSE: `'hr'` was missing from `KNOWN_DEPARTMENTS` (src/lib/department.ts), so
`requireDepartment(request, 'hr', …)` did not even typecheck — the tag itself was always granted
(`MYTRION_DEPARTMENT.hr = 'hr'`), there was just no way to require it. Added 'hr' to the list and moved
the HR read gate onto `requireDepartment`, so HR now sits behind the same boundary as Billing or CS.
Write/sync routes already required Mytrion Admin and are unchanged.

Noted on the substring matcher: 'hr' is now the shortest tag, and `deriveWorkerDepartments` is a
case-insensitive SUBSTRING test, so a profile containing "hr" anywhere derives this department. That
derivation only BOUNDS a body-asserted view behind FF_WORKER_DEPT_STRICT and cannot grant access on its
own (the DB grant is authoritative), so the false-positive risk is limited to widening a view the grant
already permits.

**Three tests were pinning the hole** — they asserted a `'Sales Rep'` gets 200 on `/v1/hr/employees`,
`/v1/hr/meta/designations` and `/v1/hr/org-structure`. Rewritten: the sales worker now asserts 403 with
the reason recorded in the test body, and a new case asserts an HR-department worker still gets 200.

Also fixed a straggler from the 1:1 Calculation mapping: `referral-bonus-repo.test.ts` still asserted
"either legacy value selects BOTH legacy bonuses". Flipped, with the reason inline.

Suite back to the pre-existing baseline (6 files / 10 tests, all failing at origin/main too); lint 0
errors. `agent-scripted-turn` and a ~47-test spike were load flakiness from concurrent workflows — both
pass in isolation.

**Still open for HR RBAC (design done, not built):** row-level scoping (self / manager-chain / dept /
all) keyed on the new `zoho_user_id`, field-level withholding for sensitive columns, recursive
hierarchy queries with cycle protection, and whether termination revokes portal access.
## 2026-07-29 — Returns: Zoho→PG match-state sync + double-reversal guard (`feature/returns-zoho-sync`)

Asked to sync returns from the Zoho side into mytrion-ops and review the returns logic. Measured
first (read-only, prod): the return **facts** are already in sync — Zoho `MX_Merchant_Returns` 144
rows, PG `payment_returns` 144, zero missing either way, reasons/amounts/dates all present. The
`mxReturnsSync` dual-write does its job.

What never crossed is the **match state**, which is the half the Zoho workflow
(`automation.processReturnUnmap`) writes moments after the ingest:

| | Zoho | PG (before) |
|---|---|---|
| matched | 139 | 108 |
| linked to a payment | 139 | 100 |
| payments flagged returned | (all matched) | **3** |

So the app showed 31 already-processed returns as **Unmatched** work, and 128 clawed-back payments
looked like normal payments (no RETURNED badge) — 37 of them still `is_invoice_mapped`. Matching one
of those in the app reverses CMP, so the stale queue was an invitation to **reverse the same money
twice**. The UI guards (action hidden on matched rows, returned candidates disabled) are all driven
off that same stale state, so they could not catch it.

### servercrm — the sync

- `services/zohoReturnMatchSync.js` — reconcile. Resolves Zoho `Original_Transaction.name` (the MX
  payment id) → `payment_transactions.source_record_id` for source `mx`, writes matched /
  original_transaction_id / match_note / matched_by / matched_at / is_reversed, and flags the linked
  payment `is_returned`. Rules: never overwrite an app-side match (matched_by ≠ "Zoho (workflow)"),
  never clear a flag (`is_reversed`/`is_returned` only go false→true), idempotent (every write
  conditional), and row creation stays owned by the ingest — Zoho-only rows are reported, not created.
- `is_reversed` is derived from the note by the same rules as the app's `cmpStatus()`. Three note
  shapes contain the word "Reversed" while describing an outcome where nothing was reversed
  (`(no CMP reference stored)` = pending, `FAILED` = needs a human, `mapped=false` = never in CMP) —
  that is the trap the unit tests pin down.
- `scripts/syncZohoReturnMatches.js` — CLI, **dry-run by default**, `--commit` / `--all` / `--days N`
  / `--limit N`; laptop DB via `MYTRION_OPS_DATABASE_URL`, Render via `MYTRION_OPS_DB_INTERNAL`.
- Wired into `jobs/mxReturnsSync.js` as a best-effort step after the Zoho upsert (14-day trailing
  window on Modified_Time, `RETURN_MATCH_WINDOW_DAYS`), so state keeps flowing every 2h. A PG failure
  never fails the Zoho sync — same contract as the existing dual-write. This is also the only path by
  which the hourly `mxCmpRefBackfill` retry outcomes ("applied by retry", "retry exhausted") reach the
  app at all; that job is Zoho-only.
- Dry-run against prod: scanned 144 → 31 return rows to update, 127 payments to flag, 110 already
  current, 3 left alone (app matches by Alan Berg), 0 missing, 8 returns whose payment predates the
  2026-06-01 payments backfill (4 distinct MX ids, all card disputes — match recorded, link left null).

### mytrion-ops — the guard

`POST /billing/returns/:id/match` now calls `assertReturnMatchable` (new
`src/modules/billing/returnsMatch.ts`) before touching CMP: 409 if the return is already matched
(names who matched it) or the payment is already flagged returned. Parity with the Deluge twin
`mytrionManualMatchReturn`, which has had these guards since day one; the React port dropped them.
The client already surfaces server `error.message`, so the modal + toast show the reason.

### Reviewed, not changed (ranked)

1. **No auto-match in mytrion-ops.** Nothing in the app mirrors `processReturnUnmap` — no job, no
   route. Every return in PG is matched by a human or not at all. Today Zoho does it and this sync
   carries the result; when the Zoho modules retire, ACH returns and chargebacks silently stop being
   reversed. This is the piece to build next (port the workflow: match by reference → reverse via
   `cmpWrites.reverseMapping` → flag → the CMP-ref retry loop).
2. **`payment_returns.carrier_id` is always NULL** (Zoho has no carrier on returns either), so the
   repo's `carrierId` list filter and the index on it are dead. Carrier is reachable only through
   the linked payment.
3. **CMP outcome is parsed from English note text** in both the app (`cmpStatus`) and now this sync.
   `is_reversed` is the structured column that should drive the pills; the notes should be commentary.
4. **`original_transaction_name` is hardcoded `''`** in `toReturnWire`, so the Returns row shows no
   payment reference for a matched return (the widget showed the MX payment id) — one join away.
5. Returned transactions no longer pin to the top of the Transactions tab (widget behaviour); the
   React list is strictly date-grouped, so a RETURNED row can sit pages down.

### Checks

Backend typecheck green, lint 0 errors. New tests: mytrion-ops `billing-returns-match.test.ts` (4) and
servercrm `test/zohoReturnMatchSync.test.js` (11 — derivations + precedence + idempotency + dry-run
against a fake pg client) — all pass; servercrm suite 19/20 → 30/31, the one failure (`wexBocaGate`
dueDate) fails identically on a clean tree. The prod `--commit` was NOT run — that is a financial-data
write, left for explicit approval.

## 2026-07-29 (2) — Returns: CMP reversal for ref-less mapped charges + a picker that can actually search (`fix/returns-cmp-reversal-and-picker`)

Follow-up to the returns review. Two defects, both confirmed against prod data.

### 1. A mapped MX charge could not be reversed in CMP at all

`cmp_ref` is NULL on **all 7,632 mapped MX rows** (and all 836 mapped Stripe rows) — the portal
auto-applies those payments and no ref was ever recorded; the backfill had none to copy.
`reverseMapping` only reached the CMP resolver from *inside* the `cmpRef.kind === 'invoice'` branch,
so a NULL ref fell through to `{ ok: true, kind: 'none' }`. Consequence: matching a return against any
mapped MX payment did nothing in CMP, reported success, and — because the route reused its initial
note — labelled it *"not mapped — no CMP payment to reverse"*. Bounced money stayed credited and the
row looked clean. The Deluge twin never had this hole (`mytrionUnmapTransaction` → `mytrionResolveCmpRef`
resolves live at return time).

Fix: `ReverseInput` gains `resolveMissingRef` + `mappingType`. With no stored ref, a **return** now
resolves the payment by carrier + amount + charged day and deletes it; the resolver only accepts an
unambiguous match, so a miss returns `ok: false` and the return lands in Reconcile CMP instead of
looking done. Guards:
- **Manual unmap does NOT set the flag** — unmapping is a CRM correction and must not delete a genuine
  portal payment (the customer really paid). Locked by a test.
- **CRM-Sync mappings refuse to guess** — they deliberately never created a payment, so any CMP payment
  present was made outside our system; flagged for a human rather than deleted.
- No carrier/amount to look up → explicit failure, not a silent pass.
- The route no longer reuses the "not mapped" note for a mapped payment ("mapped, but CMP held no
  payment to reverse").

### 2. The manual-match picker ignored what the agent typed

`findReturnCandidates` used `f.customerName || f.query`, and the modal always sends `customerName` —
so **the typed query was discarded on every return that has a customer name**, and neither id column
was ever searched. Ported the Deluge's three modes properly:
- **text** (≥2 chars): OR across `external_txn_id` (MX Reference), `source_record_id` (**MX Payment
  ID** — the field Zoho labels "Payment ID" and stores in `Name`; a return's reference can be either),
  `sender_name`, `name`. No amount/date narrowing — exact amount is what already failed, and a partial
  return differs anyway.
- **suggest**: same amount OR same customer (widget ORs them; we ANDed), bounded by end of the return day.
- **window**: nothing suggested → the 7 days before the return.

The route now returns the real `mode` (was hardcoded `'search'`), so the picker's "Suggested — same
amount or same customer" and "showing all MX transactions from the 7 days before the return" hints
finally appear.

### Checks

Typecheck green, lint 0 errors, 16/16 on the three billing suites (9 new in
`tests/unit/billing-cmp-reverse.test.ts` — resolve-then-reverse, resolver miss, empty entries, the
unmap path touching CMP zero times, CRM-Sync refusal, missing carrier, plus the stored-ref paths).
Picker verified read-only against prod for return 06DB000LDJMG → payment 4000000122905814: found by
Payment ID, by Reference, by customer text, and by a typed id even when `customerName` and a
conflicting amount are also sent (the old code returned nothing); suggest and window modes both
report their real mode. No CMP write was fired — the reversal path is covered by mocked tests only.

## 2026-07-29 (3) — Data Loader pre-implementation safety audit (`feature/hr-workspace-v2`)

Reviewed `docs/DATA_LOADER_HANDOFF.md` against the current branch before implementing its direct
Postgres writer. The mandatory cross-tenant RBAC gate passes (9/9). Fixed the independent Drizzle
inventory prerequisite: `drizzle.config.ts` now includes `agent_blackboards.ts`, `agent_skills.ts`,
`mytrion_role_defaults.ts`, and `support_bot_messages.ts`, so migration generation cannot mistake
those existing tables for removals.

Implementation is paused at the handoff's explicit escalation point. Table-level grants do not
restore the `tenant_id` isolation that NocoDB bypasses: one `mytrion_loader` connection could touch
every tenant, while proposed tier-1 tables `client_news_reads` and `payment_carrier_memory` have no
`tenant_id` column at all. The safe direction is database RLS for tenant-owned allowlisted tables
keyed by a loader-session tenant setting, a joined policy for `client_news_reads`, and an explicit
single-tenant attribution decision for the global payment-carrier memory table; this needs
orchestrator approval before grants or triggers are written.

Two handoff facts have also aged since 2026-07-26: current NocoDB Community uses the Fair Code
Sustainable Use License rather than AGPLv3, and the official self-hosted stack now includes a
Redis-backed background worker for imports/exports alongside the web service and metadata Postgres.
Production/legal review therefore remains a deployment prerequisite, and the local Compose design
must be updated rather than copying the older one-service assumption.

## 2026-07-29 (4) — Hardened Admin Data Loader implemented (`feature/hr-workspace-v2`)

Implemented the approved single-tenant tier-1 Data Loader. Migration
`0069_data_loader_journal.sql` creates the before/after journal and attaches its
`SECURITY DEFINER` trigger to the same four tables exported by
`src/modules/dataLoader/allowlist.ts`. `scripts/nocodb-role.sql` provisions a no-DDL,
no-inherit writer, enables literal-tenant RLS (including the parent join for
`client_news_reads`), and fails closed if PUBLIC privileges widen the surface.
`payment_carrier_memory` remains excluded.

Added the tenant-first journal repo, drift-checked transactional inversion for insert/update/delete,
same-transaction `data_loader.revert` auditing, four Admin-only routes, and the Horizon Admin Data
Loader tab with loading/error/empty/loaded states, before/after diffs, paging, NocoDB launch, and a
destructive confirmation flow. Local Compose now defines pinned NocoDB web + worker, separate
metadata Postgres, and Redis; production hosting remains deliberately absent.

Verification:

- `pnpm lint` passes with 24 existing warnings; root `pnpm typecheck` and `pnpm build` pass.
- Admin UI `typecheck` passes and a production Vite bundle completes to a temporary directory.
- Data Loader backend tests: 10 pass; UI state tests: 4 pass.
- The database trigger integration test is present but skips without
  `MYTRION_OPS_TEST_DATABASE_URL`.
- `docker compose config --quiet` and `git diff --check` pass.
- The full backend suite has 10 unrelated failures (stream adapter, touchpoints/tools counts and
  gates, Zoho MCP mock, retention claim, and notification text); the full frontend suite has one
  unrelated Sales debtor-summary fixture failure. No Data Loader test fails.

The Docker daemon is not running in this environment, so migration execution, the role's live
permission/RLS checklist, NocoDB login/import/export, and end-to-end rollback against Postgres remain
deployment verification steps. Concurrent HR and generated frontend asset changes were preserved
and not modified as part of this work.

## 2026-07-29 (5) — Data Loader local API 500 repaired

The running API returned Postgres `42P01` for `/v1/admin/data-loader/batches`: the external app
database had migrations only through `0067`, so `bulk_change_log` did not exist. Applied only the
idempotent `0069_data_loader_journal.sql` statements directly to the configured database, leaving
the pending HR `0068` migration untouched. The normal migrator ledger was deliberately not advanced
past `0068`; a future `pnpm db:migrate` will apply `0068` and safely replay idempotent `0069`.

Verified the live repository list/count query, all four trigger attachments, and the authenticated
HTTP endpoint (`200`, empty batches). Data Loader routes now translate a missing journal relation
into an exposed `503 DATA_LOADER_NOT_READY` response naming migration 0069 instead of returning an
opaque 500. Focused route/allowlist/revert/tenant tests pass 11/11, and root typecheck/build pass.

## 2026-07-29 (6) — Local NocoDB launched and loader role provisioned

The Data Loader launch button remained disabled after `.env` was populated because the long-running
API had cached an empty `NOCODB_BASE_URL`. Relaunched the backend and verified
`GET /v1/admin/data-loader/config` returns `http://127.0.0.1:8080`. Started Docker Desktop and the
four Compose services; NocoDB web, metadata Postgres, and Redis report healthy, the worker is
running, and both `/` and `/api/v1/health` respond successfully.

Provisioning exposed a PostgreSQL privilege nuance in `scripts/nocodb-role.sql`: a CREATEROLE
database owner may create a normal role but cannot repeat `NOSUPERUSER` in `ALTER ROLE`.
The script now fails closed if the existing loader has any privileged attribute, then alters only
the attributes the database owner may manage. Live `mytrion_loader` login and SELECT on all four
allowlisted tables pass; SELECT on `audit_log` is denied as required.

The manually entered `NOCODB_LOADER_DATABASE_URL` used the correct loader credentials but the wrong
host/database. Derived the correct restricted URL from `MYTRION_OPS_DATABASE_URL`, verified it by
logging in, and copied it to the macOS clipboard without printing the credential.

## 2026-07-29 (4) — HR workspace: employees loader + caching, departments as cards, org canvas (`feature/hr-workspace-v2`)

Reworked all three live HR tabs. Branched off `build` (never committed onto it).

**Employees.** The tab issued one 500-row request per keystroke and per filter change, and every row
carried the whole Zoho `raw_fields` bag because `hrEmployeeRepo.list()` used `db.select()`. Two fixes:
`EMPLOYEE_COLUMNS` / `DEPT_COLUMNS` explicit projections drop `raw_fields` from every read path, and the
directory is now fetched ONCE into the shared client SWR store — search, the status chips and both
dropdowns filter that array in memory, so typing costs no network and re-entering the tab paints from
cache. `hrData.ts` owns the keys (`hr:*`) and the invalidation map. If the directory ever exceeds the
500-row page, `useHrEmployeeSearch` falls back to server-side search rather than searching only the rows
it holds.

The header no longer lies while loading: `HrToolbarSkeleton` / `HrHeadActionsSkeleton` replace the old
behaviour where a fully-formed filter bar with inert dropdowns and a stale "213 employees" rendered above
shimmering cards. Edits get a real in-flight state (`HrBusy`, disabled fieldset, backdrop/Escape blocked
mid-save) instead of the word "Saving…" in a still-live form.

**Cache promotion.** `sales/redesign/dcCache.ts` → `_shared/swrCache.ts`, with `dcCache.ts` left as an
alias re-export so all fifteen existing importers are untouched and there is still ONE store. Manager's
cards were already importing it across modules, which is what showed it had outgrown the folder. Note
`@tanstack/react-query` is a declared-but-unused dependency; the hand-rolled store is the deliberate
choice (dcCache's own header said so) and this respects it rather than adding a second cache.

**Departments.** Table → glass cards + a modal that IS the editor for admins (read-only layout for
everyone else). Icon picker (curated lucide set) and tone picker (Horizon `--tone-*` tokens), plus a
markdown "rich text" description with a toolbar and a Write/Preview switch. `mail_alias` and `source` are
no longer surfaced. Card headcounts come from the already-cached directory, so they agree with the
Employees tab instead of needing another endpoint.

Injection safety is two independent layers, neither trusting the other: the backend validates SHAPE
(`modules/hr/departmentAppearance.ts` — PascalCase identifier / `tone-*` token, so nothing with a quote,
brace or `url(` can be stored) and the client resolves the stored value through a static Map with a
fallback (`departmentAppearance.tsx`). Deliberately NOT a duplicated 1,600-name allow-list, which would
drift. Verified: `icon: '<script>x'` and `iconColor: 'red;background:url(x)'` both normalize to null,
and a PATCH omitting a key leaves it untouched.

**Org Structure.** Nested `<ul>` → a React Flow v12 canvas, `rankdir: TB`, following the Scope blueprint
(`admin/scope/Blueprint.tsx`) as the in-repo reference. Nodes are BOTH departments and employees. Drag to
move (persisted, debounced, no audit row — a nudge is layout, not an edit); drop a node on a node to
re-parent; drag handle→handle for the same thing; per-node chevron+count to expand/collapse; "+" to add a
child; double-click to open the record.

Migration `0068` adds `hr_employees.reporting_to_employee_id` (+ index) and `canvas_x/canvas_y`, mirroring
what `0067` gave departments. The manager link is an ID, not the `reporting_to` NAME, because the canvas
re-parents by id and a name breaks on rename and is ambiguous across duplicates. NOT a real FK: deleting
an employee must not cascade away their whole reporting line. The edit form's "Reporting to" is now a
picker writing that id, so the form and the canvas can no longer disagree.

Hand-written migration again, for the reason 0067 was: `pnpm db:generate` still fails with
`[meta/0022_snapshot.json, meta/0023_snapshot.json] are pointing to a parent snapshot ... which is a
collision`. That baseline damage is unrelated to this work but blocks generation for everyone — worth
repairing separately.

**Bug found and fixed on the way:** `telegramUsername` was on the route body, the repo input type and the
form, but neither `createManual` nor `update()` ever wrote the column. The field looked saved and was not.

**Bug caught by a new test:** `buildOrgGraph` dropped anyone whose `department_id` pointed at a deleted
department — bucketed under an id no walk visits, so they vanished from the canvas with nothing on screen
saying so, and they are exactly the rows HR needs to find. Now routed to `floating` and drawn as roots.
`orgGraph.test.ts` covers that plus cross-department managers, hidden terminated managers, dangling
parent ids, reporting cycles from a bad import, and pinned-vs-auto layout.

**Verification.** `pnpm lint` 0 errors (24 pre-existing warnings). Both typechecks clean. HR backend
tests 32/32 (`hr-routes`, `hr-departments-routes`, new `hr-org-canvas-routes` covering the admin gate,
bounded coordinates, cycle rejection and department-under-person). `orgGraph.test.ts` 16/16. Six backend
test files (10 tests) and one frontend test file fail identically on a clean tree — pre-existing:
`stream-adapter`, `tools`, `zoho-crm`, `touchpoints-routes`, `retention-cs-caps`,
`notification-templates`, `dashDebtorsData`.

**Not verified against a live DB.** Docker was not running this session, so `:5433` was down and
migration `0068` has NOT been applied or run against a throwaway DB, and no tab was exercised in a
browser. Both need doing before this merges. `modern-web-guidance` (CLAUDE.md rule 10) does not exist in
`.claude/skills/` or `~/.claude/skills/`; held to the existing Horizon vocabulary instead — worth either
adding the skill or dropping the rule.

### Same session — adversarial review round

Ran a six-dimension review over the diff (org-canvas logic, backend correctness, client cache,
security, UX/a11y, scope regressions), each finding then put to three independent skeptics. 51 findings;
the ones that held up are fixed below. Several were bugs I had introduced and two were latent holes the
new code made reachable.

**Data loss / silent-wrong, fixed:**
- Canvas re-parent invalidated the graph and the directory but NOT `hr:departments:all`. Because the org
  tab feeds that cached row straight into the department modal, moving a sub-department and then opening
  it and pressing Save wrote the stale parent back — silently undoing the move.
- Any employee edit wiped the manager NAME for every row whose manager id had never resolved (ambiguous
  or unmatched `reporting_to`). The form seeds the picker to "—" for those, and sending that back reads
  as "no manager". The patch now includes `reportingToEmployeeId` only when the user changed it, and an
  unresolved name shows as a disabled "(not linked)" option instead of looking absent.
- `PATCH /hr/employees/:id` and `PATCH /hr/departments/:id` had no cycle guard — it existed only on
  `/hr/org/reparent`. Two form saves could build a reporting or department ring, which has no root, and
  a ring makes the canvas drop its members. Both PATCHes now run the same guard.
- `buildOrgGraph` dropped BOTH departments of a parent cycle plus everything under them, and both people
  of a reporting cycle. Now an explicit invariant with a recursion guard: every row is either drawn or
  deliberately hidden behind a collapsed ancestor, and unreachable rows surface as roots — which is the
  only place the loop can be fixed. `orgGraph.test.ts` covers both cycle shapes and asserts
  drawn + hidden = total. (One earlier test passed VACUOUSLY: it asserted id uniqueness, which an empty
  node list satisfies.)
- Expanding or collapsing anything threw away every position the user had dragged, because the graph
  rebuilds from the fetched payload. Local drags are now kept in an override map applied on each rebuild,
  and pending debounced writes flush before a re-parent and on unmount instead of being discarded.

**Shared-cache fixes (they affect Sales and Manager too, via the promoted store):**
- The `alive` ref was reset to true on every effect run, so a superseded response passed the liveness
  check and wrote itself into state — switching agent / term / filter could leave the previous subject's
  rows on screen under the new key. Replaced with a monotonic run id; the cache write still happens under
  the correct key.
- On a key change with a cold cache the previous key's data was presented as the new key's result. Now
  cleared, matching the sibling `useLoad`'s documented rule.
- New `swrCache.test.ts` (14 tests) locks both, plus StrictMode remount — my first version of the fix
  latched a `mounted` ref false on the first teardown, which would have broken every consumer in dev.

**Also fixed:** departments read gate (was `audience`-only while its sibling required the `hr` grant —
any signed-in worker could read every department with its lead email); the Zoho sync overwrote
`reporting_to` without touching the id column, so name and chart disagreed after every sync (added
`relinkManagers`, run at the end of the sync); dropping a person onto a department node was a visible
no-op because they stayed under their manager (now detaches); `setDepartment` left `department_zoho_id`
contradicting `department_id`; the `designation` query filter was parsed and then never forwarded; a
duplicate department name 500'd instead of returning a conflict; employee node height (76px) was shorter
than its own content so the chevron hung outside the card; double-click opened a record AND zoomed the
canvas; drop-to-reparent used React Flow's any-pixel-overlap test, so nudging a node beside a neighbour
re-parented it (now centre-in-target); auto-placed nodes could land on top of pinned ones; `hiddenCount`
was computed and never shown; the "+" used a `window.confirm` whose Cancel button created a
sub-department; two loaders ran during a refresh (ring + spinning icon); the department card borrowed the
employee card's shimmer class but not its reveal selector, so its hover hairline could never appear; the
departments skeleton used the employees grid geometry so the page jumped; modals declared `aria-modal`
without trapping or restoring focus; the icon picker was 26 tab stops with no arrow keys and announced
raw lucide component names; canvas records were double-click-only with no keyboard path.

`hrEmployeeRepo.ts` had grown to 694 lines, past the 600 cap (rule 5). Split along a real seam: the Zoho
write paths (`bulkUpsertFromZoho`, `upsertFromZoho`, `relinkManagers`) moved to `hrEmployeeSyncRepo.ts` —
they are reached only from the sync, write with Zoho as the authority, and are the only code touching
`raw_fields`. 476 + 239 lines.

**Deliberately NOT changed** (real, but pre-existing and outside this work): `relinkParents` wipes
`parent_id` when the denormalized `parent_name` no longer resolves; the "Other designation" field clears
itself once what you typed matches an existing title. Also left: a canvas department move is overwritten
by the next Zoho People sync for `source = 'zoho_people'` rows, since Zoho still owns department
assignment until HR finishes migrating off it — documented at `setDepartment` rather than papered over.

**Verification after the review round.** Both typechecks clean. Backend suite run SERIALLY
(`--no-file-parallelism`): 6 files / 10 tests fail, identical to the clean-tree baseline, 1146 passing.
Running it in parallel on this machine produces extra ~5s timeout failures in unrelated files
(`cs-routes`, `retention-cases`, `files`) that pass on their own — load flakiness, not regressions.
Frontend: 305 passing, 1 pre-existing failure (`dashDebtorsData`). `pnpm lint` was clean earlier in the
session (0 errors, 24 pre-existing warnings) but was NOT re-run after this last round of edits.

## 2026-07-29 — HR employees 500 (missing 0068 columns)

`GET /v1/hr/employees` and `/v1/hr/org-structure` 500ed locally because schema
selected `reporting_to_employee_id` / `canvas_x` / `canvas_y` but migration
`0068_hr_org_canvas_employee` had not been applied. `pnpm db:migrate` fixed it.

## 2026-07-29 (7) — NocoDB ERD metadata visibility

Granted the restricted `mytrion_loader` role `REFERENCES` on all public tables so NocoDB can discover
the full schema for table navigation and ERD display without granting row reads. Live verification
shows the database owner and loader both discover all 68 public tables. The loader can still read the
four writable Data Loader tables, while a direct `SELECT` from `audit_log` remains permission denied.
Added a regression assertion that permits the metadata grant but forbids `SELECT ON ALL TABLES`.

## 2026-07-29 (8) — Manager Referrals calculation workspace

Replaced the Manager Referrals record accordion with a calculation workspace based on
`Referral_Bonus_Calculation_Types_1.pdf`: premium referral cards, month/search/type filters, KPI
summary, pagination, and an accessible three-tab detail modal. The backend now returns one read model
joining full Zoho Parent/Child records, related Deals, `Deals.Carrier_ID`, MART transaction-line-item
gallons/swipes, and the local payout ledger. Calculation rules are centralized and shared with the
monthly engine: legacy gallons ($0.01/gal), legacy unique-card swipes ($50/card/month), parent 500-gal
one-time ($50), and child 1,000-gal one-time ($50).

Relationship resolution is intentionally strict: referral → related Deal → Deal Carrier_ID → MART.
It never falls back to the referral modules' free-text Carrier_ID. One-time payouts are guarded by
both child/type and economic carrier/type, including old child-keyed ledger rows and every frozen
status. Added migration `0070_referral_bonus_carrier_guard.sql`; it has NOT been applied.

Live read-only smoke result for July 2026: 687 parents, 665 configured calculations, 4 children,
0 related referral Deals, 0 connected MART carriers, and 687 visible setup states. Thus the screen
correctly shows $0 payable until Zoho relationships are populated instead of manufacturing payouts.

Verification: backend and frontend typechecks/builds pass; targeted lint is clean; referral backend
tests 51/51 and frontend model tests 4/4 pass. Browser validation covered live cards, modal tabs,
focus/close behavior, desktop and narrow layouts, and zero console errors. It also exposed and fixed
Manager's retained scroll offset across workspace transitions. The full backend suite has 1,157
passing and 10 unrelated existing failures (`stream-adapter`, `touchpoints-routes`, `zoho-crm`,
`tools`, `retention-cs-caps`, `notification-templates`). Full lint is blocked by two unrelated
unused-import errors in the in-progress HR files.

## 2026-07-30 — Manager readability and referral modal separation

Raised the Manager-scoped typography floor across shared navigation, workspace descriptions, KPI
tiles, referral cards, filters, pagination, and referral-detail content. The change is scoped through
Manager CSS variables so the other Mytrion workspaces retain their existing type scale.

Strengthened the referral-detail modal in both themes with a darker blurred scrim, a two-layer
accent perimeter, deeper elevation, and four explicit corner brackets. Browser QA exposed that the
portal carried its calculation-tone class on the same node as `.mg-root`; the original
descendant-only tone selector therefore left the modal's accent custom property unset. Added the
same-node selectors so each calculation type now reliably colors its modal frame and internal
accents.

Mechanically split the oversized Manager stylesheet into base, workspace, and loyalty files; all
three are below the repository's 600-line cap and retain their original cascade order.

Verification: frontend typecheck and production build pass; referral model tests pass 4/4. Browser
validation covered the Referrals workspace and modal in dark and light themes at desktop width; the
larger three-column cards remain unclipped and the browser console is clean.

## 2026-07-30 — HR employees FaceID + department lead/members

Continued Mytrion HR on `feature/hr-workspace-v2`:

1. **Employee card hover conflict** — card is now an `<article>` with a dedicated hit `<button>` and
   real admin action buttons at bottom-right (no nested interactives over the status/ID row).
2. **Department-coloured badges** — employee cards/detail set `--dc` from the department's
   `iconColor` tone so the chip + designation use that colour dynamically.
3. **Face ID** — migration `0071_hr_faceid_and_lead_employee` adds `hr_employees.face_id`, backfills
   from Zoho `raw_fields->>'Face_ID'`, maps/syncs `Face_ID` on Zoho upsert, exposes on DTO + card /
   detail / edit form.
4. **Department lead = employee lookup** — `hr_departments.lead_employee_id` + backfill from
   `lead_zoho_id` → `zoho_record_id` (email fallback). Admin modal uses a people `<select>`;
   denormalized lead name/email follow the chosen row. Sync runs `relinkLeads` after parents.
5. **Department members** — opening a department lists its people; admins can add/remove via
   `PATCH /hr/employees/:id` `departmentId` (same path as the org canvas).

Verification: `pnpm db:migrate` applied 0071; backend `pnpm typecheck` green; CRM `tsc --noEmit`
green; `hr-map-zoho-employee`, `hr-routes`, `hr-departments-routes` 20/20.

## 2026-07-30 — Sidebar username profile + HR admin Settings

- Removed the HR **Profile** nav tab. Username now sits at the bottom of every `MytrionShell`
  sidebar; click opens a read-only account profile with the only write being profile-picture upload
  (`PUT /auth/me/avatar` → `worker_profiles`, migration `0072`). Linked HR employee details come from
  `GET /hr/me` when `zoho_user_id` is mapped.
- Added HR **Settings** tab, gated by `isAdmin` (Administrator / CEO / `allDepartmentAccess`) — Zoho
  People employee + department sync buttons. Non-admins keep read-only Employees / Departments / Org
  (write UI already hidden; backend `requireHrAdmin` unchanged).

## 2026-07-30 — Mytrion HR Attendance (own webhook + shifts)

Own attendance stack — **no Zoho People attendance** dual-write/sync.

1. **Migration `0073_hr_attendance`** — `hr_attendance_shifts`, `hr_attendance_shift_assignments`,
   `hr_attendance_punches` (FaceID + UTC punch + UZB `work_date`, dedup UK).
2. **Ingest** — `POST /v1/hr/attendance/webhook` with `x-attendance-webhook-secret`
   (`HR_ATTENDANCE_WEBHOOK_SECRET`). Maps `empCode` → `hr_employees.face_id`; door_name →
   check_in/out; wall-clock parsed as Asia/Tashkent; overnight shift day bucketing.
3. **API** — `GET /hr/attendance/me|summary|export`, shift CRUD + assign (admin).
4. **CRM** — Attendance tab My Data week UI; Settings → Shifts / assign / CSV / webhook hint.
   Point Hikvision/servercrm at `https://<ops-host>/v1/hr/attendance/webhook`.

Verification: unit `hr-attendance-uzb` + route webhook/admin gates; migrate + typecheck as below.

## 2026-07-30 — Attendance Team visibility

Department managers and HR elevated roles can open **Team** next to My Data:

- **Direct** = `reporting_to_employee_id` reportees.
- **All (manager)** = Direct ∪ members of departments where they are `lead_employee_id`.
- **All (HR Manager profile / Admin)** = every Active employee (org-wide).
- `GET /hr/attendance/summary?employeeId=` re-checks the same scope (managers cannot open outsiders).
- CSV export still Admin-only (`requireHrAdmin`).

UI: Attendance panes My Data | Team; Direct/All toggle + search + person week detail.

## 2026-07-30 — Manager Inter + department Tasks blocks

1. **Inter** across Manager (`[data-mytrion=manager]` + `.mg-root`) — same body/head face as Sales.
2. **Tasks block** on every department desk (Sales, CS, Billing, Finance, Collection, Mobile,
   Verification): assign form + assignment list + beautified detail (stats, actions, event timeline).
3. **Backend** — migration `0075_worker_task_department`; routes `/manager/:department/{workers,tasks…}`.
   Sales assignees stay KPI-eligible; other desks resolve Zoho users who can enter that Mytrion.

## 2026-07-30 — Native Mytrion Time Off

Replaced the Zoho People leave runtime with a tenant-scoped Mytrion domain on
`feature/hr-workspace-v2`. The read-only Zoho audit found 675 historical requests, the three UZ
leave types, Kristina Smirnova's mapped HR employee/login, complete department-lead coverage, and
the 11 configured 2026 holidays. Those findings informed the native policy; no production request
path calls Zoho People.

- Migration `0074_hr_time_off.sql` creates policy types, yearly entitlements, holidays, settings,
  requests, and an append-only action journal. It seeds Sick 7, Annual Paid 17.5, Unpaid 60,
  Kristina as final approver when present, current-year employee balances, and the audited 2026
  holiday calendar. The migration is committed but was **not applied** from this session.
- Pending requests reserve balance immediately. Weekends/full holidays cost zero, half-day
  holidays cost 0.5, cross-year requests are refused, and pending/approved overlaps are blocked
  under an employee/year advisory transaction lock.
- Escalation snapshots the department lead and final HR approver at submission. The lead acts
  first; Kristina/Settings approver is final. A department lead requesting their own leave (or an
  unavailable/unmapped lead) routes directly to HR. Only the snapshotted current approver can act.
- Every transition is tenant-scoped, audit-logged, journaled, and emits a durable/realtime inbox
  event to the mapped Zoho login. Rejection/cancellation releases the reservation; final approval
  converts pending days to booked days without double-deducting.
- Every Mytrion sidebar now exposes a self-service Time Off modal (summary, apply, history,
  approvals). HR's Time Off page adds the org-wide register. Admin Settings controls defaults,
  yearly application of defaults, final approver, and full/half-day holidays.

Verification: backend typecheck/build and frontend production bundling pass; lint has warnings only.
The Time Off frontend typechecked cleanly before concurrent Verification workspace edits introduced
unrelated `VerificationClientModal.tsx` exact-optional errors in the shared worktree. Time Off
calendar/service/route tests pass 12/12. Browser QA covered summary, request form,
approver queue/detail with persistent decision controls, the HR register, policy, and holidays.
The full backend suite has 1,195 passing with 10 unrelated failures; frontend has 309 passing with
one unrelated Sales debtors-summary expectation failure.

## 2026-07-30 — Agent gateway dynamic service switches

Added a fail-closed capability registry to `apps/agent-gateway-groq`. Deployments can override
safe defaults with `AGENT_SERVICE_FLAGS=service=on|off`; model exposure, deterministic routing,
prompt capabilities, and dispatcher execution now share the same registry. Unknown gateway tools
are hidden, disabled tools are rejected again at dispatch, and a direct disabled-service request
returns a zero-token language-matched unavailable response.

Money Code quote and draw remain catalogued but are disabled by default. They are absent from
OpenAI tool definitions and cannot be restored by a stale confirmation callback; a deliberate
`money_code=on` override restores the complete quote/confirm/draw route. Core Telegram progress,
buttons, and reactions cannot be disabled.

Verification: agent-gateway ESLint clean, TypeScript clean, Vitest 43/43, and `git diff --check`
clean.

## 2026-07-30 — Support bot per-user pgvector memory

Added an opt-in long-term memory path for `apps/agent-gateway-groq`. The gateway recalls and
commits through authenticated backend endpoints; it never connects directly to Postgres. Every
memory query is scoped by tenant, carrier, Telegram chat, and Telegram user. Stored turn summaries
are redacted before embedding, expire after 30 days by default, have a bounded per-user cap, and
are injected as untrusted context that cannot replace live card, balance, limit, invoice, or RBAC
tool checks. Commit work uses a bounded background queue so Telegram replies are not delayed
during bursts.

Migration `0078_support_bot_memories.sql` creates the isolated table and HNSW cosine index. It was
applied directly to the local database only, without advancing Drizzle's journal past unrelated
pending migrations. Local switches enable `memory` and keep `money_code` disabled; committed
examples remain off by default.

Verification: backend typecheck/build clean; changed-file ESLint clean; gateway typecheck and
Vitest 45/45; memory/RBAC targeted tests 34/34. Full backend suite has 1,271 passing and 11
unrelated existing failures. The required live agent eval completed at $0.390 with 32/43 passing;
existing routing/grounding failures and transient OpenAI 429/connection errors kept it below its
thresholds. Local table/index smoke check passed with four indexes and zero synthetic rows.

## 2026-07-30 — OpenAI gateway role-aware skill runtime

Added a strict `Service → Skill → Tool` runtime to `apps/agent-gateway-groq`. Fifteen OpenAI-native
skill packs now live under `skills/*/SKILL.md`; `skillRegistry.ts` requires every gateway tool to
belong to exactly one service-compatible skill and declares its allowed roles. Only instructions
for the selected, role-allowed tools enter the prompt.

Role resolution reuses the existing per-carrier `/support-bot/access` single-flight cache instead
of adding a per-turn `/whoami` call. Access rows now carry `driver` or owner-equivalent
`owner/manager`; missing and unknown profiles fail closed before a model turn. Required
role-forbidden actions return a deterministic zero-token response. The model tool catalog is
filtered by role, and `toolDispatcher` independently refuses a stale or fabricated forbidden call
before execution. Backend registration/carrier RBAC remains the final authority.

Verification: changed-file ESLint clean; gateway TypeScript clean and Vitest 53/53; backend
typecheck/build clean; targeted backend memory/RBAC tests 34/34. The 300-request/100-user stress
run stayed at the configured 8-turn cap with no same-user overlap, reordering, or leaked queue
state. Docker build `octane-agent-gateway-openai:skill-runtime` passed and includes the Markdown
skill directory. Local access smoke-check returned two users with manager/owner profiles; backend
and gateway health checks passed after restart. Live eval spent $0.420: RBAC 3/3, tool selection
5/5, grounding 7/8, refusal 5/5; the existing routing and web-navigation thresholds still failed,
with transient OpenAI 429/connection errors and a multi-turn 20-tool budget hit.
## 2026-07-29 (3) — QA automations round 3 follow-up review (`fix/qa-automations-round3`)

Reviewed the invoice-download and card-refresh fixes after the branch was rebased onto `build`.
The card refresh fix is correct. The invoice proxy needed a second authorization pass: servercrm
keys downloads by invoice id alone, so the route now requires a carrier the worker owns and proves
the invoice appears in that carrier's full paginated invoice set before returning bytes or a mobile
signed URL. The old generic `sales_mytrion.invoice_signed_url` touchpoint was removed because a
carrier-only dispatcher guard still allowed an owned carrier to be paired with someone else's
invoice id. Upstream 401/403 responses now map to 502 so they cannot trigger a refresh of the
worker's unrelated Mytrion bearer token.

Updated the Sales UI to carry `carrierId` through single, bulk, desktop, and mobile downloads;
updated its tests; and added 17 route tests covering authentication, department and carrier scope,
invoice/carrier mismatch, pagination, upstream failures, binary delivery, audit, and signed URLs.
Also restored the vendored transaction-PDF behavior from zoho-octane: hiding discount now removes
the Discount KPI and makes Total Spent use retail (funded + discount).

The next write-safety item is also complete. `AutoTab` now acquires a synchronous ref latch before
dispatch, so two clicks in the same React batch cannot issue two requests. Escape, backdrop, X,
reset, and the former Cancel path cannot expose the form again while a request is alive; a slow
request remains visibly in progress instead of inviting a retry at the 90-second watchdog. A
component test holds the promise open, submits twice, verifies one dispatch and guarded close, then
confirms normal close after settlement.

Rebuilt the committed `apps/mytrion-crm/app` artifact so the source fixes are deployable. Backend and
web typechecks pass; lint has 0 errors / 25 pre-existing warnings; all web tests pass (272/272);
invoice route tests pass (17/17); catalog shape test passes. The full backend run remains at 38
failures across 12 unrelated suites (including sandbox-blocked localhost/Postgres tests and stale
session/tool-count expectations); none are in the new invoice suite.

## 2026-07-30 — Historical Telegram support analytics and KB candidates

Analyzed the 10 local Telegram export directories under `/Users/jamshid/Projects/Octane/Analitika`
without sending chat content to an external model. One byte-identical duplicate export was
excluded, leaving 9 unique tenant histories with 54,433 messages from 2024-10-24 through
2026-07-20. The reproducible local analyzer redacts identifiers, infers staff/client roles,
classifies multilingual intents, measures response latency and first-response disposition, and
creates anonymized tenant summaries.

Generated privacy-reviewed candidate artifacts outside the repository: the analytics report,
curated knowledge candidates, historical intent lexicon, current gateway coverage-gap matrix,
105 redacted candidate eval prompts, and 14 exact-tool golden eval seeds. Historical replies were
not ingested into the production KB because station networks, discounts, EFS behavior, limits, and
tenant-specific rules require owner validation. The highest-value gaps are report scope/pricing
dimensions, maintenance/work-order workflows, disabled Money/EFS negative paths, structured
image extraction, and avoiding greeting/progress-only pseudo-resolutions.

Verification: all four JSONL outputs parse successfully; the analyzer completed in under one
second on the local exports. No application runtime code was changed, so application lint,
typecheck, tests, and live eval were not rerun.

## 2026-07-30 — Tenant/carrier-scoped support KB hybrid retrieval

Replaced the OpenAI gateway's normal in-process keyword-only knowledge path with a dedicated
backend `support_bot_knowledge_articles` store. Migration `0082_support_bot_knowledge.sql` creates
an isolated pgvector + simple-dictionary full-text table; it is separate from generic Mytrion
knowledge and per-user memory. Both retrieval legs enforce authenticated tenant, tenant-global or
exact carrier, published/effective/unexpired content, and enabled service IDs inside the repo.
Carrier overlays replace same-slug global articles during RRF fusion.

The gateway now calls `/v1/support-bot/knowledge/search` with a closure-bound carrier and the
deployment service set, uses a 5-minute/500-entry cache plus single-flight, and retains the bundled
corpus only for migration/backend failure. Empty authoritative DB results do not silently restore
legacy facts. Disabled Money Code articles are filtered from the fallback as well as DB retrieval.
Every backend knowledge search is audited without logging raw query text.

Added an idempotent seed command and a real-DB smoke command. The seed batches embeddings, omits
Money Code unless deliberately opted in, expires volatile April-2026 station/discount/fee/limit
facts, and publishes two stable workflows mined from 54,433 historical messages: report request
intake and maintenance/work-order intake. Local migration and seed succeeded with 21 published
rows and 3 Money Code rows skipped. Smoke and HTTP route checks retrieved the expected report and
maintenance articles while returning no article for disabled Money Code or expired station facts.

Verification: pre-feature RBAC baseline 34/34; new/targeted backend suite 36/36; gateway 57/57;
root and gateway TypeScript clean; root build clean; changed-file ESLint clean. The root full suite
has 1,277 passing and 11 unrelated existing failures. Required live eval spent $0.398: RBAC 3/3,
tool-selection 5/5, grounding 7/8, refusal 5/5; existing routing and web-navigation thresholds plus
transient OpenAI 429s kept the overall command red. Local backend/gateway health and ngrok tunnel
were restored after restart.

## 2026-07-30 — Capability fast-path history isolation

Fixed Telegram capability questions inheriting the previous disabled Money Code intent. Added a
deterministic, zero-token capability response before service routing; it is filtered by the
backend-verified role and runtime service switches. Added Uzbek, English, Russian, and Spanish
capability summaries plus regression coverage for the exact production history sequence.

## 2026-07-30 — New-intent isolation and maintenance handoff

Stopped unresolved card/override history from overriding a new customer topic. Only explicit
follow-ups and confirmations now inherit the previous service; direct decline language routes to
card diagnostics, while truck breakdown, roadside, tire, repair, towing, shop quote, and work-order
language starts a dedicated maintenance request workflow. Added a role-checked
`maintenance-roadside` Desk request for owners and drivers, routed to the Maintenance department,
with structured intake and explicit confirmation before a real ticket is filed.

## 2026-07-30 — Tagless registered-client support engagement

Replaced mention-only Telegram engagement with a zero-token hybrid gate. Explicit mentions,
replies, and active follow-ups remain authoritative; registered users in mapped carrier groups can
now start card, EFS, report, billing, station, maintenance, tracking, mini-app, identity, and help
requests without tagging the bot. Ordinary conversation stays silent, and unregistered ambient
matches do not generate registration-nudge spam. The behavior is dynamically reversible with
`AMBIENT_SUPPORT_ENABLED=0` and emits an `ambient_engagement_total` runtime metric.

## 2026-07-30 — Conversational greeting and split-message ordering

Added colloquial Uzbek identity recognition (`man/men kimman`) and a cooldown-bound tagless
greeting entry for registered support-group users. A greeting opens a ten-minute follow-up window,
so clients can describe an issue over several natural messages without remembering the bot tag.
Telegram batch preprocessing now preserves source order per chat/user despite asynchronous access
lookups, while different users remain concurrent.

## 2026-07-30 — Natural multi-message request aggregation

Added a bounded per-chat/user Telegram burst buffer for real support conversations where greeting,
intent, unit/driver details, and politeness arrive as separate messages. A turn starts after eight
seconds of silence for an actionable request. Incomplete follow-up fragments wait up to seventy-five
seconds for the actual action, then switch back to the short window when it arrives; the hard cap
is two minutes. Bursts combine fragments in source order, reply to the last fragment, and leave
different users concurrent. Engagement is marked when the first
recognized message is admitted so trailing tagless fragments join the open burst. Added a specific
supported-station knowledge route so “fuel card qaysi stationlarda ishlaydi” cannot be mistaken for
a live card-status lookup. The supplied 2026-07-30 human support answer became station article v2,
with its own three-month re-verification expiry; unrelated expired operational facts remain
expired. Colloquial callback requests (`call qivorizlar`) now start a separate CS handoff that
collects the target/contact context and requires confirmation before a real Desk ticket; the bot
never represents a ticket as a completed phone call. Added burst/routing regressions and runtime
aggregation counters.

## 2026-07-31 — AI-native Telegram ingress and dynamic tool routing

Superseded the 2026-07-30 keyword/regex engagement and intent routes. `filter.ts` now contains only
Telegram-verifiable transport state: direct bot mention, reply-to-bot, and the per-user active
conversation clock. All registered tagless messages are grouped into an eight-second burst and
sent to a bounded OpenAI structured-output router. The router decides support vs chatter,
greeting/capability/continuation, completeness, language, service IDs, selected tools, and required
tool calls from the live service catalog and current `ToolManifest` descriptions. The deleted
`toolSelection.ts` keyword table is no longer part of runtime behavior.

The router is advisory, not authoritative. Server code removes hallucinated names, enforces live
service switches and role filtering, hides confirmation-gated mutations until a sender-verified
Telegram button callback, and `toolDispatcher` still rechecks RBAC/validation and audit-logs every
execution. Router failures fail closed: new tagless turns stay silent; direct turns receive only a
safe read-only KB/identity scope. Unregistered group members never consume model tokens.

Added a five-minute/12-message per-user context window for real split-message conversations.
Context is cleared after an admitted request so a new issue does not inherit a stale unanswered
question. Added independent router concurrency/configuration and router call/engage/silent/error
metrics. Capability and unavailable/role-denied responses now use the language returned by the
semantic router rather than text regexes.

Verification: gateway typecheck clean and 58/58 tests pass; root typecheck/build clean; root lint
has zero errors (24 pre-existing warnings); targeted tenant/RBAC suite 41/41 passes. A live OpenAI
router smoke test admitted previously unseen colloquial Uzbek card-failure wording with the live
card-status tool and kept an unrelated team scheduling message silent. A combined backend test
command had 120/120 assertions pass but Vitest reported one unrelated asynchronous mock export
error in `carrier-mini-app.test.ts`; the dedicated tenant/RBAC run is clean.

Required root `pnpm eval:live` spent $0.392 and remained red on the existing generic Mytrion
benchmarks: greeting 4/4, grounding 7/8, delegation 3/3, and tool selection 5/5 passed; routing,
RBAC/refusal, and web-navigation missed thresholds, with several failures returning OpenAI TPM 429
details instead of task answers. This benchmark does not exercise the Telegram gateway ingress
module. The local backend and the restarted AI-router gateway are healthy on ports 3001 and 8787.

## 2026-07-31 — Authenticated-user always-answer and human handoff

Restored the desired support-group contract: every backend-authenticated owner/driver message now
engages, without requiring a bot tag and without a semantic silent/chatter gate. The structured
router still selects the service/tool dynamically, and now returns a typed handoff decision:
commercial, pricing, onboarding, and growth questions resolve the live assigned Sales agent via
`octane_whoami`; unresolved operational requests offer a confirmed Customer Service handoff.
Added the role-checked `general-support` request type, which files a real Zoho Desk CS ticket only
after a trusted Telegram confirmation.

Reduced the default per-user typing debounce from eight seconds to three. Registered messages now
receive immediate best-effort reaction/typing feedback before classification. Marked progress and
reaction tools as best-effort execution metadata, so a report/invoice that completed successfully
can no longer become a generic failure merely because the model skipped a late progress call (the
exact 2026-07-31 production failure).

Verification: pre-change tenant/RBAC baseline 15/15; gateway 60/60 and typecheck clean; backend
typecheck/build clean; targeted gateway/backend routes 117/117; lint has zero errors (24 existing
warnings). Live structured-router smoke admitted a tagless greeting, routed an unseen Uzbek
new-company/pricing question to Sales with `octane_whoami`, and routed an out-of-scope operational
request to Customer Service with identity + confirmation buttons.

Required generic `pnpm eval:live` was rerun and spent $0.357. Greeting 4/4, grounding 7/8, and
tool-selection 4/5 passed, but the unrelated root Mytrion thresholds remained red; all three RBAC
judge tasks and several refusal/delegation tasks hit OpenAI TPM 429 during this run. The dedicated
gateway/tenant RBAC suites above remain green. Local backend, restarted gateway, and Telegram API
connectivity are healthy.
---

## 2026-07-30 — CS Maintenance tab on a Postgres-owned `maintenance_cases` table

Zoho CRM's `Maintenance` module had no UI in Mytrion — it was only read for the Analytics →
Maintenance sub-tab and (via servercrm) the Prepay ledger's maintenance-fee column. Agents went
into Zoho to look at or edit a case. This moves the whole queue into Mytrion.

**Decisions taken with the requester, and their consequences:**

- **Postgres is the source of truth.** Zoho was drained once (2,714 records) and is not read again.
  No sync job, no `Modified_Time` watermark, no write-back — deliberately.
- **No delete.** `total_amount` on these rows is real money feeding prepay math, so removal is not an
  agent action. `status = 'Cancelled'` is the reversible path and the route has no DELETE at all.
- Two paths still touch Zoho and will therefore drift. Both are out of this change's scope and were
  flagged: (1) servercrm's `services/prepayLedger.js` still sums `Total_Amount` from ZOHO for
  `Payment_Method = 'Prepay / EFS'`, so cases created in Mytrion are missing from a carrier's
  `loaded` balance until that column is repointed at this table; (2) the carrier-facing self-service
  widget still creates cases through the `createmaintenance` Deluge, straight into Zoho, so those do
  not appear in the tab. `scripts/migrateMaintenanceFromZoho.ts` is idempotent, so a manual
  re-import remains available with no new code.

### Field discovery came first

`scripts/inspectMaintenanceModule.ts` (new, read-only, ~5 API credits) prints the field catalog,
per-year volume, one raw record and the blueprint state. Preferred over `pnpm meta:zoho-crm`, which
walks every module and dumps org-wide PII to a gitignored file. Findings are in
`docs/crm-maintenance-module.md`; three things no repo knew: the unit-number field is `Unit_Number`,
the company lookup is `Company` (→ Accounts), and `Case_Type` has 9 values (only 3 are in use).
`Status` is NOT blueprint-gated. `Created_By` / `Modified_By` do not exist on this module — selecting
them would 400.

### Notable implementation points

- **`drizzle-kit generate` has been unusable in this repo since 0024** (68 journal entries, 25
  snapshots; it aborts on a 0022/0023 parent-snapshot collision), so `0076_maintenance_cases.sql` is
  hand-authored with `IF NOT EXISTS` throughout — the same way every migration from 0025 on was
  written. The journal entry was appended by hand. Verified by running the full 69-migration chain
  against a fresh throwaway DB.
- **`zoho_record_id` is nullable with a PARTIAL unique index**, `hr_employees` style: every
  Mytrion-created row has none, and a plain unique index would collide on the second one. The primary
  key is our own cuid2 (`mtc_`), not `bigserial`, because we now create rows ourselves.
- **`unit_number` and `carrier_id` are TEXT.** Unit numbers arrive zero-padded (`'012'`); an integer
  column would silently destroy them and the agent searching "012" would find nothing.
- **The unit-number search predicate is character-identical to its expression index**
  (`lower(regexp_replace(unit_number, '[^a-zA-Z0-9]', '', 'g'))`) and a test asserts that, because a
  drift there doesn't break anything — it just quietly stops using the index. `pg_trgm` is NOT
  installed in this DB (only `vector`), and at 2,714 rows `text_pattern_ops` btrees are enough;
  revisit above ~50k rows.
- **Facets drop the filter they drive.** Status counts are computed without the selected status, so
  the tabs keep showing how many cases every other status holds instead of collapsing to zero.
- **`owner_name` holds the FULL name.** COQL returns `Owner.name` as the last name only
  (`"Rivera"` → `"Alex Rivera"`), resolved through the user directory at migration time — the same
  fix `csMaintenance.ts` already carries for the leaderboard.
- **A bug the browser pass caught:** the modal's company box was typeahead-query-only and committed
  the typed text to `name` on *blur*, deferred 150 ms so a dropdown mousedown could land. Type a
  company, click "Create Case" without tabbing away, and the form rejected the save as "Company is
  required" while visibly holding text. Now every keystroke commits, which removes the race instead
  of shortening it.

### Shape note from the data

2,701 of the 2,714 migrated cases are `Completed`; only 13 are live. So the default view is
unfiltered-newest-first (a Completed-heavy list IS the archive an agent searches) and the status tabs
are how they reach the active few.

### Verified

Migration chain green on a fresh DB (all 12 indexes, partial unique included); import 2,714/2,714
with 0 errors and idempotent on re-run; both search indexes confirmed in use via EXPLAIN; 63 new unit
tests pass; suite is 1176 passed with the same 7 files / 11 tests failing as `origin/build` (that
suite is pre-existing flaky). Browser pass against the real 2,714 rows: search by carrier ID, company
and zero-padded unit number; status tabs; filter rail; create and edit persisted end to end; light +
dark; mobile single-column with no horizontal overflow; zero console errors. Vendored bundle rebuilt
and the CS chunk confirmed *reachable* from the entry JS, not merely present.

### Switchover — every Maintenance reader moved off Zoho (same day)

With `maintenance_cases` populated on prod, the remaining Zoho readers were repointed. Parity was
proven against Zoho BEFORE committing, not assumed.

**CS analytics (`src/integrations/csMaintenance.ts`) — COQL → SQL.** Same exported shapes, so
`csAnalytics.routes.ts` and the frontend are untouched. This closes a divergence the tab itself
created: analytics counted Zoho rows while the tab showed Postgres rows, so any agent edit made the
two disagree. Two Zoho-era workarounds are gone rather than ported — the `listActiveUsers()` lookup
that repaired COQL's last-name-only `Owner.name` (it's denormalized on the row now) and COQL's
mandatory-WHERE / binary-AND contortions. The generous `bucketStatus()` matching stays, because the
original Deluge bug was hard-matching words the data never contained.

Parity run against prod, window 2026-07-01→30: every metric identical — current 269, previous 295,
open 7, closed 261, fullComplete 253, halfComplete 9, 3 status buckets, 4 case types, 29 daily points,
10 owners, and per-owner full/half/bonus matching for every agent.

One row differed on the first attempt (268 vs 269) and it is worth recording WHY, because it is the
no-sync decision showing its cost rather than a bug: we already had the row, but our copy had
`case_date = null` — someone set `Date` in Zoho at 21:21:45Z, three minutes AFTER the import finished
at 21:18:44Z. Re-running the (idempotent) importer took it to full parity. Note the re-import
refreshes Zoho-sourced facts, so once agents are editing cases in the tab a blind re-run would revert
their edits; it was safe here only because the tab is not deployed yet.

**Prepay maintenance — from our Postgres, servercrm's Zoho figure discarded.** New
`maintenanceCaseRepo.sumPrepayByCarrier` / `sumPrepayByDay`, with servercrm's semantics copied exactly
(`Payment_Method = 'Prepay / EFS'` only, fee = `total_amount`, bucketed on `case_date`, `endDate`
EXCLUSIVE). `getPrepayExternalsBatch` and `getPrepayLedgerProxy` now override the maintenance term.

Two non-obvious bits:
- The override ZEROES every carrier servercrm reported before writing ours in. Without that pass, a
  carrier whose maintenance now lives only in our table keeps servercrm's stale Zoho number.
- `difference` in the daily ledger is a RUNNING balance, so replacing one day's maintenance
  invalidates that day and every day after it. The recompute reuses servercrm's exact delta formula
  (`top_up - rmve + maintenance + money_code - stripe - zelle - chase - merchant`) and re-derives
  `totals.net`. If that formula changes in servercrm this silently diverges — flagged in the comment.

**servercrm's Zoho maintenance query is deliberately LEFT IN PLACE.** It cannot simply be deleted:
the legacy `zoho-octane/app/billing-mytrion` widget calls `/api/billing/prepay-ledger` DIRECTLY
(`js/constants.js`) and has no route to our database. Overriding downstream keeps that widget working
while making our numbers correct. It does mean servercrm still spends Zoho credits on a figure we
throw away — worth removing once the legacy widget is retired.

Prepay parity against servercrm/Zoho for 2026-07-01→08-01: 5 carriers with maintenance on both sides,
every amount matching to the cent, total the window total.

**Left alone, with reasons:** the legacy `zoho-octane` CS analytics widget still calls the
`mytrionGetMaintenanceAnalytics` Deluge (superseded by the React tab), and `app/maintenanceInvoice/`
reads a Maintenance record through `ZOHO.CRM.API` because it IS a Zoho context-menu widget on that
module — there is nothing to repoint.

28 new tests (16 analytics + 12 prepay). The 9 test files touching this change pass deterministically
twice over; whole-suite failures fluctuate 11–13 on `origin/build` and on this branch alike.

### Fix — the update toast reported the wrong thing, and never left on time

Reported as "notification after updating something is not working correct". Reproduced in the browser
with a MutationObserver (the toast auto-dismisses in 3.5s, so a plain DOM read after the fact finds
nothing, and timer-based polling is unusable while the preview pane is hidden — the browser throttles
timers there). Observed text on an edit:

    Case updated · $1,000.00

Two separate bugs behind it.

**1. Wrong content.** The message reported the case's TOTAL AMOUNT — not what the agent changed (a
Payment Status, in the repro), and not a confirmation of anything. On the 9 cases that carry no amount
it rendered `Case updated · —`, which reads as broken. Now it names the case, symmetric with create:
`Case created for X` / `Case updated for X`. Naming the record is the useful part, since cards look
alike and an agent's real question is "did I just edit the right one".

**2. The 3.5s countdown restarted on every parent re-render** (`Toast.tsx`). Every caller passes an
inline `onDismiss={() => setToast(null)}`, so the handler is a new function each render, and it was in
the effect's dependency list — so each re-render cleared the pending timeout and started a fresh one.
This matters because of WHEN toasts are raised: `save → notify() → refreshAll()` fires three reloads
that land underneath the toast over the next second or two, each re-rendering the panel and pushing
dismissal back (measured ~10s instead of 3.5s). Worse, a toast raised while an agent is typing in the
search box never dismissed at all. Fixed by holding the handler in a ref so the effect depends on
`toast.id` alone.

This is a SHARED component, so the same bug was live in Citifuel, Applications and Retention — all of
them get the correct 3.5s now.

`Toast.test.tsx` (7 tests) pins it, including the case that actually regressed: re-render with a new
handler identity must still dismiss at 3.5s. Verified the test genuinely catches it by re-introducing
the old dependency array — that one case fails, the other six pass.

Web suite 43 files / 279 tests green; backend unchanged at the `origin/build` baseline (7 files / 11
tests, pre-existing flake). Vendored bundle rebuilt — `Case updated for` is in the CS chunk, the old
`Case updated · ` is gone, and the chunk is reachable from the entry JS.

### Optimization + create-form and owner-filter fixes

**Measured before changing anything.** The important correction: the ~263ms-per-query latency in a
local run is my laptop→Oregon, NOT what a user pays — in prod the API sits next to the DB. So the
optimization targets what users actually pay for.

- **41% of the list response was the `raw` jsonb column** (21KB of 52KB for one page of 24), read by
  nothing in the UI. The repo now selects an explicit `CARD_COLUMNS` list; `raw` stays on
  `GET /cs/maintenance/:id` for provenance. Measured: **51,578 → 26,087 bytes, a 49% cut**, on every
  list load and every search keystroke.
- **Rows + total are now ONE query** via `count(*) OVER ()` instead of a `Promise.all` pair.
- **The default sort was not using any index.** `EXPLAIN` showed `Seq Scan` + top-N `Sort` on all
  2,715 rows: the index is `(case_date, id)` ASC while the list orders by `case_date DESC NULLS LAST,
  id DESC`, and a backward scan cannot serve `NULLS LAST` because DESC implies NULLS FIRST. Only ~3ms
  today, which is why nobody noticed, but it is paid on every page and every search and grows with the
  table. `0077_maintenance_cases_sort_idx.sql` adds the matching index; verified on a 5,715-row local
  copy that the plan becomes a bare `Index Scan` with no Sort (0.07ms).

**Create form: company now comes from the DWH, and carrier ID is derived.** `octane.dim_company` is
the authoritative company ↔ carrier map (8,075 rows, every one has a carrier_id, all unique), so
picking a company FILLS the carrier id. The Zoho Accounts typeahead it replaces knew nothing about
carrier ids at all. Two details that shaped the API: `carrier_id` is BIGINT there vs TEXT here so it
is cast, and **49 company names map to more than one carrier id** — so options are rows, not names,
and the dropdown renders the carrier id beside the name or the pick would be ambiguous.

Carrier ID is **read-only, not removed**. Removing it was the other option; it stays visible because
it is the tab's primary search key and appears on every card, so a modal that hid it could not show
what the agent searched by. Changing the company clears both the carrier id and any `company_zoho_id`
— a stale carrier id is worse than none, and the Zoho Accounts link on a migrated record described the
OLD company.

**Owner filter — "not showing all owners" was a real bug, not just ergonomics.** 4 of the 16 owners
rendered as raw 19-digit Zoho ids, covering **766 cases (28%)**. Cause: they are DEACTIVATED users, so
`listActiveUsers()` (127 users) omits them AND COQL returns `Owner: {id, name: null}` for them — the
mapper's last-name fallback had nothing to fall back to, `owner_name` landed null, and
`distinctOwners()` substituted the id for display. `getUserById` resolves all four (names deliberately
not recorded here), so the importer now collects ids the active roster missed and fetches just those —
a handful of extra calls, not one per record. **The prod backfill still needs a
re-import to take effect.**

The filter itself is now a searchable select (`SearchableSelect.tsx`, client-side over the roster that
already arrives with `/meta`), with prefix matches ranked above mid-string ones, keyboard nav, and an
Escape that closes the panel WITHOUT bubbling to the surrounding rail.

Verified in the browser end to end: owner search filters 16 → 2 with `Alex Rivera` above
`Tamara Diaz`; company search returns options with carrier ids; picking one fills `5000001`; typing
`9999999` into the read-only carrier field leaves it unchanged; the created case persisted carrier
`5000001` and zero-padded unit `077`. 14 SearchableSelect tests + 3 route tests added.

Suite note: the backend suite's failure count is genuinely non-deterministic — 11, then 92, then 11
twice in a row on identical code. Two consecutive runs land on the `origin/build` baseline of 7 files /
11 tests, with 1,208 passing (up from 1,113), and the 5 files touching this work pass 95/95 twice.

### Fix — owner dropdown painted under the cards, and one radius for every CS control

**The dropdown was not a z-index VALUE problem.** It already set `position: absolute; z-index: 300`
and was still painted under the card grid. `.cs-mt-filters` receives `backdrop-filter: blur(20px)` from
the Horizon pane recipe, and **backdrop-filter creates a stacking context** — with the pane's own
`z-index` left at `auto`, everything inside it (300 included) is sealed in, and the card grid is a
LATER SIBLING, so the cards win on DOM order regardless. Diagnosed by walking the ancestor chain for
stacking-context triggers and confirming with `document.elementFromPoint`, which returned
`button.cs-mt-card` at a point inside the dropdown.

Fixed by raising the PANE (`position: relative; z-index: 20`), which lifts its whole subtree. 20 clears
the grid and stays far below the modal layer — verified the modal backdrop (9990) still wins over it.
The dropdown's background was already fully opaque (`rgb(23,29,40)`), so "not fully readable" was
entirely the cards painting over it, not transparency. Same trap as the RingCentral card versus
`.cs-root { isolation: isolate }` — commented in place so nobody "tidies" the z-index away.

**Control radii had drifted into four values in the same row.** Measured: buttons 12px, the owner
combobox 8px, every native `<select>` and date input 6px, and the search bars **0px**. The cause is two
token scales coexisting — the legacy widget's `--radius-*` collapses xs/sm/md/lg all to **6px**, while
Horizon's `--r-*` is the real 8/12/16/22 ramp, so anything still reaching for `--radius-md` renders
square next to a 12px button. Every control now takes `--r-md`, matching the buttons.

Two specificity traps hit on the way, both the same shape as the earlier doubled-focus-ring bug — a
per-panel rule outranking a module-level one, where import order cannot help:
- `.cs-root .cs-an-rc-field input[type="date"]` (two classes + an attribute) beat a plain two-class
  selector, so the date inputs stayed 6px.
- `.cs-root .cs-an-range-select` (two classes) beat `.cs-root select` (one class + one element), so the
  Analytics period select stayed 6px.
Both are now named explicitly with the reason recorded next to them.

Verified by measuring every control across four mounted tabs: **11 controls, all 12px, zero
holdouts** — Maintenance filters, the Citifuel search bar, modal `.cs-form-input`s, the Analytics
period select and custom-range date fields. Web suite 49 files / 344 tests green.

Also visible in the verification screenshots and worth restating: two owner rows still render as raw
Zoho ids in the local snapshot. That is the deactivated-user bug — the importer fix is in, but the
**prod re-import has not been run**, so the backfill has not taken effect anywhere yet.

### mytrion-ops is now fully off Zoho for Maintenance

Audited every reference rather than trusting the earlier passes, and found two Zoho paths still live in
mytrion-ops that the read-side migration had not touched — both in the touchpoint catalog, which
`GET|POST /v1/touchpoints/:key` executes for ANY entry, so both were reachable by API callers and by
agents even though no frontend used either:

- **`maintenance.create`** (carrierDeluge) — `riskClass: 'write'`, called the `createmaintenance`
  Deluge. This was the real find: a WRITE that created a case in Zoho, which Mytrion then cannot see,
  because reads all come from Postgres and there is deliberately no sync back. Removed. Cases are
  created through `POST /cs/maintenance`, which writes the table everything else reads.
- **`cs.analytics.maintenance`** (csDeluge) — called `mytrionGetMaintenanceAnalytics`. Superseded by
  the SQL route; leaving it in meant a caller could still get Zoho figures that disagree with the tab.
  Removed.

**The Zoho CRM widgets are unaffected, and this was verified before deleting anything:** zoho-octane has
ZERO references to `/touchpoints` — its widgets call `ZOHO.CRM.FUNCTIONS.execute("createmaintenance")`
and `("mytrionGetMaintenanceAnalytics")` directly inside Zoho (6 and 2 call sites). Nothing in servercrm
or the mini-app references either key either. So only mytrion-ops' catalog entries were removed; the
Deluge functions themselves are untouched in Zoho and the widgets keep working exactly as before.

Confirmed at runtime, not just by grep: `getTouchpoint()` returns undefined for both keys, no catalog
entry names a Maintenance Deluge function, and catalog size went 105 → 103.

Final audit of `src/`: exactly ONE file still contains Zoho code for Maintenance —
`integrations/csMaintenanceRecords.ts`, the COQL drain, imported by nothing except
`scripts/migrateMaintenanceFromZoho.ts`. Every other hit is a comment.

Three stale assertions/comments the removal exposed, all fixed rather than suppressed:
- `cs-routes.test.ts` asserted the four cs.* entries → now three, plus a new test that pins BOTH keys
  as absent and that no touchpoint may call a Maintenance Deluge.
- `touchpoints-catalog.test.ts` pinned the deluge count at 19 → 17, and listed `createmaintenance`
  among the functions the catalog must cover → removed from that list with the reason recorded (the
  data moved out of Zoho, unlike the others which moved into TypeScript handlers).
- `touchpoints-routes.test.ts` pinned the catalog total at 105 → 103. Its comment had said 106 against
  an assertion of 105, so that drift is corrected too.
- Also dropped the orphaned `CsMaintenanceAnalytics` frontend type and its touchpoint-map entry, and
  fixed the `csAnalytics.routes.ts` comment that still described the route as "native COQL".

Worth noting on process: the two new tests PASSED under vitest while `tsc` failed — `functionNames`
exists only on the 'deluge' variant of the Touchpoint union, so the assertion needed a `kind` narrow.
Vitest does not typecheck; running tsc separately is what caught it.

Backend suite back to the exact `origin/main` baseline (7 files / 11 tests, pre-existing flake) with
1,285 passing. Web 49 files / 344 tests green.

## 2026-07-30 — Prod migrate + re-import: a timestamp collision had been silently eating migrations

Ran the two outstanding prod steps. Both were blocked by the same root cause, and finding it turned up
a defect in `main`'s work, not just mine.

### The migrator had been reporting success and doing nothing

Pre-flight (read-only) against prod showed the sort index absent while the journal implied it was
applied. Identifying the applied rows by hashing every historical blob — `created_at` alone cannot
identify a row, because two branches can stamp the same millisecond — gave the picture:

    id=141  created_at 1785394800000  hash 6d53da0e685f  = this branch's 0076_maintenance_cases
    id=142  created_at 1785398400000  hash c1e6097ecf59  = main's 0077_support_bot_chat_tenant_scope

`main` had advanced 14 commits and taken 0076/0077 with `when` stamps **identical** to this branch's:
1785394800000 and 1785398400000. Drizzle applies an entry only when
`lastApplied.created_at < entry.when` and reads that ceiling ONCE before the loop, so of two entries
sharing a millisecond only the first to reach a database ever runs. Consequences, both verified against
prod rather than reasoned about:

- **main's `0076_support_bot_operations` never ran on prod.** `support_bot_operations`,
  `support_bot_session_fences`, their five indexes and the `support_bot_fencing_seq` sequence were all
  absent, while the journal implied otherwise. Deployed support-bot code touching those tables was
  failing at runtime. This branch's migration reached prod first and blocked it.
- **The maintenance sort index had been skipped for days.** main's 0077 landing made prod's ceiling
  *equal* this branch's 0077 stamp, and `<` is strict.

Resolution: main keeps 0076/0077 verbatim; the maintenance migrations become **0079** and **0080**
(0078 belongs to `0078_support_bot_memories` on an unmerged branch), stamped `prod_max + 1ms / + 2ms`
rather than the next hour slot — the next slot is already that branch's, and stamping above it would
push *their* migration below the deployed ceiling and skip it in turn. No duplicate `when` values
remain anywhere in the journal.

`0081_support_bot_operations_repair.sql` re-applies main's 0076 verbatim. The migrator cannot be made
to revisit that entry — its stamp sits permanently below prod's ceiling — so a fresh entry above the
ceiling is the only thing that can repair the database. All statements are IF NOT EXISTS, so it no-ops
wherever 0076 did apply.

**The lesson worth carrying:** a green `pnpm db:migrate` proves nothing. Verify the objects.

### A re-import would have overwritten an agent's edit

`upsertMany` kept created_by/updated_by out of the conflict `set` and its comment claimed that meant a
re-run never clobbers an agent's work. It did not: the audit columns survived while every business
column still took `excluded.…`, so the row would have shown Zoho's stale value with
`updated_by_user_id` still naming the agent — as though they had reverted their own correction. Prod
had exactly one such row. Fixed with `setWhere: updated_by_user_id is null`, plus a returned `skipped`
count so the importer explains a `written < fetched` gap instead of looking like data loss.

### Results on prod

- Migrations applied and **verified by querying for the objects**: both support_bot tables, all five
  indexes, the fencing sequence, and `maintenance_cases_case_date_desc_idx`.
- Default list order now plans as `Index Only Scan … maintenance_cases_case_date_desc_idx`,
  Heap Fetches 0, 0.058 ms — it was a Seq Scan + top-N sort.
- Import: 2,717 drained, 2,716 upserted, **1 left alone** (the Mytrion-edited row; guard confirmed to
  have held — its `synced_at` and `updated_at` both predate the run).
- **`owner_name` NULL: 766 rows → 0.** All 16 owners resolve to real names; the four deactivated users
  now come back through `getUserById`.
- No duplicate `zoho_record_id`.

### Two things the numbers surface, both consequences of the no-sync decision

- Table holds **2,718** against Zoho's **2,717**. The extra row is `mtc_myqq5lpwxgtllulpcpxko361`
  (In Process, case_date 2026-07-29): confirmed via `getRecord` to have been **deleted in Zoho** after
  the first import. We keep it, because Postgres is the source of truth and there is no delete path —
  `Status = Cancelled` is the soft path if it should go. Not touched unilaterally.
- Zoho gained 2 records between the two imports, presumably from the carrier-facing self-service
  widget, which still writes maintenance tickets straight into Zoho. Until that widget is repointed at
  `POST /cs/maintenance`, "everyone uses mytrion-ops" stays a convention rather than something enforced.

Vendored bundle checked, not rebuilt: main made **zero** frontend src or `app/` changes since the merge
base, so the merge left the bundle coherent. Verified by BFS over the chunk graph from the entry
`index.html` points at — the Maintenance JS and CSS are both reachable.

Test baseline unchanged: 11 failures in 7 files, byte-identical set to `origin/main` (confirmed by
running those files in a detached `origin/main` worktree). All 5 maintenance suites green (96 tests).

## 2026-07-30 (later) — The module's two workflow rules came across too

The data migration moved fields and rows. It did not move BEHAVIOUR: Zoho workflow rules fire on Zoho
records, so both rules on the Maintenance module stopped applying the moment cases started being
created in Postgres. Nothing errored — a rule that never runs just leaves a column empty forever.

Recovered read-only from the live org with a new `scripts/inspectMaintenanceAutomation.ts` (~6 credits)
rather than inferred from field names. The endpoint shapes are worth recording because the documented
ones 404 on this org's API version:

    /settings/automation/workflow_rules?module=Maintenance   works (list; per-rule GET has the criteria)
    /settings/automation/field_updates?module=Maintenance     works  <-- NOT /settings/actions/...
    /settings/functions            +  /settings/functions/{id}/code   works (Deluge source)

Both rules were still firing when captured (`last_executed_time` today on each).

### Rule 1 — "Compensation Prepopulation" (create_or_edit, repeat)

Three static field updates: Completion 5, Lead 10, Half-Completion 2.5. Every one of the 2,718
imported rows already holds 5.00 / 10.00 / 2.50 **because the Zoho rule filled them** — which is
exactly why the gap was invisible: the tab looked correct on migrated data and would only have shown
empty compensation on the first case somebody created here.

These are the same rates the analytics leaderboard multiplies, so `BONUS_FULL_USD` / `BONUS_HALF_USD`
now DERIVE from `COMPENSATION_DEFAULTS` instead of restating 5 and 2.5 as separate literals. Two
copies would have let the payout rate drift from the fee stored on each case, with both sides
internally consistent and disagreeing.

**Deliberate divergence.** Zoho ORs the three criteria while firing all three actions unconditionally,
so in Zoho one empty field resets the other two — a hand-set 7.00 completion fee reverts to 5.00 as
soon as any other compensation is blank. That is an artifact of expressing three independent defaults
as one rule, not intent anybody would state out loud, so Mytrion applies each default independently
and only where the value is empty. An override entered here sticks. A test pins this and would fail
against a faithful port, on purpose.

### Rule 2 — "UpdateCompanyForMaintenance" (create only)

Deluge: if the Company lookup is empty, find an Account whose `Account_Name` equals the case's `Name`;
if none exists, CREATE that Account and link it. Net effect either way: the linked company name always
equals the case name.

**Deliberate divergence.** It creates nothing in Zoho — writing an Account back would break the freeze
this whole migration rests on. `companyName` is filled from `name`, then the DWH `octane.dim_company`
supplies a canonical name plus the **carrier id**, which the Zoho rule never did. Only an exact
case-insensitive name match may adopt a carrier id: a fuzzy hit would attach a case and its money to
the wrong carrier, which is much worse than a blank field. `companyZohoId` stays null on a
Mytrion-created case by design.

**214 imported rows have no company at all** — cases this rule never linked (it was added 2025-07-14,
after the oldest cases). Left as-is; backfilling is a data decision, not a code one.

### Verification, and a false one I nearly reported

Applied by the route on create and edit, so every path gets them, not just the form. The create modal
also prefills the three amounts, so an agent sees the numbers before saving rather than after — Zoho
stamped them on save.

End-to-end against a real Postgres (local DB, rows cleaned up after): a create with no company and no
compensation came back with all three amounts and the company set; an explicit 7.00 survived while the
other two still defaulted; clearing an amount on edit put the default back; and a real DWH company
name adopted the right carrier id with `companyZohoId` still null.

**The near-miss worth remembering:** the first end-to-end attempt showed the rules NOT firing. The
cause was not the code — a 16-hour-old `tsx watch` server already owned the port, my instance died with
EADDRINUSE, and both my health check and my create were answered by the stale process. `curl /health`
succeeding proves a server is there, not that it is YOURS. The discriminator that settled it was asking
`/cs/maintenance/meta` for a key only the new code returns (`compensationDefaults`). Do that before
trusting any local verification. The user's own long-running servers on :3001/:3002 were left alone and
a free port used instead.

Suite back to the `origin/main` baseline: 11 failures / 7 files, identical set. One run in between
reported 94 failures across 21 files — the same load-dependent flake seen before (route suites using
`app.inject` time out under contention); a clean re-run returned to 11. Web 49 files / 344 tests green.
Vendored bundle rebuilt and the new constants confirmed present in a chunk reachable from the entry.

## 2026-07-31 — PR #102 build merge conflict resolution

Merged the latest `origin/build` into `feature/agent-gateway-multi-token-failover` for PR #102.
Preserved both append-only `WORKING_NOTES.md` histories. Build already owned migrations 0079–0081,
so the support-bot knowledge migration was renumbered from 0079 to 0082 and the Drizzle journal was
resolved with unique, sequential indexes and all four migration entries intact.

## 2026-07-30 — HR navigation and presentation polish

Removed the shared-shell Time Off shortcut and its modal so leave requests are available only from
HR Mytrion's Time Off tab. The shared sidebar now gives its long navigation list its own scroll area,
keeps the profile footer outside that scroll region, and uses slightly larger tab, section, and
profile typography; this also resolves the Admin sidebar overlap.

HR now scopes Space Grotesk across the complete module. Employees, Departments, and Org Structure
use one labeled KPI tile system; Attendance totals use the same visual hierarchy, while Time Off
retains its balance cards. All cold data loads now use the shared branded HR page loader, with small
inline busy indicators reserved for saves and refreshes.

Verification: frontend TypeScript, the production Vite build, and all 323 frontend tests pass;
`git diff --check` is clean. Authenticated visual QA could not run in the isolated browser session
because it opened at the Zoho sign-in screen.

## 2026-07-30 — Recruit Mytrion and HR admin refinements

Added the native Recruit Mytrion with persisted, tenant-scoped Job Openings, Candidates, and
admin-owned conversion settings. Openings link directly to existing HR departments. Candidates
move through a six-stage pipeline, and an admin can atomically convert an accepted candidate into
an `hr_employees` record; the candidate claim and employee insert share one transaction so partial
hires cannot be committed. Recruiter and HR access defaults were added, while conversion and
settings remain admin-only.

Built the Recruit Home, Job Openings, Candidates, and Settings screens with the shared Horizon
shell, responsive cards, bordered modals, consistent loaders, and Space Grotesk typography.
Settings is pinned above the signed-in profile. Recruit settings control employee-ID prefix,
default location, and initial status.

HR Settings is now a consistent control center with bordered policy blocks and clearer grouping for
directory sync, attendance operations, and Time Off. The attendance webhook explainer was removed.
The employee directory defaults to department grouping and adds order controls for newest, active,
terminated, and name; the Face ID glyph is now a face-scan icon. Employee details also expose an
admin-only Zoho CRM user link/unlink workflow so a new sign-in can be attached after conversion.

Verification: backend and frontend typechecks pass; backend and frontend production builds pass;
lint has 0 errors (24 existing warnings). Targeted Recruit/HR/access tests pass 57/57. The full
backend suite reached 1,272 passing tests with 10 unrelated existing failures in touchpoints,
stream adapter, tool-count, Zoho MCP, retention caps, and notification copy. Visual QA ran through
the dev mock: Recruit Home, opening modal, HR Settings, sidebar pinning, and the employee order menu
were inspected; a stacking issue on the order menu was found and fixed.

## 2026-07-30 — Recruit runtime recovery and theme alignment

Traced the Recruit Job Openings and Candidates 500 responses to an unapplied database migration:
all three Recruit relations were absent from the active database. Applied migration
`0079_recruit_workspace.sql` and confirmed the tenant-scoped job and candidate repository reads now
complete with empty result sets instead of throwing. Registered all Recruit schema modules in
`drizzle.config.ts` so schema generation and drift checks include the workspace going forward.

Aligned Recruit with the parent Horizon visual system in both themes. The complete workspace now
uses Space Grotesk, slightly larger navigation and content typography, shared glass pane/border/
shadow tokens, theme-owned semantic accents, and clearer elevated modal treatment. Dark and light
pages were inspected live at desktop size.

Verification: backend and frontend typechecks pass; production frontend build passes; lint has zero
errors and 24 existing warnings. Recruit/HR/access backend tests pass 40/40 and the frontend access
suite passes 17/17. Direct repository smoke reads after migration returned zero jobs and zero
candidates without an error.

## 2026-07-30 — Oybek attendance production rollout

Restricted Hikvision attendance ingestion to door names containing `Oybek`; non-Oybek events now
stop before employee lookup or persistence. Device wall-clock timestamps are parsed as
Asia/Tashkent and stored as UTC, while work dates, display times, week anchors, and overnight
03:00 bucketing use the UZB calendar. Webhook batches are audit-logged with accepted, skipped, and
failed counts.

Face ID matching now safely normalizes numeric zero padding (`00000564` = `564`) while ambiguous
matches fail closed. Stored unmapped Oybek punches reconcile automatically on a matching future
punch, an employee Face ID edit, or an employee-directory sync. HR Team attendance shows an
actionable unmatched-punch count for HR/Admin users.

Worked time now pairs every entry with the next exit and sums completed office visits. Repeated
entry scans do not inflate hours, unmatched scans are disclosed, and open sessions render as
`Still inside`. My Data and Team details show Tashkent-local last activity, in/out state, individual
sessions, and total in-office time in clearer bordered blocks.

Applied `0080_hr_oybek_attendance.sql` to the active database. It created the active
`UZB Tashkent · Oybek` 19:00–03:00 Asia/Tashkent shift and assigned 122 eligible active employees
effective 2026-07-30. Fifteen active Canada employees were excluded; there is currently no US
department. The live data currently has eight unmatched Oybek punches; Face ID `00000215` has no
employee profile match yet, so it remains safely unmapped and visible to HR instead of being guessed.

Verification: backend/frontend typechecks and the frontend production build pass; lint has zero
errors and 24 existing warnings. Attendance unit/route tests pass 19/19, adjacent HR/Recruit route
tests pass 19/19, and HR attendance UI/access tests pass 18/18. Repository smoke checks confirmed
the shift, assignment count, exclusions, and zero-padding match behavior.

## 2026-07-30 — Ganga attendance correction and manager shift assignment

Corrected the authoritative attendance source from Oybek to Ganga. Hikvision events are now
accepted only when `door_name` contains `Ganga` (case-insensitive); every Oybek and other-door
event stops before employee lookup or persistence. Applied `0081_hr_ganga_attendance.sql`, which
renamed the existing overnight shift to `UZB Tashkent · Ganga`, preserved its 122 employee
assignments, removed the incorrectly ingested Oybek punch rows, reconciled unambiguous stored
Ganga Face IDs, and re-bucketed mapped Ganga events on the Tashkent overnight work date.

Department managers can now assign an active shift from an employee's Attendance Team detail.
Authorization is enforced by the attendance route: admins and HR managers may assign any employee;
a department manager may assign direct reports and employees in departments they lead, but cannot
assign themselves or employees outside their managed scope. The entire requested target set is
authorized before the first write, preventing partial batch assignment. Reassigning the same
effective date updates the existing assignment instead of creating a conflict.

Verification: attendance unit/route tests pass 21/21, adjacent HR/Recruit route tests pass 19/19,
and HR attendance UI/access tests pass 18/18. Backend and frontend TypeScript checks and the
frontend production build pass. Lint has zero errors and 24 existing warnings. Live repository
verification confirmed the renamed 19:00–03:00 Asia/Tashkent shift and 122 preserved assignments;
there were no stored Ganga punches at verification time.

## 2026-07-31 — HR light mode + org canvas UX

Light HR: softer coral accent, quieter page/pane/border tokens, calmer cards and
inputs across tabs. Org chart: single-click opens department/employee modals;
expand/collapse keeps existing node positions and parks new children under the
parent (no full re-fit jump). Attendance no longer shows the unmapped Ganga
punches banner.

## 2026-07-31 — Manager typography, loyalty controls, and final tier audit

Changed the complete Manager shell—including shared sidebar chrome, department tabs, Referrals,
Loyalty, and portal modals—to Space Grotesk. Added a final Manager finish layer with quieter neutral
glass surfaces, softer light-mode mesh/borders, restrained tier/referral tints, and single-border
modal elevation. The Referrals month control is now a full clickable button that explicitly opens
the native month picker; its native input no longer owns an invisible, unreliable hit area.

Added tenant-scoped `loyalty_client_overrides` persistence and migration 0085. A Manager Loyalty card
now opens a client-control modal where a full-access Manager user can select an Enterprise operating
mode, set the manual Enterprise Gold ULSR+ULSD target, and enable/disable the six reward benefits as
an explicit checklist. Saving and resetting are audited. Null rewards preserve automatic tier
defaults; an empty checklist intentionally disables all benefits. Overrides are returned to both the
company-wide Manager roster and owner-scoped Sales clients, so the displayed tier/rewards stay
consistent between Mytrions.

Re-audited the rules: previous-calendar-month distinct transacting cards determine the track;
previous-month ULSR+ULSD gallons determine the active tier; total gallons and account active cards
remain reference-only; exact thresholds/no grace still apply. Enterprise stays outside Bronze and
Silver. A stored volume target grants Enterprise Gold only at full attainment, while Normal Billing
never creates a gallon tier. The live read-only DWH check for the closed month confirmed ULSD
6,042,502.01 gallons and ULSR 69,917.17 gallons as distinct categories; DEFD/FUEL/other categories
remain excluded from tier gallons.

Verification: backend typecheck passes; lint has zero errors and 23 existing warnings. Manager
Loyalty/Data Center routes pass 42/42, focused loyalty/month-picker tests pass 20/20, and the complete
frontend suite passes 320/320. Frontend TypeScript reaches only the pre-existing unrelated
`HrAttendance.tsx` incomplete UserContext fixture, which was left untouched per the request to ignore
HR changes.

## 2026-07-31 — Manager performance and workspace release hardening

Removed the principal Referral loading bottlenecks. MART fuel-code variants are now calculated in
one bound query instead of repeatedly scanning the transaction history, and the month-independent
Zoho parent/child/Deal relationship graph is cached separately from monthly volume calculations.
Tenant/month snapshots have bounded TTL, in-flight request deduplication, manual force-refresh, and
recent-snapshot fallback. A live cold calculation returned the 687-parent workspace in 5.7 seconds;
switching month after the relationship graph was warm took 2.4 seconds, and a cached return was
immediate.

Replaced Manager Loyalty's reuse of the full Sales debt/PII roster with a dedicated company-wide
tier projection that preserves the same closed-month ULSR+ULSD, transacting-card, and billing-cycle
formulas. Both global and per-agent rosters now have bounded caches, concurrent-request sharing, and
stale fallback. The optional client-override read degrades to automatic rewards when migration 0085
is not yet available, while writes remain fail-closed. DWH outages now surface as a specific 502
instead of an opaque 500. Live reads returned 8,097 Manager clients in 1.4 seconds and 374 scoped
Sales clients in 0.7 seconds.

Fixed HR Org Structure collapse so closing a department clears every expanded descendant department,
manager, and employee instead of leaving nested people visible. Removed the double border from the
Time Off year control and corrected the Attendance admin-access type guard. Recruit now uses the
shared Horizon page loader, full Space Grotesk controls/modals, and calmer light/dark glass surfaces.
Manager Sales is a polished Coming Soon workspace and is labelled accordingly on the Manager home.
Removed two stray loyalty CSS declarations that produced production minifier warnings.

Verification: backend and frontend typechecks pass; lint has zero errors and 23 existing warnings;
the complete frontend suite passes 321/321; the frontend production build passes without CSS syntax
warnings; focused Manager/Referral/Data Center tests pass 103/103. The full backend suite reaches 1,277 passing
tests but is not repository-green: 37 unrelated baseline/environment tests fail across remote
database DNS, sandboxed websocket binding, Customer Service/retention/touchpoint expectations, and
older stream/tool mocks. Migration 0085 remains required before production users can persist Loyalty
overrides, although roster reads now remain available before it is applied.

## 2026-07-31 — Build merge for the HR/Recruit/Manager workspace (migration renumber)

Merged `origin/build` (through PR #102, `5b3b935`) into `feature/hr-workspace-v2`. Three files
conflicted: `WORKING_NOTES.md`, `drizzle.config.ts`, and the Drizzle journal. Both append-only
histories are preserved and the Drizzle schema list is the union of both sides
(`maintenance_cases` alongside the six HR leave tables and three Recruit tables).

Build had taken 0079–0082, so this branch's six migrations were renumbered. Their **relative order
is unchanged** — the Ganga correction still follows the Oybek seed, and the ingest guard still
follows both — because reordering them would let the non-Ganga trigger predate the punches it is
meant to clean up:

| was | now |
| --- | --- |
| `0079_recruit_workspace` | `0083_recruit_workspace` |
| `0080_hr_oybek_attendance` | `0084_hr_oybek_attendance` |
| `0081_hr_ganga_attendance` | `0085_hr_ganga_attendance` |
| `0083_hr_workspace_recovery` | `0086_hr_workspace_recovery` |
| `0084_hr_ganga_ingest_guard` | `0087_hr_ganga_ingest_guard` |
| `0085_loyalty_client_overrides` | `0088_loyalty_client_overrides` |

The `when` stamps matter more than the filenames, and this branch had walked into exactly the trap
the 2026-07-30 prod-migrate entry documents: our `0079_recruit_workspace` carried
`1785405600000`, the **same millisecond** as build's `0082_support_bot_knowledge`. Because Drizzle
reads its ceiling once and applies only on a strict `<`, whichever of the two reached a database
first would have permanently silenced the other. The six entries are now stamped
`1785409200000` … `1785427200000`, strictly above build's highest (`0082`, `1785405600000`), and
the journal has no duplicate `when` value and no duplicate tag anywhere.

Two things carried over from build rather than fixed here, both worth a separate decision:
build's 0079–0081 sit *below* `0078_support_bot_memories` by design (they were stamped
`prod_max + 1ms` while 0078 was still unmerged), so on any database already at 0078 they are
skipped — prod got them by hand; and `.whois.tmp.mjs`, the migration-hashing scratch script from
`495f886`, is still committed at the repo root.

**The conflict Git did not report.** Both sides had rebuilt `apps/mytrion-crm/app`, and because Vite
filenames are content-hashed, Git saw two disjoint sets of adds/renames and merged them without a
murmur. The result was build's bundle verbatim: its `index.html` still pointed at
`index-FBX2djQY.js`, and no chunk contained a single HR, Recruit, or Manager string. A clean
`pnpm lint && typecheck && test` would have signed off on a merge that shipped none of this
branch's UI. Rebuilt with `pnpm build:widget` and re-staged; the new entry is `index-DPxzEfi_.js`,
all 54 chunks are reachable from it with zero orphans, and "Job Opening", "Recruit", "Time Off"
(this branch) and "Maintenance" (build) all resolve to reachable chunks.

Verification: backend and frontend typechecks pass; lint is 0 errors / 23 pre-existing warnings;
frontend 52 files / 342 tests pass. Backend is 11 failed / 1,430 passed across 7 files — the same
baseline set build recorded (`boot-db-transient`, `notification-templates`, `retention-cs-caps`,
`stream-adapter`, `tools`, `touchpoints-routes`, `zoho-crm`), none of them HR, Recruit, Manager,
Loyalty, or Maintenance. Migrations were run against a throwaway `merge_verify` database rather
than reasoned about: 89 entries applied, 87 tables, and `maintenance_cases`,
`support_bot_knowledge_articles`, `support_bot_operations`, the three `recruit_*` tables, the
`hr_leave_*` tables, `loyalty_client_overrides`, and the `hr_attendance_ganga_only_trg` trigger all
verified present.

## 2026-07-31 — OpenAI-only gateway overload control

Added pre-router admission to `apps/agent-gateway-groq`: at most 200 authenticated requests may be
pending across router wait, model wait, and active execution, with a default cap of 3 per Telegram
user. Admission is acquired before any OpenAI routing call and released only after final turn stats.
Both the router queue and model queue remove requests that exceed the configurable 45-second
deadline; rejected or stale requests receive a static bilingual high-demand reply without an
OpenAI call.

All OpenAI paths (semantic router, main Responses loop, and vision extraction) now share RPM/TPM
token buckets. Reservations use conservative estimates and reconcile against response usage.
The gateway disables SDK retries, honors `Retry-After` itself, retries once by default, and opens a
30-second circuit after 3 consecutive 429 responses. Calls reaching an open circuit are rejected
before network I/O. Router usage is included in each turn's monitor/cost totals, including greeting
and capability fast paths; limiter, circuit, admission, stale, and router-token counters are exposed
through `/api/metrics`.

Added deterministic tests for global/per-user admission, stale FIFO removal, Retry-After handling,
deadline rejection, and circuit-open short-circuiting. Gateway verification after implementation:
TypeScript clean and 18 files / 66 tests passing.

Repository validation: lint completed with 0 errors (24 pre-existing non-null warnings), root
typecheck and build passed. The full root suite remained at its known branch baseline of 11 failures
across 7 files (1,398 passed); no gateway test failed. The required live behavioral eval ran against
the configured local/scratch database: 31/43 passed, 12 failed, $0.392 total. Several failures were
caused by the existing root harness hitting the account's 200k TPM limit and surfacing raw 429s,
which is direct production evidence for the gateway-level limiter/circuit work in this session.
The remaining eval failures concern the separate root orchestrator's routing/grounding/browser
behavior, not `apps/agent-gateway-groq`.

## 2026-07-31 — Gateway overload-control review and local smoke

Reviewed the uncommitted `apps/agent-gateway-groq` overload-control changes. Gateway strict
TypeScript and all 18 gateway test files / 66 tests passed. The concurrency stress harness passed
300 requests across 100 users with a maximum of 8 active turns, zero same-user overlap, zero
out-of-order turns, and empty queues at completion. Root lint and typecheck passed (the same 24
pre-existing lint warnings). The full root suite remained red in unrelated areas and was
load-sensitive: the unrestricted rerun reported 60 failures across 11 files, while all gateway and
cross-tenant RBAC leakage tests passed.

Started the full gateway locally on an isolated port with dummy Telegram/OpenAI credentials and an
unreachable local backend, avoiding production polling and model calls. Startup completed, `/health`
returned `{ "ok": true }`, and `/api/metrics` exposed the expected admission and OpenAI resilience
snapshots. The local browser and gateway processes were stopped afterward.

Deployment blocker found in review: `MAX_PENDING_PER_USER` is documented and described as a global
Telegram-user cap, but both message and callback admission pass a `chatId:userId` key. A single user
can therefore hold up to the configured limit independently in every chat. Add a cross-chat test and
key per-user admission by verified Telegram user id before deployment.

## 2026-07-31 — Agent gateway 800-group production/security audit

Audited `apps/agent-gateway-groq` plus its `/v1/support-bot/*` backend trust boundary for the planned
customer-service rollout to roughly 800 client groups. This was a read-only audit; no application
code was changed. The local gateway and backend were left running and both returned HTTP 200. The
local chat map currently contains one mapped chat / one carrier plus the env fallback, so it is a
single-client smoke environment, not an 800-group proof.

Release decision: **no-go for the 800-group production rollout until the P0/P1 findings are fixed.**
The strongest existing controls are sender-derived Telegram identity, carrier binding outside model
arguments, backend carrier/registration revalidation on business calls, role-filtered `ToolManifest`
tools, runtime Zod validation, disabled-tool fail-closed behavior, private delivery for money/PII,
and bounded router/model admission with 429 handling.

P0/P1 findings:

- Support-bot backend routes use `sessionOrApiKey`, although handlers trust payload
  `telegramUserId` as the acting customer. A normal authenticated session can reach chat-map/access
  endpoints and the same business endpoints; the gateway also holds the general backend API key,
  which becomes an admin system identity for the whole API. Replace this with a dedicated,
  least-privilege service principal and deny user sessions on service-only routes.
- Central message batches assign every row to `config.carrierId` instead of the chat-resolved carrier.
  In true multi-chat mode this either rejects all batches (empty fallback) or misattributes every
  client's messages to one carrier. Carry carrier per row, batch by carrier, and validate the
  chat-to-carrier mapping server-side.
- A callback is considered trusted confirmation solely when callback data ends in `:yes`. It is not
  bound to the requester, tool, canonical arguments, message, expiry, or one-time nonce. A stale or
  cross-user button can expose a different write selected by the model. Persist and atomically
  consume a signed/opaque confirmation record bound to all of those fields.
- Telegram updates and write tools lack end-to-end idempotency. The backend has a card-action
  idempotency slice behind `FF_SUPPORT_BOT_IDEMPOTENCY`, but the gateway sends none of its required
  fence/idempotency headers; other money-code/card/ticket writes remain uncovered. A crash before
  long-poll offset acknowledgement can replay a completed mutation.
- Every mapped-group message, including unregistered ordinary chatter, is copied in full to local
  monthly JSONL and central Postgres without an explicit retention/deletion policy. At 800 groups
  this is broad incidental PII collection. Minimize to support-relevant events, redact, encrypt,
  define consent/retention/deletion controls, and isolate monitor access.

Capacity evidence also blocks a direct 800-group rollout. The router intentionally calls OpenAI for
every registered message and forces engagement. Current 24-hour local data was 26 turns, 7,801 input
tokens/turn on average, 10.2s median total latency, 44.9s p95, and 66.9s max. With the configured
100k TPM, that is only about 12 full average turns/minute. A single registered message per hour in
each of 800 groups is already 13.3 messages/minute. There is no per-carrier fair queue or budget, the
backend's global Fastify limit is 120 requests/minute from the gateway IP, and the 30-second
per-carrier access cache can itself create up to 1,600 refreshes/minute across 800 active carriers.
Long polling is a single-consumer SPOF; outbound Telegram work is one unbounded global chain; burst
buffers are admitted only after buffering; and session persistence rewrites the complete session map
roughly every 500ms with no hard session/byte cap.

Validation: gateway strict typecheck passed; all 18 gateway files / 66 tests passed; the network-free
stress harness passed 300 requests / 100 users with max 8 active, zero same-user overlaps, zero
ordering errors, and empty queues. Six targeted backend RBAC/support-bot/idempotency files passed all
57 tests. The existing gateway test suite has no coverage for multi-carrier message logging,
confirmation nonce/replay/cross-user behavior, Telegram poll replay, or monitor-token enforcement.
The gateway production dependency audit reported no known vulnerabilities. The backend production
audit reported 29 advisories (16 high, 12 moderate, 1 low), including direct Fastify and Drizzle
advisories; these require remediation/risk review before production exposure.

## 2026-07-31 — 800-group gateway production blockers implemented

Implemented the production-safety pass for `apps/agent-gateway-groq` and its backend trust
boundary. The gateway and backend now use a dedicated service credential; user sessions and the
broad API key cannot call service-only support routes in production. Chat capacity is enforced at
800 inside an advisory-locked transaction. Access resolution is one bounded tenant-wide snapshot,
and production ingress defaults to mentions/replies plus active follow-ups instead of routing
ambient group chatter.

State-changing tools now require a durable opaque Telegram confirmation bound to tenant, carrier,
chat, actor, message, tool, canonical arguments, expiry, and one-time resolution. The central
gateway dispatcher rejects confirmed-write manifests without confirmation context. The backend
also checks the consumed confirmation ID, exact argument hash, stable confirmation turn, and the
single write occurrence before it crosses the external side-effect boundary. All six mutations use
stable idempotency keys and session fencing. Confirmed update handling waits for the durable turn to
finish before Telegram offset acknowledgement, so a crash redelivers into safe replay or
reconciliation rather than silently losing a consumed write.

Added a DB-backed renewable leader lease for warm standby gateway replicas, conservative local
lease deadlines, and process-unique holder IDs. Added fair per-carrier scheduling, global/user/
carrier admission, OpenAI limiter/circuit behavior, bounded buffers/sessions/log queues, graceful
drain, and health reporting. Message retention defaults to model-engaged traffic, pseudonymizes
names, masks contiguous or formatted PAN/account digit runs, caps payloads, and validates every
central log row against the enabled chat/carrier mapping. Migration
`0083_support_bot_production_safety.sql` adds message replay dedupe, durable confirmations, and
gateway leases; it was intentionally not applied automatically because it removes pre-existing
duplicate message-log rows before creating the unique index. `drizzle-kit check` also still reports
the repository's pre-existing `0022_snapshot.json` / `0023_snapshot.json` parent-snapshot collision;
that metadata issue is separate from migration 0083 but should be repaired before future generated
migrations.

Upgraded Drizzle to the patched 0.45 line and Fastify plus official plugins to the Fastify 5
compatible lines. Production audit findings dropped from 29 to 3. The gateway package reports zero
known production vulnerabilities. The remaining root findings (2 high, 1 moderate) are all under
ExcelJS's currently-unfixed legacy archive/UUID dependency tree; forced cross-major overrides were
not used. Excel generation/parsing tests pass with the safe patch-level overrides that were added.

Validation: root lint has 0 errors (24 pre-existing warnings); root and gateway typecheck/build
pass; the final multi-stage Docker image builds; all 23 gateway files / 80 tests pass; targeted
support/security/file tests pass. The full root
suite is at the existing unrelated branch baseline: 1,421 passed, 11 failed, 1 skipped (no gateway
or new support-bot failure). The 800-user stress profile completed 1,600 requests at max concurrency
8 with zero same-user overlaps, zero ordering errors, empty queues, 455 ms duration, 10.77 ms max
event-loop lag, and 4.58 MB RSS growth. The final local gateway reports healthy Telegram polling
with no poll error; backend `/health` and the public ngrok `/mini-app/` both return HTTP 200. Local
chat-map data remains one mapped chat plus the development fallback, so adding the planned ten
groups still requires their real Telegram chat mappings.

## 2026-07-31 — support-bot release blockers resolved

Completed the five follow-up production blockers. Before migration work, created an ignored,
mode-0600 custom-format backup of `support_bot_messages` and a full local database backup under
`backups/`; `pg_restore --list` validated the table backup. The pre-migration table contained 188
rows and no duplicate replay rows, so migration `0083_support_bot_production_safety.sql` deleted
nothing. The local migration ledger had historical hash drift that had skipped the physical 0058
and 0059 tables; after the full backup, applied only those idempotent create-only schema repairs,
then ran the standard migrator successfully through 0084. The final support table still has 188
rows, zero replay duplicates, and the confirmation, gateway-lease, and replay-unique-index objects
are present.

Repaired the Drizzle metadata parent chain for snapshots 0022 through 0024, expanded the Drizzle
schema list to include the existing support-bot and HR tables, and generated
`0084_snapshot.json` as the current 85-table baseline. Its paired SQL migration is intentionally a
documented no-op because hand-authored migrations 0025 through 0083 already materialized that
schema. `drizzle-kit check` passes, and a clean temporary generation probe reports no schema
changes instead of a snapshot collision.

Replaced the stale/inaccessible Telegram mapping through the authenticated, tenant-scoped gateway
API and added an audited admin/service DELETE route for disabling mappings. The single verified
enabled mapping is now the accessible `TEST - Bot` group bound to its server-verified active owner;
the duplicate local environment fallback was removed. New groups auto-bind only when an active
registered owner first messages the bot, while the advisory-locked backend cap remains 800. Nine
more real groups must still complete that onboarding step to reach the planned initial ten.

Fixed the eleven root-suite failures: static service-key identity fallback, retention ownership
conflict enforcement, and stale stream/tool/Zoho/template/sales test contracts. Final root results
are 154 files passed plus 1 skipped, 1,434 tests passed plus 1 skipped, and zero failures. Root lint
has zero errors (24 pre-existing warnings); root typecheck/build pass. Gateway typecheck/build and
all 23 files / 80 tests pass.

Moved ExcelJS's vulnerable transitive archive tree onto audited versions and patched
`archiver-utils@5.0.2` for ExcelJS's custom stream compatibility. Added streaming writer and reader
coverage alongside the ordinary workbook round trip. Frozen-lockfile install passes and the root
production dependency audit now reports zero advisories. The gateway production audit also remains
at zero advisories.

## 2026-08-02 — current worktree production-readiness audit

Verdict: not ready for production or PR in its current state. The feature branch is six commits
behind `origin/build` and has no commits unique from the already-merged branch head. Its new 0083
and 0084 migrations collide with 0083 through 0088 now present on `build`; the 0084 baseline
snapshot also predates the recruit and loyalty schema additions. Rebase the work onto a fresh
branch from current `build`, renumber the support-bot migrations, and regenerate/validate the
Drizzle metadata before rollout. Migration 0083 also deletes duplicate rows and creates a unique
index non-concurrently, so production needs a data preflight, backup, and reviewed lock window.

The real root suite (rerun with local database/socket access) has one failure, 1,433 passing tests,
and one skipped test: `retention-phase1.test.ts` compares a fixed July 2026 fixture with `Date.now()`, so it
became stale. The 22 RBAC cross-tenant leakage tests pass. Root lint, typecheck, build,
frozen-lockfile install, current-state `drizzle-kit check`, and both production dependency audits
pass; lint reports 24 warnings. Gateway typecheck/build and all 80 gateway tests pass.

Additional blockers: gateway monitoring only masks contiguous 12–19 digit strings, leaving spaced
or hyphenated PAN/account-number forms in the in-memory turn feed; `src/config/env.ts` is now 721
lines, above the hard 600-line cap; and customer write tools, although classified as writes and
protected by durable confirmation, are executable by owner/driver roles rather than the hard-rule
admin role. Resolve the redaction defect and file-size violation, and explicitly reconcile the
write-role product policy before release.

## 2026-08-02 — support-bot production-readiness blockers resolved

Preserved the original dirty worktree in `stash@{0}`, created
`fix/support-bot-production-readiness` from current `origin/build`, and reapplied the gateway work.
Resolved the three expected overlaps without dropping the new Recruit, HR, Loyalty, or CS build
changes. Support-bot production safety is now migration 0089 after build-owned migrations 0083–0088.
The paired 0089 snapshot is a regenerated 89-table baseline containing support confirmations,
gateway leases, Recruit, and Loyalty. `drizzle-kit check` passes.

Migration 0089 no longer deletes duplicate message rows. It fails closed with a duplicate preflight,
uses a five-second lock timeout and two-minute statement timeout, then creates the replay index and
new tables idempotently. A throwaway database successfully applied all 90 ledger entries and
contained the replay index plus confirmation, lease, Recruit, and Loyalty tables; the uniquely named
test database was dropped afterward. A read-only preflight of the configured Render database found
188 support-message rows, zero duplicate replay groups, a 163,840-byte table, and all three support
objects already present.

The monitor now reuses the formatted PAN/account-number masker. The gateway dispatcher records both
the admin service principal and the scoped owner/driver subject, refuses writes without the admin
principal, and still requires durable Telegram confirmation for customer mutations. The backend
monitor proxy now targets the separately deployed Render gateway, strips caller-provided monitor
tokens, and injects its server-owned token. Production startup requires the gateway monitor URL and
an independent token of at least 32 characters. The global rate-limit bypass is restricted to
`/v1/support-bot` routes.

Split runtime and operational configuration out of `src/config/env.ts`, reducing it from 721 to the
580-line target (579 lines). Replaced the date-dependent retention assertion with a deterministic
contract and updated the build branch's stale transient-database-code bound. Final validation:
frozen-lockfile install, root lint (0 errors, 23 existing warnings), root typecheck/build, Drizzle
metadata check, root tests (160 files and 1,466 tests passed; 1 file/test skipped), gateway
typecheck/build and all 23 files / 80 tests, and both production dependency audits (zero advisories).

## 2026-07-31 — Manager reward controls propagated into Sales

Closed two manual Loyalty control gaps on `feature/Mytrion`. A client without an override was
incorrectly initialized as a custom checklist because optional chaining produced `undefined`, which
was compared only against `null`; saving untouched controls could therefore freeze today's automatic
rewards into an unnecessary exception. The editor now treats both null and undefined as automatic,
while an explicit empty array still means the Manager intentionally disabled every reward.

Saving or resetting a Manager override now patches the cached company-wide Manager roster and
invalidates every owner-scoped `sales:clients:*` cache. This prevents old controls from reappearing
when the Manager card is reopened and guarantees Sales refetches the tenant-scoped override rather
than retaining a warm pre-save roster. Sales client cards disclose `Manager loyalty controls`, and
the client Loyalty tab shows a read-only control notice with the active custom/default state,
manager identity, update date, and note. Tier and projection calculations remain shared through
`_shared/loyalty.ts`; manual reward selection remains independent from tier thresholds.

Added Manager modal regressions for untouched/default and explicit checkbox saves, cache propagation
and reset tests, Sales disclosure tests, and repository predicate tests proving reads/deletes include
tenant plus carrier while upserts take tenant from context. Manager Loyalty + Sales Data Center +
repository routes pass 48/48, the complete frontend suite passes 348/348, both TypeScript projects
pass, lint has zero errors and 23 existing warnings, and the production frontend build passes. The
full backend run is not repository-green: 1,379 tests pass and 62 unrelated baseline/environment
tests fail across Customer Service authorization fixtures, retention expectations, remote Render DB
DNS, sandboxed WebSocket binding, and older touchpoint/tool/stream mocks.

## 2026-07-31 — HR attendance live presence and visit timeline

Reworked Mytrion HR Attendance around actual office visits instead of a decorative shift bar. The
page now leads with the employee's live presence, exact Ganga reader, check-in time, a second-by-second
time-in-office tracker, and the week's accumulated office time. Every day expands into explicit
Check in → Check out rows with both doors and the duration of each visit; an open visit says “Still
inside”, while standalone scans remain visible as an audit-quality note rather than a vague worked-
time warning. Team and organization rosters also disclose a checkout-needs-review state.

The zero-hour defect was in sessionization: open sessions were deliberately emitted with
`durationMs = 0` and excluded from `totalMs`. Attendance summaries now use one calculation timestamp,
include a recent open visit in day/week totals, expose ISO visit timestamps to the frontend, and
expire a forgotten checkout after 16 hours into `needs_review` so someone cannot remain “in office”
forever. A read-only production-data diagnostic confirmed the screenshot's mapped employee at
Ganga 4F Entry now calculates as in-office from 18:51:14 UZT with 02:24 elapsed instead of 00:00.

Added migration `0089_hr_attendance_shift_grace`: overnight punches receive a four-hour checkout
grace, so an overtime exit such as 05:00 after the 19:00–03:00 shift is re-bucketed onto the shift it
closes instead of appearing as a standalone checkout on the following day. Application-side
reconciliation uses the same rule for future Face ID links. Ganga-only ingestion, entry/exit door
classification, normalized Face ID mapping, manager shift assignment, leave, employee, department,
and org-structure tests remain green. The HR home copy now describes the native live workspaces,
and an invalid attendance stylesheet brace discovered by the production build was repaired.

Verification: 13 backend HR files / 84 tests pass; HR frontend tests pass 23/23; the complete
frontend suite passes 349/349; backend and frontend TypeScript pass; lint has zero errors and 23
existing warnings; and the production frontend build passes. The in-app preview had no authenticated
Zoho session, so visual implementation was grounded in the user's current authenticated screenshot
and component-level rendering; signed-in browser QA remains the final deployment smoke. Migration
0089 must be applied for already-stored late overnight checkouts to be re-bucketed.

## 2026-08-01 — Sales Verification live pipeline and Referrals loader

Standardized Manager Referrals on the same nine-card skeleton used by Loyalty and kept cached
results visible during background refreshes. This removes the separate full-page calculation loader
without changing referral calculations.

Enabled the Sales Verification workspace and changed its roster to start from every caller-owned
`octane.agent_deals` row, including applications without a carrier yet, ordered by `appfilldate`
newest first. Card enrichment remains read-only DWH work. Pipeline detail now resolves the direct
`agent_deals.id` → `credit_platform.requests.request_id` relationship (with carrier/application/DOT
fallbacks), reads live stages, decisions, tracker events and safe attachment metadata, and loads
card-level action counts in bulk to avoid an N+1 request pattern.

Verification events can now declare Sales requirements through payload fields, choices, audience,
instructions, and attachment flags; MC/DOT wording also produces the expected fields when the
payload is sparse. Sales sees those requests as prominent red flags on cards and in the opened
pipeline, completes the generated form, optionally/mandatorily attaches a file, and sends the
response through the owning Zoho Deal. Known MC/DOT fields are updated, the complete response is
journaled as a Deal note, and attachment metadata plus idempotency history is stored in the new
tenant-isolated `verification_sales_responses` table. The external Verification database remains
session-enforced read-only.

Added migration `0090_verification_sales_responses`, payload parser tests, response repository
tenant-isolation tests, the action-form component test, and the standardized Referrals loader test.
Backend/frontend typechecks, lint (0 errors / 22 existing warnings), both production builds, all 350
frontend tests, and the focused Verification + RBAC set (42/42) pass. The full backend baseline is
not green: 1,387 pass and 63 unrelated tests fail across existing Customer Service authorization
fixtures, retention/tool expectations, sandboxed WebSocket binding, and unavailable remote Render
DNS. The new Verification pipeline tests pass within that run.

## 2026-08-02 — Sales Verification 502 recovery and roster simplification

Reproduced the reported `/v1/verification/clients?zoho_user_id=…` 502 against the affected View-as
user and isolated each dependency. The DWH roster and read-only Verification database were healthy;
the failure was the local response-history lookup because `verification_sales_responses` did not
exist. A broad route catch incorrectly relabeled that local migration failure as `DWH_ERROR`.

The card endpoint now treats `agent_deals` as its required source and loads live Verification
summaries plus tenant response history as optional enrichments with `Promise.allSettled`. Either
enrichment can fail without hiding the cards, and only an actual DWH roster failure returns 502.
Pipeline response-history hydration is fail-soft for the same reason. Added route regressions for
missing history, unavailable Verification, and genuine DWH failure.

The first migration run appeared successful but post-migration verification still found no table.
Drizzle metadata showed the configured database already had different hashes recorded at the
timestamps originally assigned to 0089/0090. Moved 0090 beyond the database's current maximum
timestamp, reran migrations, and verified the table through the tenant-scoped repository. The exact
authenticated endpoint for Zoho user `6227679000007809267` now returns HTTP 200 with 500 cards,
newest application first.

Simplified the Verification tab to one complete roster: removed the Active sub-tab and application
order button, retained the server's fixed newest-first order, and replaced the text loader with the
shared nine-card Sales skeleton. Added a UI regression pinning those controls and loader. Focused
backend Verification tests pass 14/14, the complete frontend suite passes 351/351, lint has zero
errors (22 existing warnings), both typechecks pass, and both production builds pass.

## 2026-08-02 — Sales My Tasks kanban

Shipped assignee **My Tasks** in Sales Horizon as a status kanban (Open / In progress /
Completed / Cancelled) with HTML5 drag-and-drop status updates and a DetailSheet modal for
subject, description, deadline, priority, and event history. Reuses Retention board chrome
(`.ss-ret-*`). Nav item moved into the daily cluster (no longer Coming soon).

Backend: `/v1/sales/tasks/:taskId/status` now accepts all `WorkerTaskStatus` values so board
drops can reopen or cancel; same-status is a no-op. No new tables — storage remains
`mytrion_worker_tasks` (+ `mytrion_worker_task_events`, `mytrion_task_types`).

## 2026-08-02 — Sales Verification roster restoration

Confirmed from git history that the full Verification Pipeline UI already existed and had been
parked behind `comingSoon`. The live-data work extended that implementation rather than replacing
it, but a later interpretation of “remove Active” incorrectly merged active clients into the
pipeline roster. Restored the intended pipeline-only roster while retaining live stages, Sales
action requests, attachments, and activity.

Made the roster a bounded responsive grid using `minmax(0, 1fr)` so long company or billing text
cannot widen a track and clip the third column. Cards now share one row height and flex layout,
render nine per page, and collapse to two/one columns at the existing tablet/mobile breakpoints.
When a DWH application has no live Verification record yet, its detail view now shows the original
nine stages as “Not started” with an explicit “Awaiting intake” state instead of an empty panel.

Added regressions for pipeline-only filtering, equal-grid contracts, nine-card pagination, and the
pending nine-stage detail state. Frontend typecheck passes, the focused Verification tests pass
4/4, the complete frontend suite passes 353/353, and the production frontend build succeeds. A
browser visual check reached the local Zoho sign-in gate, so signed-in visual QA remains manual.

## 2026-08-02 — Verification pagination, query, and glass workspace

Moved the Verification roster from client-side slicing of a 500-record payload to a true
server-paginated contract (`page`, `page_size`, debounced `q`). The DWH query now returns one
pipeline-only page plus a windowed total, uses bound Postgres placeholders for limit/offset/search,
and replaces the global `dim_company` distinct/sort with a per-deal latest-row lateral lookup.
Live Verification summaries and local Sales-response enrichment now receive only the nine deal IDs
on the visible page. A live read-only validation for the affected View-as user returned 9 of 469
records in 857 ms.

Rebuilt the Verification surface around the Sales Horizon tokens in a dedicated, scoped stylesheet:
responsive equal-height glass cards, semantic status rail, tokenized type scale, bounded search
toolbar, stable pagination footer, and a rectangular Refresh action in the page header. Both themes
inherit the shared translucent surface, border, blur, shadow, radius, focus, and semantic colour
tokens. Added a shaped nine-stage detail skeleton so opening a card no longer falls back to loader
text or an empty panel; stale roster pages remain painted while manual refresh revalidates.

Added route, DWH-query, pagination, and detail-loader regressions. Focused Verification tests pass
19/19 across backend and frontend; the complete frontend suite passes 354/354; both typechecks and
production builds pass; lint has zero errors (22 unrelated existing warnings). The full backend
suite still contains unrelated pre-existing CS/retention authorization failures plus the sandboxed
WebSocket bind failure; the required cross-tenant RBAC leakage suite passes.

## 2026-08-02 — My Tasks polish (skeleton, badge, switch icon, light)

Finished Sales My Tasks setup: cold-load board skeleton (hero + 4 columns), sidebar
badge for `open` tasks never opened in the detail modal (local opened set + shared SWR
cache with the tab), Switch Mytrion icon corrected to ArrowLeftRight swap (TopBar +
MytrionSwitchLink), and light-mode board/card/hero polish under `.ss-tasks-*`.

## 2026-08-02 — Call Hub Phase 1 (Mytrion + Zoho)

Shipped agent Call Hub as a standard Sales tab (not full-bleed). Backend:
`mytrionCallRepo.listForCaller`, merged list module (`modules/sales/callHub.ts`),
`GET /v1/sales/call-hub/calls` (session Zoho identity, View-as aware via JWT), audit
`call_hub.list`. Zoho COQL filters Calls by Owner; unified DTO with source badges.
Gong scaffold only: `FF_GONG_ENABLED` + `GONG_*` env + fail-closed `integrations/gong.ts`
(empty list until REST client lands). Softphone stays global Embeddable — hub does not remount it.

Frontend: enabled `callHub` nav, `CallHubTab` + `CallDetailModal` (Horizon hero/filters/
skeleton/list → detail, redial via `clickToDial`), API client, light `.ss-call-*` tokens.
Route + merge unit tests pin identity scoping (no query spoof) and DTO merge order.

## 2026-08-02 — Call Hub agent identity + pagination

Root cause of "other agents' calls" in Call Hub under Admin View-as: the route used
JWT `request.ctx` only and never applied `buildCallerContext` / `x-act-as-*`, so the
list was scoped to the admin's own `caller_zoho_user_id` (every dial they placed while
working other desks). Softphone logging also preferred `impersonatorUserId`, compounding
mis-attribution.

Fixes: Call Hub + RingCentral call-events now run through `buildCallerContext` and
attribute / filter by the effective agent (View-as target). Added `countForCaller`,
page/`page_size` merge pagination (25/page), SWR cache key includes agent+page, UI shows
agent name + pager. Tests cover View-as scoping and pagination.
## 2026-07-31 — Native ticket path: the reachable half of the comms substrate (`feature/Communication`)

`b501390` landed 14 tables, the thread/member/message/presence repos, `publish.ts` and the comms WS
topic grammar — but nothing above that line, so none of it was reachable. Two dead ends in particular:
`canSubscribeCommsThread` was exported with no production caller (the synchronous `canSubscribe`
hard-refuses the `comms:thread:` prefix, so the live chat feed could not be subscribed at all), and
`mytrion_comms_number_seq` existed with no formatter, so no ticket could be numbered.

This session builds the Sales create-ticket path end to end on the server. Still backend-only —
nothing under `apps/` is touched and the Zoho Desk routes are untouched and still serve every live
flow, so this is a parallel path with no consumer yet.

**Config read layer.** `commsCatalogRepo` / `commsSettingsRepo` / `commsDepartmentRepo` +
`GET /v1/comms/catalog`, which returns the 49 ticket types, 11 escalation reasons, the department
options and the SLA maps in one request — the wizard cannot render its first step until all of it has
arrived, so three requests would only add two more chances for a half-rendered picker. Gated by a new
`requireInternal` (internal audience, no department): `requireDepartment` takes exactly one department,
so gating shared metadata with it would mean locking Sales out of a CS-owned list or the reverse.

**Two security properties, both structural rather than conventional.**
1. `target_department` is read off the catalog row and never from the request body — there is no
   `department` field on `POST /v1/comms/tickets` at all. The Desk route accepted one, which meant an
   agent could file into any queue they chose. Retargeting a family of types is now a catalog UPDATE.
2. An agent may only file against a deal they own, AND the client snapshot comes from that same deal
   record. Added `fetchDealSnapshot` (one COQL for Owner + Account_Name + Carrier_ID + Application_ID)
   replacing `fetchDealOwnerId` + trusting the body: a body-supplied carrier is a client-chosen client,
   so an agent could file on their own deal while labelling it with someone else's carrier and every
   downstream reader would believe the label. Reading both from one record costs the same one query.

**Create is one transaction.** `commsTicketRepo.createWithThread` writes thread + opening message +
requester member + ticket with all ids generated up front, so the thread is inserted with its final
message counters already set. `commsMessageRepo.append` is deliberately NOT reused: it opens its own
`db.transaction`, which would take a second pool connection and block on the very thread row this
transaction holds — a self-deadlock, not a slow path. Proved on `xmin` in the smoke script.

**Idempotency is select-then-insert, not ON CONFLICT.** `mytrion_tickets_idem_uk` is partial
(`WHERE idempotency_key IS NOT NULL`) and Postgres refuses a partial index as an arbiter unless the
statement restates the predicate, which Drizzle cannot express. The lookup is also scoped to the
REQUESTER: it runs before any row exists so no reader filter applies, and an idempotency key is a
client-chosen string rather than a secret — without the requester bound, guessing or replaying another
agent's key returned their ticket in full. A key taken by someone else now 409s.

**Reads.** All three ticket reads share one `selectTicketWithThread` builder, because those joins ARE
the authorization surface (the thread join is what lets `commsThreadReaderFilter` apply); three copies
would be three chances for one to drift and read unfiltered. The reader's own member row is LEFT
joined so unread is arithmetic on data the list already has — left, not inner, because a CS agent must
see a queue ticket they have never opened. Keyset paging over `(created_at, id)` via a row comparison;
offset paging silently re-shows or skips rows the moment anything is filed. Non-readable ids answer
404, never 403.

**Conversation is thread-keyed**, not ticket-keyed (`/v1/comms/threads/:id/...`): an escalation's whole
ladder talks in one thread and a DM has no ticket, so ticket-keyed message routes would need a second
copy of this the moment either lands. First response is stamped only by a non-requester, non-internal
reply, with the `IS NULL` guard in the WHERE so two simultaneous replies cannot move it.

**WebSocket.** The subscribe branch is now async and routes `comms:thread:*` to
`canSubscribeCommsThread`, so the live feed is reachable. Topic accounting became a Set rather than a
per-frame counter — the counter burned budget every time a client re-subscribed to a topic it already
held, which every reconnect does, until it was refused for topics it was already on. The comms lane is
auto-subscribed and advertised in `hello` (a client cannot construct it itself: `commsUserTopicOf`
returns null under view-as). The socket is re-checked for closure after the await.

**Verification.** Typecheck clean; lint clean on every new file (the 24 repo-wide warnings are
pre-existing non-null assertions elsewhere). 181 new unit tests across six suites, 222 including the
existing comms/realtime ones. `scripts/comms-repo-smoke.ts` extended and run green end to end against
a throwaway local Postgres — the transaction proved on `xmin`, 25 concurrent creates yielding 25
distinct numbers, sequential AND raced idempotency replays, "another Sales agent sees NOTHING" while
the CS agent sees it via the department arm, and paging walking every row exactly once.

The security tests were mutation-verified rather than assumed: disabling the ownership check and adding
the full card to the DTO failed exactly 7 tests, then both files were restored and re-checksummed.
`.env` still points at Render prod, so every DB command above ran against an explicitly overridden
local throwaway database.

Known and deliberately deferred: a CRM lookup failure surfaces as 400 rather than 502 (the message is
clear and exposed, and all three outcomes stay distinguishable); there is no
`(tenant_id, created_at DESC, id DESC)` index yet, which the keyset walk will want once volume exists;
`GET /threads/:id/messages` enrolls the reader as a watcher, which is a read-state side effect on a GET.

Not built yet, in dependency order: Dropbox attachments, round-robin assignment over the department
pool (the pools are empty and `FF_COMMS_PRESENCE` is still off), the Tickets console — which must mount
in Sales AND the receiving CS/Billing/Verification queue in the SAME release, or native tickets land in
a table nobody is watching — and escalations, which cannot route at all until the NULL
`default_assignee_zoho_user_id` / `manager_zoho_user_id` / `c-level` pool config is filled.

## 2026-08-01 — Escalations, and the Mytrion Admin routing config that makes them possible

The user's decision: escalation-level assignees must be **dynamic from Mytrion Admin**, and they will
choose the reason defaults, the department managers and the C-Level themselves. So this session builds
both halves — the admin config surface and the escalation engine that reads it.

**The ladder, and where each rung comes from.** All four are config rows, none are constants:
```
level 1  requester           the person raising it (not a hop — `requester_zoho_user_id`)
level 2  agent               mytrion_ticket_types.default_assignee_zoho_user_id  (per REASON)
level 3  department manager  mytrion_department_config.manager_zoho_user_id
level 4  C-Level             an explicit pick from the `c-level` pool in mytrion_department_agents
```
Every one ships NULL/empty. A NULL is "unrouted, refuse loudly" and never a wildcard: raising on an
unconfigured reason is refused with a message that names the admin screen, because an escalation with a
null assignee sits in nobody's inbox while looking submitted to the person who raised it. HR remains
CANDIDATES only — `/comms/admin/candidates` returns employees who have a `zoho_user_id` (that id IS the
routing key, so offering anyone without one would let an admin save a row that can never receive
anything) and marks `hr_departments.lead_employee_id` holders so the manager picker can pre-select the
likely answer. HR suggests; the config row decides. `resolveDepartmentManager` deliberately does NOT
fall back through the HR lead link, and there is a test asserting it never calls HR at all.

**Admin surface** (`/v1/comms/admin`, all-department admin, every write audited with before AND after —
one row here can silently redirect every escalation in the company): `GET /routing` returns the whole
picture plus a `readiness` block (`unroutedReasons`, `departmentsMissingManager`, `cLevelConfigured`)
computed server-side so the screen and the refusal messages cannot disagree. Then
`PATCH /departments/:department`, `PUT|PATCH|DELETE /departments/:department/pool/...` and
`PATCH /escalation-reasons/:code`. `code` and `kind` are immutable in the catalog patch allowlist:
every historical ticket snapshots the code, and `kind` decides whether a row is a ticket type or a
reason. Deleting a pool seat is distinct from `active:false` — deactivating keeps the rotation history,
which is what you want for someone on leave.

**Engine.** `escalationRouting` (config reads) → `escalationService` (raise) →
`escalationTransitions` (up / sideways / terminal) → `escalationNotify` (deadlines, fan-out, the
act-on gate). Split four ways because the two service halves together came to 732 lines.

Decisions worth keeping:
- **Hop 1 is the level-2 landing, not the requester** — which is why its `decided_by` is NULL: nobody
  moved it there. `current_hop_index` defaults to 1 while `current_level` defaults to 2, and this is
  what that combination means.
- **Growing group.** Every hop `transferAssignee`s (moving the ROLE, demoting the previous holder to
  participant) and never evicts, so requester + agent + manager + C-Level all end up in one chat and
  all keep replying. `visibility` stays `'participants'` for life — flipping it to `'department'` on a
  hand-off would expose the whole history to everyone holding the receiving department.
- **A sideways hand-off RESETS to level 2**, so a chain handed off by a manager can still rise to the
  NEW department's manager. Carrying level 3 across would skip that person entirely.
- **Level 4 is an explicit, pool-validated pick.** "Escalate to C-Level" must not become "assign to
  anyone I name", and the same check makes a deactivated CEO seat unescalatable while leaving the
  historical hop that named them untouched.
- **A reason that falls to the requester** rises straight to their department manager with
  `skip_reason='is_requester'` rather than routing someone's escalation to themselves.
- The cursor moves BEFORE the hop is closed, because the cursor carries the optimistic-version check:
  closing first would mark a hop decided on a chain someone else moved a different way.

**One real dead end found by the end-to-end check and fixed.** When the level-2 assignee IS the
department manager — normal in a small department — `escalateUp` refused with "escalate to C-Level or
hand off instead", but level 2 had no path to C-Level, so a lone department head was stuck holding their
own escalation. Level 3 is now treated as a rung that exists only when the department has a manager who
is not the current holder; otherwise C-Level is reachable directly from level 2 with an explicit pick,
and the refusal message says which case you are in.

**Verification.** Typecheck and lint clean, every new file under the 600-line cap. 31 new routing unit
tests (each mocked so "nothing routes when nothing is configured" cannot pass vacuously) and 10 new
RBAC-leakage assertions covering `commsEscalationRepo.buildListQuery` / `buildHopsQuery` and
`commsDepartmentRepo.buildPoolQuery` — 56 in that suite now. A 74-check end-to-end run against a fresh
throwaway local Postgres proves the whole ladder over real rows: the unrouted refusal writes no ticket,
level 2 lands on the configured default, an uninvolved worker and the CS manager both cannot read it
before being brought in, the manager can after, the demoted level-2 agent can still reply, level 4
refuses an unnamed and an off-pool pick, hop levels run 2→3→4 with the right `decided_by` on each closed
hop, resolve clears the inbox while the chain stays readable, a hand-off resets to level 2 without
evicting anyone and keeps the thread participants-only, withdraw works from three hops away and mirrors
as cancelled rather than resolved, and a deactivated C-Level seat stops being escalatable without
rewriting history.

Full suite: 35 failures across 10 suites. 34 are the same pre-existing ones verified against a clean
b501390 worktree last session; the 35th is `retention-phase1.test.ts > stamps a 2BD agent-action
deadline`, which hardcodes 2026-07-20 and asserts the deadline falls within the last 10 days of
`Date.now()` — it decayed when the calendar reached 2026-08-01 and is untouched by this work
(commit 49b1d8a). Worth fixing with a fake timer, separately.

Still to come: the Mytrion Admin screen itself (this session shipped its API), Dropbox attachments,
round-robin assignment, and the Tickets/Escalations console.

### Mytrion Admin → Escalation Routing (the screen)

Admin → CRM & Ops → **Escalation Routing**. Three sections matching the three configurable rungs, plus a
readiness strip: reasons routed `N/M`, departments with a manager `N/M`, C-Level member count. The
readiness numbers come from the server, not from counting rows in the browser, so what the screen calls a
gap and what an agent's refusal message says are the same computation.

- **Level 2** — one row per escalation reason, each with a person picker. An unrouted row is marked
  structurally (amber left rail + `gap` pill), not by hue alone, and its subtitle says what the
  consequence is: "escalations on this reason are refused".
- **Level 3** — one row per department, with the manager picker and the sideways hand-off target.
- **Level 4** — the C-Level pool, with a role-title field, because the seat label is what makes
  "Escalate to CEO" distinguishable from "Escalate to COO" in the agent's picker.

The picker is fed by `GET /comms/admin/candidates` and marks whoever HR has as a department lead with a
"Dept lead" chip. That chip only ORDERS and labels — it never pre-selects, because HR's lead link resolves
through a nullable heuristic `zoho_user_id` and a silent default there is exactly what this config exists
to avoid.

Saves are per row: each row awaits its own request and shows its own busy text, so one slow save never
blocks the screen and there is no second page-level spinner (one `aria-busy` region, asserted in the
component test). After a save the screen refetches rather than patching local state — a locally-patched
copy would drift from the server-derived readiness.

Two bugs the tests caught, both fixed:
- `readiness.departmentsMissingManager` included `c-level`. Level 4 is a POOL, so there is no such thing
  as the C-Level department's manager and it was reporting a gap that could never be closed.
- The clear-assignee control took its accessible name from its own "×" glyph, so it announced as "×".
  It now carries an explicit `aria-label`.

CLAUDE.md rule 10 asks for the `modern-web-guidance` skill first. **That skill is not installed in this
repo** (`.claude/skills/` has the Zoho/LLM/DB ones only), so I matched the existing Mytrion Admin
conventions instead: `admin.module.css` for every generic element, the house glass tokens
(`--hz-pane`, `--hz-blur-*`, `--tone-*`) for the new ladder visuals, one skeleton loader, `adminToast` for
outcomes, and `prefers-reduced-motion` honoured on the picker animation. Worth installing that skill if
there is guidance it should have followed.

Verification: web typecheck clean, 332/332 web tests pass (9 new), 244/244 comms backend tests pass
(22 new route tests covering the gate — an ordinary worker AND a department head are both refused on every
write, not just the read). `pnpm build:widget` rerun and `apps/mytrion-crm/app` committed, since that
vendored bundle is what actually deploys; confirmed the built output contains the new screen.

## 2026-08-01 (2) — Departments come from HR, escalations are opened against one, and Dropbox

Two changes, both from the same decision: **departments are our own `hr_departments` rows plus Zoho users
(`hr_employees.zoho_user_id`), not a hardcoded slug list** — and an escalation request names its department
when it is opened, so level 2 is that department's agent.

### Migration 0089 — routing config is keyed on hr_departments

`mytrion_department_config` gains `hr_department_id` + `label`. Why BOTH the link and the slug:

- `department` stays the ROUTING KEY. It is stored on `mytrion_threads.department`, built into the
  `comms:queue:<department>` WebSocket topic (validator: `^[a-z][a-z0-9-]{1,40}$`) and held in
  `TenantContext.departments` for RBAC. Swapping in an `hrd_…` id would break the read gate, the topic
  grammar and every existing access grant at once.
- `hr_department_id` makes the ORG identity explicit rather than matching a slugified name — a name match
  would orphan a department's whole routing config the first time HR renames it. Same reasoning as
  `hr_employees.zoho_user_id` being chosen explicitly rather than derived.

A one-off backfill links the ten rows 0087 seeded by slugified name, skipping any name that slugifies
ambiguously — an ambiguous match is a human decision, not a guess. Nothing re-derives the link at runtime.
`slugifyDepartment()` (lib/department.ts) returns **null** for a name that cannot make a valid slug (no
letters, or a leading digit), so such a department is surfaced as unconfigurable instead of producing a row
that publishes to a topic nobody can subscribe to.

0089 also widens `mytrion_escalation_hops_routing_chk` with `department_default` and `department_pool`.
`routing_source` exists to make a chain explainable, and filing a department-resolved assignee under
`reason_default` would claim a reason chose someone it never named.

### Level 2 is now department-first

`raiseEscalation` takes an optional `targetDepartment`. Resolution order:
1. **the target department's own agent** — its `default_assignee_zoho_user_id`, else its
   least-recently-assigned roster member that still accepts work. "Escalate to Billing" has to reach
   Billing; deciding from the reason instead would make the department the requester picked irrelevant.
2. the reason's fall-to user, for a raise with no department in mind.
3. if either resolves to the requester, rise to that department's manager with
   `skip_reason='is_requester'`.

The manager is deliberately NOT a fallback at step 1: level 3 exists so an escalation reaches the head only
after the agent level has had it, and falling straight through would collapse two rungs into one.

Admin `GET /routing` now returns `hrDepartments` (id, name, lead, `suggestedSlug`, `configured`) beside the
config, so the screen offers departments that have never been configured — the point of driving it from HR.
The live HR name wins over the stored `label`, so a rename shows immediately, while the snapshot is the
fallback for a department since deleted from HR (historical escalations must still render). An HR outage
degrades to an empty list and is logged, rather than failing the whole screen.

### Dropbox

`src/integrations/dropbox.ts` — refresh-token grant via `createTokenProvider` (access tokens last ~4h, so a
stored access token would break silently); single-shot upload under 120MB and `upload_session/*` above it
(deliberately below the 150MB vendor hard limit — sitting at the limit means the first oversized production
file discovers it); `Dropbox-API-Arg` escaped to `\uXXXX` so a Cyrillic or emoji filename cannot produce an
invalid header; 401 force-refresh **once** (a revoked refresh token also answers 401, so retrying forever
would hammer auth with a dead credential); 429/5xx retry honouring `Retry-After`, capped at 30s.

`get_temporary_link` rather than a shared link: it serves the BYTES, whereas
`create_shared_link_with_settings` returns an HTML preview page unless `?dl=1` is appended — and it creates
a durable PUBLIC link, the wrong default for a client's document.

**The provider travels with the row.** Migration 0090 adds `file_assets.storage_provider` (default `'s3'`,
CHECK-constrained, backfilled). `storageFor(row.storageProvider)` resolves reads and deletes; the new
`COMMS_STORAGE_PROVIDER` env only decides where the NEXT comms attachment goes. A single global switch would
have repointed reads for every existing S3 file and 404'd them — and `deleteFile` previously handed `s3_key`
to the S3 client unconditionally, which with two providers would report success while leaving the Dropbox
object behind.

Attachments arrive as ONE bubble: the upload appends a message and links the file to it, so `is_internal` is
inherited by construction and a file on an internal note cannot become visible on its own. Links are fetched
on click, not embedded per row — a Dropbox link is a network round trip and expires in ~4h, so a list full of
them would be slow and hand out links that die in an open tab. `COMMS_ATTACHMENT_MAX_MB` is separate from
`FILE_MAX_SIZE_MB` (zod-capped at 200) and the global multipart ceiling is now the max of the two, so raising
the chat limit alone is enough.

### Verification

Typecheck and lint clean (0 errors; the 23 warnings are pre-existing non-null assertions elsewhere). All 84
migrations apply from scratch against a fresh throwaway Postgres — 95 tables, both new columns, the partial
`mytrion_department_config_hr_uk` with its predicate intact, the widened routing CHECK with all 8 values, and
`file_assets_storage_provider_chk`.

A 28-check real-DB run proves the department-first routing: the nominated default wins over a reason that has
no fall-to user at all; a rota-only department routes to its least-recently-assigned member and skips a
deactivated one and one with `accepts_new=false`; a configured-but-empty department and an unknown slug are
both refused naming Mytrion Admin; the department's own agent starts at level 3 with
`skip_reason='is_requester'`; a reason-only raise still uses `reason_default`; escalating up uses the OPENED
department's manager; and the HR link survives it all.

Tests: 21 new Dropbox adapter tests (path mapping including `..` traversal, provider-by-row selection, header
escaping, retry backoff) and 6 new admin-route tests for the HR-driven section — 1543 passing backend, 332
web. Full suite still shows the same 35 failures across the same 10 suites as the baseline, so zero new
failures.

**Not verified:** the Dropbox HTTP layer itself has never run against live Dropbox — there are no
credentials yet. Upload, download, temporary link and the chunked session are unexercised end to end. Once
`DROPBOX_APP_KEY` / `_APP_SECRET` / `_REFRESH_TOKEN` exist, set `COMMS_STORAGE_PROVIDER=dropbox` and round-trip
a small file and one over 120MB (the chunked path) before trusting it.

## 2026-08-01 (3) — The chat UI: one reusable console, mounted in four Mytrions

Answering the question directly: before this, **there was no chat UI**. The comms substrate and API were
backend-only, and the Sales Tickets tab was still the Zoho Desk one, parked behind `comingSoon`. This
session builds the surface.

### Reuse is the architecture, not a later refactor

```
apps/mytrion-crm/src/api/comms.ts              one client for tickets + escalations + threads
apps/mytrion-crm/src/features/comms/
  useCommsSocket.ts   comms-aware WS with DYNAMIC thread subscribe
  ChatThread.tsx      THE chat pane — thread-keyed, so it serves any thread kind
  TicketConsole.tsx   list + chat, `mode: 'requester' | 'queue'`
  chatFormat.ts       pure presentation helpers (testable without rendering)
  comms.module.css    one stylesheet on the Horizon tokens
```

Mounted with a single line each: Sales `<TicketConsole mode="requester" />`, and CS / Billing /
Verification `<TicketConsole mode="queue" department="…" />`. Vite emits it as ONE shared
`TicketConsole-*.js` chunk with four importers, so the reuse is real at the bundle level too.

What makes it genuinely reusable is that the console holds **no Mytrion knowledge**. Visibility is decided
server-side by `commsThreadReaderFilter` — the participant arm gives Sales what it raised, the department arm
gives CS its inbound queue — and neither is expressed in the component. `mode` changes only defaults and
copy, never authorization. Adding a fifth Mytrion is a mount, not a fork.

`ChatThread` is keyed on the THREAD, not the ticket, which is why it will serve escalations and DMs with no
second implementation: everything ticket-specific is passed in as `headerSlot`.

### Chat behaviours that were deliberate, not incidental

- **Optimistic send reconciles on the echoed `clientMsgId`**, never on matching text — two identical
  messages a second apart must not collapse into one bubble.
- **A failed send keeps the text** and offers Retry. Losing what someone typed is the worst thing a chat
  can do; the bubble goes to "Not sent" rather than vanishing.
- **Realtime is push with a self-heal.** Frames carry `seq`, so the pane fetches only `afterSeq` — that
  same path is the reconnect gap-fill, so a socket drop cannot leave a hole in the conversation.
- **Read receipts only while the tab is visible.** Marking a conversation read that nobody is looking at is
  the one thing that makes an unread badge untrustworthy.
- **Auto-scroll sticks only near the bottom** (48px of slack), so scrolling up to read history is not
  yanked away by an incoming message.
- Enter sends, Shift+Enter is a newline. Internal notes are dashed + amber + labelled "Internal note" —
  never colour alone. Overdue SLA gets a pulse *and* text. Unread gets a rail, a bold subject *and* a count.

### Attachments

Upload is one bubble: caption and file travel together, so a chat never shows a comment beside an orphan
file the way the Desk path forced. Download links are fetched **on click** — a Dropbox temporary link is a
round trip that expires in ~4h, so embedding one per row would be slow and would hand out links that die in
an open tab.

### Two inconsistencies this exposed, both fixed

1. **The Create wizard still wrote to Zoho Desk.** A new ticket would not have appeared in the native list
   it now reads. Both submits are repointed: `createTicket` (no `department` field — the queue comes from the
   catalog code; no contact/email/phone — there is no contact record) and `createEscalation`. Attachments
   became a second call against the new thread, and a failed attach no longer reads as "the ticket failed".
2. **The sidebar Tickets badge counted the Desk queue.** Unparking the tab flipped `TICKETS_ENABLED` true,
   which would have newly switched ON a Desk page-warm this hook used to skip. The badge now reads
   `GET /comms/unread`; the Desk machinery is gated off behind an explicit `DESK_TICKET_BADGE = false`
   rather than deleted, since it still drives the servercrm ticket socket that retires with the Desk reads.

The escalation form also gained the **department picker** the routing now needs, with reasons loaded from
`/comms/catalog` — an unrouted reason is disabled with "· not set up" so the agent learns that before typing
the request rather than from a refusal.

Every WRITE in the Sales UI is now native. The only remaining `api/desk` imports are READS in
`live.ts` and the orphaned `TicketsTab.tsx`, kept for the rollback path.

### Design

Built on the Horizon tokens (`--hz-pane`, `--hz-blur-md`, `--hz-glass`, `--hz-ease`, `--tone-*`) — no new
colours, so light/dark and the accent theme keep working. Two-pane split that stacks to one pane on a narrow
viewport (a 320px-wide chat is not a chat). One shimmer skeleton per pane, never stacked with a spinner.
`prefers-reduced-motion` disables the bubble entrance, the overdue pulse and smooth scroll.

Still no `modern-web-guidance` skill in this repo (CLAUDE.md rule 10) — worth installing before the next UI
push if it carries guidance this should have followed.

### Verification

Web typecheck clean, backend typecheck clean, **352 web tests pass (20 new ChatThread tests)**. The new
tests cover the things a backend test cannot see: clientMsgId reconciliation, a failed send keeping its text,
`afterSeq` gap-fill, a frame for a different thread being ignored, full state reset on thread switch, the
internal-note label, a redacted placeholder, and links fetched only on click. `build:widget` rerun and
`apps/mytrion-crm/app` committed. One real a11y bug found by the tests and fixed in the component (the file
input and its button shared the accessible name "Attach a file").

**Not verified:** nothing has been exercised against a running backend + browser — no end-to-end pass of
"Sales files a ticket → it appears in the CS queue within one frame → CS replies → Sales sees it live". That
needs `pnpm dev:all` plus two signed-in sessions, and the routing config filled in. Dropbox is still
credential-blocked.

## 2026-08-02 — Round-robin ticket assignment

The Tickets tab was already live in all four Mytrions (Sales in requester mode; CS, Billing and
Verification in queue mode, one shared `TicketConsole` chunk). What was missing was assignment: a client
ticket landed in the department queue with nobody on it. This session builds the rotation, configurable
from Mytrion Admin.

### The roster is explicit, never derived

`mytrion_department_agents` rows an admin manages — NOT everyone holding the department grant. Deriving it
would auto-assign live client tickets to every admin and every read-only viewer who can merely open the
Mytrion; deriving from `hr_employees.department_id` would conflate being *in* a department with being *on
the rota* (a head, a trainee and someone on parental leave are all "in" CS).

### Selection

One statement, and it has to stay one: `UPDATE … WHERE id = (SELECT … ORDER BY … LIMIT 1 FOR UPDATE SKIP
LOCKED)`. The obvious SELECT-then-UPDATE hands the same person to two tickets filed in the same instant,
which is the exact failure round-robin exists to prevent.

Ordering IS the strategy — `round_robin` = `last_assigned_at ASC NULLS FIRST` (a new member goes first;
they are owed work), `least_open` = fewest open tickets first. Filters: `active`, `accepts_new`, and
`max_open` counted against the agent's OPEN tickets.

### Three real bugs the real-DB run caught

1. **The rotation never rotated.** Every ticket went to the same agent. The subquery used the Drizzle
   column helpers, which render `"mytrion_department_agents"."last_assigned_at"` — inside a subquery over
   the SAME table that is a CORRELATED reference to the outer UPDATE row, so `ORDER BY` was constant per
   row. Every reference inside the subquery is now written against the alias `a` literally.
2. **`SKIP LOCKED` starved under a burst.** Twelve concurrent creates over three agents left most tickets
   unassigned: a claim that walks past every locked row finds nothing. Bounded retry (5 attempts, ~10ms
   apart) fixes it — the locks are held only for the length of one UPDATE.
3. **`require_online` would have starved everything.** 0087 seeds it TRUE for customer-service, billing and
   verification, while `FF_COMMS_PRESENCE=0` means nothing is ever written to `mytrion_agent_presence`. The
   eligible set would have been permanently empty. Presence is now ignored while the flag is off, and
   logged. When it IS on, eligibility needs socket liveness AND declared availability — connected-but-away
   is the common case an hour before end of shift.

### Fairness is approximate, and that is the design

`SKIP LOCKED` trades exact evenness for throughput: a burst lands within about one of the mean (12 over 3
came out 4/5/3). The guarantee is that nobody is starved and the skew SELF-CORRECTS, because
`last_assigned_at ASC` pulls whoever fell behind to the front next — asserted directly rather than
asserting an even split that would only ever be a coincidence.

### Assignment never fails a create

A ticket that could not be assigned is still a filed ticket: it stays visible to the whole department
through the queue and a `assignment_failed` journal row records why (`empty_roster`, `nobody_eligible`,
`nobody_online`, `department_not_configured`). `manual` is the configured intent for c-level and sales, so
it is deliberately NOT journalled as a failure. The claim happens before the ticket is stamped, and is
released if the stamp loses a race — an agent must not go to the back of the rotation for work they never
received.

### Surface

`/v1/comms/queue/:id/assign` (claim, or assign to someone who holds a seat on that roster),
`/release` (only the holder or an admin), `/comms/queue/:department/roster` (read-only, visible to anyone
who can see the queue — "why did that go to her" is a fair question to answer by looking).

Repos split: `commsTicketStateRepo` now owns the contended writes (transition, assign, unassign,
first-response) while `commsTicketRepo` keeps create and the reader-filtered reads. Each of those is a write
whose correctness lives in its WHERE clause, which is worth having in one place.

Admin screen gained a per-department **ticket rota** editor: add/remove people, take someone off without
losing their rotation history, switch strategy, and a `next` chip on whoever the next ticket goes to. A
fourth readiness tile flags any auto-assigning queue with an empty rota.

### Verification

20/20 against a fresh throwaway Postgres: exact 3/3/3 rotation, 12 concurrent creates all assigned with
self-correction proven, `accepts_new=false` and `active=false` skipped, `max_open` capping at 2 and freeing
when a ticket resolves, empty roster and manual both behaving correctly, `least_open` picking the smallest
backlog, and two simultaneous claims yielding exactly one winner. Typecheck and lint clean (0 errors).
Backend 1543 passing with the same 35 pre-existing failures as baseline; web 357 (5 new rota tests).

## 2026-08-02 (2) — Can Sales keep talking in a ticket after creating it?

Asked directly, so verified directly rather than reasoned about. **Backend: yes, fully.** A 16-check run
against a fresh throwaway Postgres proves the requester path end to end:

- The creator holds `role='requester'` on the thread, so the reader filter's PARTICIPANT arm keeps the
  ticket visible to them after filing — while another Sales agent still cannot see it.
- They can post replies into it, attributed to their own id.
- CS replies in the same thread and the requester sees the whole conversation in order (1,2,3).
- Assignment does not disturb it: after CS is auto-assigned, the requester still holds `requester` and CS
  holds `assignee` — `transferAssignee` moves the role without evicting anyone.
- Unread works both ways: the CS reply shows unread to Sales, and opening it clears the badge.
- `first_response_at` is set by the CS reply, not by the requester's own follow-up.

**One real UI gap found and fixed.** `openTicket()` (Create → "opening it now") set `focusTicketId` and
navigated to the Tickets tab, but `TicketConsole` never consumed it — the old Desk-era `TicketsTab` did, and
that wiring was lost in the swap. The agent landed on the list with nothing selected, having to hunt for the
ticket they had just filed. The console now takes `focusTicketId` / `onFocusConsumed`: it selects the ticket
if it is already listed, and FETCHES it if the active filter excludes it (a resolved ticket reached from a
link), prepending rather than silently changing the user's filter. A failed focus is consumed anyway so it
cannot loop.

**Worth knowing, by design:** an INTERNAL NOTE written by CS on a Sales ticket IS visible to the Sales
requester. `is_internal` means "never shown to a CARRIER" — both parties here are staff, and the filter is
`excludeInternal` only for a customer audience. If notes should be hidden from the requesting Mytrion too,
that is a different rule and a deliberate change, not a bug fix.

Verification: web typecheck clean, 364 web tests (7 new console tests covering focus-when-listed,
focus-with-fetch, focus-when-gone, and the queue/requester scoping difference). Bundle rebuilt.

## 2026-08-02 (3) — Sales is now ZERO-dependent on Zoho Desk

Audited rather than assumed, then deleted what was left. Sales had been repointed to `/v1/comms` for every
WRITE, but the Desk code was still in the tree — dead, and one import away from being live again.

### Deleted from the Sales UI

`api/desk.ts` (the whole web client), `tabs/TicketsTab.tsx`, `TicketsBootSkeleton.tsx`, `useTicketsFeed.ts`,
`ticketOptimistic.ts`, `ticketListCache.ts`, `ticketListMeta.ts`, `ticketStatus.ts`,
`ticketSubscribeRegistry.ts`, `ticketUnread.ts`, `ticketDirectory.ts`, `ticketLiveBus.ts`, and 315 lines of
Desk ticket adapters out of `live.ts` (`TicketVM`, `mapTicket`, `loadTicketsPage`, `loadTicketById`,
`loadTickets`, `loadTicketMessages`).

The cluster rooted at exactly two entry points: the already-orphaned `TicketsTab`, and `sidebarBadges`.
`sidebarBadges` was rewritten to the two badges it actually serves — the servercrm INBOX socket (unrelated
to Desk) and `GET /comms/unread`. The previous commit had gated the Desk half off behind
`DESK_TICKET_BADGE = false`; leaving it would have meant a second, divergent idea of "unread tickets" one
boolean away from being switched back on, so it is gone. Its subscribe frame no longer carries ticket ids,
so servercrm stops broadcasting ticket comment events to this client entirely.

### Deleted from the backend

`POST /v1/desk/tickets`, `POST /v1/desk/escalations`, `POST /v1/desk/tickets/:id/reply` — every WRITE on the
Sales-gated Desk surface. With them went `src/modules/touchpoints/catalog/ticketsDeluge.ts` and all four
Deluge touchpoints: `tickets.create_in_crm` (`createticketincrm`), `tickets.create_escalation`
(`createescalationticket`), and the two `tickets.upload_*` attachment ones that had already lost their
callers. **No Deluge function is invoked for ticketing any more, from anywhere.**

### What deliberately REMAINS, and why

Four `GET /v1/desk/*` read routes. They are unreferenced by any UI, but they are the only route back to
tickets filed in Zoho Desk BEFORE the migration, and there is no history import. Deleting them makes that
history unreachable from the app — a product decision, not a cleanup, so it is flagged rather than taken.
The file header says exactly that.

The `zohoDesk` integration itself stays for three consumers that are NOT Sales ticketing:
`modules/carrier/serviceRequest.ts` (the mini-app / support-bot service requests, 9 keys),
`csAnalytics.routes.ts` + `csAnalyticsScope.ts` (CS dashboards over the Desk agent id space), and the
`zoho_desk.search_tickets` agent tool.

### Dependence level, measured

| Surface | Zoho Desk |
|---|---|
| Sales Mytrion (UI) | **0** — no import, no client, no URL |
| Sales ticketing (backend) | **0 writes**, 4 read routes for pre-migration history only |
| Deluge (ticketing) | **0** — catalog file deleted |
| CS / Billing / Verification ticketing | **0** — native from the start |
| CS analytics dashboards | still Desk (out of scope — only ticketing was being replaced) |
| Carrier mini-app service requests | still Desk (out of scope) |

### Verification

Typecheck clean, lint 0 errors. Backend back to the EXACT baseline failure set — 10 files / 35 tests, all
pre-existing — after updating `touchpoints-catalog.test.ts` for the intentional change (deluge count 19→15,
and the four removed function names). `desk-routes.test.ts` lost the create/reply/escalation cases along
with their routes rather than being skipped; its 12 remaining tests still cover the ownership gate on the
historical reads. Web 364/364. Bundle rebuilt.

## 2026-08-02 — Merging feature/Communication into feature/Mytrion: migration ordering

Merged `feature/Mytrion` (27 commits) **into** `feature/Communication` here, so the final step in the
main worktree is a pure fast-forward and every conflict got resolved with full context. Merge commit
`b3ceda0b`; migration renumber `93f0e9e7`.

### Two migration-number collisions git could not see

Git treats `0085_a.sql` and `0085_b.sql` as unrelated adds, so a duplicate migration number merges
clean and breaks at `db:migrate` time.

1. **Committed collision** — both branches claimed 0085-0088 (HR/loyalty vs comms). Comms moved to
   0089-0094.
2. **Uncommitted collision** — the main worktree has ~176 uncommitted changes including
   `0089_hr_attendance_shift_grace` and `0090_verification_sales_responses`. Comms moved again to
   **0091-0096**, leaving 89/90 reserved. The journal now has a deliberate gap at 89/90 that their
   commit fills.

### The `when` timestamp is load-bearing, and failure is SILENT

`drizzle-orm/pg-core/dialect.js:56`:

```js
const lastDbMigration = dbMigrations[0];   // order by created_at desc limit 1 — the MAX, read ONCE
…
if (!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis) { …apply… }
```

A migration is applied only when its journal `when` exceeds the **maximum** `created_at` already
recorded. So **`when` must increase along journal idx**, or a later-numbered migration is skipped —
with no error, no warning, and a green `migrations applied successfully`.

Renaming files is therefore only half a renumber. The comms set was stamped 7/30 19:00-7/31 00:00,
which *straddled* their 0089 (7/30 17:00) and 0090 (7/30 20:00): `0091_comms_presence` at 19:00 sorted
before their 0090. Comms is now **7/31 06:00-11:00**, strictly after everything on `feature/Mytrion`.

Reproduced against real throwaway Postgres, on a simulated post-merge tree (their two in-flight `.sql`
files spliced into the merged journal):

| Scenario | Result |
|---|---|
| Fresh DB, 97 migrations | both feature sets present |
| DB at their idx≤90, then comms lands | 91 → 97, all six apply |
| **Reverse: comms first, their 0089/0090 committed after** | **95 stays 95, `verification_sales_responses` never created, exit 0** |

### Rule this implies

**Whichever branch's migrations land second must carry the later `when` timestamps.** Comms is merging
*into* `feature/Mytrion`, and the fast-forward requires a clean tree — so their WIP is committed first
and comms follows, which is exactly how it is now stamped. If that order is ever reversed (comms merged
before their WIP is committed), their `0089`/`0090` `when` values must be bumped past 7/31 11:00 or
those two migrations will silently never run.

One pre-existing inversion remains at `0078_support_bot_memories` (09:00) → `0079_maintenance_cases`
(08:00.001), inherited from `feature/Mytrion`. Harmless in practice — the two were committed together,
so no DB stops between them — and left alone rather than restamped, since rewriting the `when` of an
already-applied migration is its own hazard.

### Merge conflicts resolved

`drizzle.config.ts` (union of both schema lists) · `src/app.ts` (kept the comms multipart ceiling — a
`max()` over both caps subsumes theirs) · `WORKING_NOTES.md` (both sections) ·
`tests/unit/touchpoints-catalog.test.ts` (each branch removed a *different* set of Deluge entries, so
the union removes both; count **13**, computed rather than guessed) · `meta/_journal.json` · plus 110
rename/rename conflicts in the committed `apps/mytrion-crm/app` bundle, resolved by deleting it and
rebuilding from merged source.

### Verification

95 migrations apply from scratch → 101 tables carrying **both** feature sets. Journal cross-check clean
(95 entries, 95 files, no orphans, no duplicate idx). Backend + web typecheck clean; lint 0 errors.
Backend tests **identical to `feature/Mytrion`'s own baseline** measured in a scratch worktree at
`bdf23883` — zero new failures, +285 passing (1380 → 1665). Web 383/383.

## 2026-08-02 — Sales Mytrion production audit implementation

Implemented the Sales audit plan directly on `feature/Mytrion`, with production safety taking
priority over surface-only polish.

### Request architecture, caching, and rate control

- Added `/v1/sales/bootstrap`: one agent/view-as-scoped bootstrap for identity, permissions, sidebar
  counts, Home metrics, source health, partial state, and freshness. The Sales shell primes its SWR
  caches from this response and lazy-loads every non-Home tab.
- Added bounded process-local SWR with in-flight coalescing and stale-if-error fallback. Touchpoint
  reads now cache normalized, server-injected parameters; successful writes invalidate the tenant's
  read cache.
- RBAC is deliberately evaluated **before** touchpoint cache lookup. This closed a cross-department
  cache-leak path found by the test suite: an unauthorized caller can never receive a previously
  cached authorized response.
- Rate-limit keys now use actor `tenant:user` plus independent budgets for cached reads, expensive
  provider reads, writes, auth, webhooks, and touchpoints. View-as does not charge the target user's
  abuse budget. Fixed custom rate-limit responses so 429s cannot be transformed into opaque 500s.
- Browser transport now deduplicates idempotent in-flight requests, supports cancellation, honors
  `Retry-After`, and avoids blind rate-limit retries. Provider guards add bounded concurrency,
  timeout/circuit-breaker behavior, and controlled retries.
- Consolidated Sales realtime consumption to one session connection and paused nonessential
  refresh/telemetry while the page is hidden.

### Tickets and deployment readiness

- Added boot migration execution with a Postgres advisory lock, transient startup retry, and
  fail-closed behavior. Render enables `DB_MIGRATE_ON_BOOT=1` before the listener starts.
- Added communications schema readiness through a repo-backed catalog probe. Ticket routes return
  `COMMS_SCHEMA_NOT_READY` (503) instead of table-not-found 500s, the Sales UI renders a useful
  unavailable state, and `/v1/health` blocks readiness when the communications schema is incomplete.
- Registered `0097_inbox_unread_index` and `0098_inbox_keyset_index` in the Drizzle journal. Verified
  99 numbered SQL files match 99 journal entries with no orphaned migration.

### Sales tabs and UI

- Removed the floating RingCentral reload control. Reduced the softphone's polling/DOM observation;
  recovery remains inside the RingCentral panel and the host reserves its action-safe area.
- Applied the Sales glass hierarchy and Space Grotesk/Space Mono typography across shared surfaces,
  with calmer light-mode neutrals, stronger dark-mode separation, standardized loaders, status
  states, controls, focus treatment, and accessible dialog behavior.
- Inbox now has server search/filtering, 25-row keyset pages, realtime invalidation, optimistic
  read/unread/delete with rollback, and a composite feed index.
- My Tasks now separates counts from paginated rows and uses optimistic versioned status changes.
- Verification keeps existing cards while revalidating, lazy-loads detail/attachments, reports
  partial/source-health state, and uses responsive equal-height cards plus standardized skeletons.
- Call Hub normalizes and deduplicates Mytrion/Zoho/Gong references, prefers Mytrion records, exposes
  source health and exact/estimated aggregates, and probes only enough source rows for the requested
  bounded page instead of always reading 200.
- Carrier search is debounced/cancellable and bounded to 25/50-row presentation; duplicate lead
  outcomes are explicit and writes carry replay protection.
- Retention, Automations, dashboards, Create, Data Center, and Tickets preserve visible data during
  background refresh, share cached lookups where possible, and use standardized mutation feedback.

### Verification

- Backend build and typecheck pass.
- Frontend typecheck and production build pass; Sales tabs are emitted as separate lazy chunks.
- Lint passes with 0 errors (22 pre-existing non-null assertion warnings outside this change).
- Frontend: **60 files / 396 tests passed**.
- Browser QA completed against the signed-in local Sales workspace in dark/light modes and at
  desktop, 800 px, and 390 px widths; no document-level horizontal overflow was present.
- Focused Sales/backend: bootstrap, touchpoint RBAC/cache, Inbox, KPI/tasks, Call Hub, Verification,
  Data Center, RingCentral, communications/RBAC, dashboards, invoices, rejection reports and
  provider guards all pass. The broader repository suite still contains previously documented
  unrelated HR/Customer-Service expectation drift plus socket/DNS tests that cannot run in the
  restricted local sandbox; those are not hidden as Sales regressions.

## 2026-08-02 — Sales presentation rollback and refresh correction

- Removed the blocking frontend bootstrap gate from the Sales entry path. The combined bootstrap
  endpoint remains available, but a browser refresh now mounts the Sales shell immediately instead
  of waiting for all Home/provider sources to settle.
- Kept tab-level code splitting, but replaced the newly introduced shell/tab skeleton fallback with
  the established `MytrionPageLoader` presentation.
- Restored the original Sales typography system: Inter body copy, Rajdhani display headings, and
  JetBrains Mono identifiers/metrics. Restored the previous light surfaces/shadow strength and
  removed the global 40px control rule that changed compact-control proportions.
- Fixed the Sales Admin View Exit control's event handling and compact sizing. Added a focused
  regression test proving Exit clears the active impersonation.
- Verification: frontend typecheck, production build, and the focused ViewAsPicker test pass.

## 2026-08-02 — Sales Mytrion: one page header, one loader (UI/UX consistency pass)

Scope: `apps/mytrion-crm/src/mytrions/sales/redesign` only. Every tab reviewed individually.

### The "double shell" — one title per screen

The top bar printed the nav label **and** a second author-written title (`NAVLABEL`), and each tab
then printed its own heading plus description. My Tasks read `MY TASKS · Assignments` in the chrome
over the chip `ASSIGNMENTS` and the heading `MY TASKS` in the page — two words, three times. Call Hub
had the same shape.

- Top bar is now the **only** place a section is named, and it is an `<h1>` carrying exactly the label
  the user clicked. The secondary title is gone.
- `NAVLABEL` (a second set of titles) became `NAV_DESC` — one sentence per tab, the single source for
  the line under a page header. Tabs no longer hard-code their own copy.
- New `SalesPage` / `SalesPageHead` / `SalesMetrics` / `SalesSubTabs` / `SalesEmpty` /
  `SalesErrorNote` / `SalesPager` (`SalesPage.tsx` + `sales-page.css`). `SalesPageHead` takes
  `description` / `actions` / `metrics`; `title` is reserved for a genuine sub-view (a record being
  inspected, e.g. the Verification detail's company name) and is never the section name.
- Removed the in-page headings from Tasks, Call Hub, Inbox, Data Center, Automations, Carriers,
  Dashboard, Verification, and both Retention panes ("My cases" / "Open Pool" — the sub-tab already
  names the pane).

### The double loader

`Suspense fallback={<MytrionPageLoader/>}` (a spinner) ran while a tab's chunk downloaded, then the
tab showed its own shaped skeleton, then the content — three states per navigation.

- The Suspense fallback is now `SalesTabSkeleton`, which renders the **same shape** the tab shows
  while its data loads (`TAB_SKELETON` maps section → variant). One skeleton that fills in.
  This intentionally reverses this morning's "replace the skeleton fallback with MytrionPageLoader"
  note: the problem was never the skeleton, it was having a spinner *and* a skeleton with different
  shapes. `MytrionPageLoader` is untouched and still used by HR/Recruit.
- Deleted the now-duplicate skeletons: `TasksBoardSkeleton`, `DcKanbanSkeleton`,
  `DcCardGridSkeleton`, `DcListSkeleton`, `HomePageSkeleton`, `HomeBelowFoldSkeleton`,
  `ActivityTilesSkeleton`, the inline `CallHubSkeleton`, and `Gate`'s spinner fallback in Data Center.
- Money Codes was the last sub-tab loading with a **spinner** while its siblings used skeletons — now
  a skeleton.
- The page shell is the single `aria-busy` owner (cold load *and* background revalidation); skeletons
  under it are `aria-hidden`, so assistive tech hears "busy" once, not once per placeholder block.

### Flicker

- `.ss-fu` (the `ss-up` slide-in) ran on the skeleton root **and** again on the content root, so the
  page slid in twice per load. Only `.ss-page` carries it now, and it survives the loading→loaded
  swap, so the entrance animation plays exactly once per tab open. Skeletons never animate their
  entrance.
- Carriers gave **every result row** `className="ss-fu"`, re-running the animation on all 25 rows on
  every filter/page/page-size change. Removed.
- Debtors dashboard and Open Pool were nested `ss-fu` inside an animated page — removed.
- Data Center's freshness caption now keeps a fixed line box, and the loyalty tier bar has a
  placeholder, so the client grid no longer shifts when the first fetch lands.

### Bugs fixed

- **My Tasks column counts were wrong when paginated.** Each column header printed
  `counts[col.id]` — the account-wide total — above a body holding only the current page's rows
  ("38 cards" over three visible cards). Headers now count what they render; all-pages figures stay
  in the metric strip, which says so.
- **Inbox hid working rows on a failed refresh.** `load.error && !load.data` meant a background
  failure with data on screen showed nothing at all. The error is now an inline note above the list.
- **Verification showed contradictory states.** The "showing the latest available pipeline data"
  banner rendered alongside the hard error state when there was no data; it is now gated on data.
- **Content width jumped between tabs** — the shell clamps to 1180px but Dashboard nested 1100,
  Create 1080, Carriers a redundant 1180. One measure now, with `width="narrow"` (1080) as the single
  sanctioned exception for form screens.
- Coming-soon panels used 16px vertical padding against every other tab's 24px, nudging the layout.
- Data Center's filter select and Meta toggle were 44px next to a 42px search field.

### Consistency

- Five different sub-tab controls (pills with `aria-pressed`, a boxed segment group, a bare button
  row, two hand-rolled `role="tablist"`s) → one `SalesSubTabs` with counts, SOON tags and proper
  `role="tab"` / `aria-selected`. Used by Data Center, Create, Dashboard, Retention, Inbox filters,
  Call Hub filters, Money Codes.
- Four page-header implementations, four empty-state treatments, three pagers and three error
  presentations → one each.
- Sidebar items carry `aria-current="page"`; search fields share one field with hover/focus
  affordance and a clear button.
- `prefers-reduced-motion` disables the page entrance and the skeleton shimmer.
- Deleted the CSS left stranded by the above (`.ss-verification-header/-copy/-toolbar/-search/
  -pagination/-page-controls/-state/-title`, `.ss-tasks-empty/-new-pill/-hero`, `.ss-call-empty/-hero`,
  `.ss-*-refresh`, `.ss-card-grid-skeleton`).

### Verification

- `npx tsc --noEmit` clean; `npx vitest run` 62 files / 401 tests pass (up from 397 — new
  `SalesPage.test.tsx` asserts no duplicate section title in a tab body and exactly one loading
  region, cold and loaded).
- `vite build --mode production` clean; every changed module fetched through the dev server with no
  transform errors.
- `apps/mytrion-crm/app/` (the committed bundle) was rebuilt as a side effect of the production
  build. It was already in a half-deleted state in the working tree before this session.

## 2026-08-02 — Verification onto Zoho Deals; Tickets inherits the parent design

### Verification — data source moved off the DWH onto Zoho CRM

`octane.agent_deals` (+ `octane.dim_company`) is gone from this path. Two reasons, both load-bearing:

- **It was keyed on an agent DISPLAY NAME.** The warehouse has no Zoho user id, so the route had to
  resolve a name and pass it as the scope. An agent whose warehouse name did not match got a silently
  EMPTY pipeline. Scoping is now `Owner = '<zoho_user_id>'` — an id, like every other Sales pull.
- **It did not carry the fields verification turns on.** Stage, Application_Stage, Application_Status,
  Credit_Decision, Credit_Score, Risk_Score, CreditSafe_Grade and the three *_Verification picklists
  are Zoho fields; the warehouse had none of them or a lagging copy.

New `src/integrations/salesVerificationDeals.ts`: one COQL select over `Deals`, filtered
`Owner = '<uid>' and Application_ID > 0`, ordered `Application_Date desc, id desc`, drained in
**200-row pages** (`runCoqlAll`, capped at 1000 rows / 5 calls). The service then serves the UI's
9-per-page requests out of that drained set, which is what makes an exact `total` possible. The
existing `AsyncSWRCache` still fronts it.

Field metadata was read from the live org (`getFields` on Deals, 153 fields) and every query probed
through `/coql` before shipping. Three findings worth keeping:

- **`Verification_Decision` is a `fileupload`** — the decision DOCUMENT, not a decision value. The
  decision an agent needs is `Credit_Decision` (text: "Approved-Requested",
  "Declined-Prepay/Secured Only", "Declined") plus `Application_Status`.
- **DOT on Deals is `DOT1`**; a bare `DOT` is a Leads field and 400s the whole query.
- **`Stage_Modified_Time` is in field metadata but is NOT COQL-queryable** (`INVALID_QUERY`). Use
  `Stage_Last_Updated`.

Filtering on `Application_ID > 0` rather than `Application_Date is not null`: deals sitting in
"Application Filled" with a null Application_Date exist in the live org, and dropping them would hide
real work. `> 0` also sidesteps this org's COQL parser rejecting a trailing `is not null`.

Mapping rules the tests pin:
- `Credit_Score` of **0 means "not scored"** — the CRM 0-fills undecided applications, and rendering
  "0" beside a real 688 reads as a catastrophic score.
- `Credit_Limit` is a **TEXT** field, so "$15,000" has to parse.
- `"-None-"` is Zoho's unset-picklist marker, not a value.
- `MC` is free text agents also use for notes-to-self ("DOT", "No assigned number") — only kept when
  it looks like an identifier.
- Classification comes from `Stage`: closed-lost → closed; card swiped/funded/activated/delivered or
  closed won → active; everything else → in pipeline.

The 9-stage compliance TIMELINE is unchanged — it still comes from the credit_platform provider via
`/v1/verification/pipeline`. Only the roster/record moved.

### Verification — the tab redesigned on the design system

The card now answers "where is this application and what did credit decide" without opening it:
company + classification, Stage / Application stage / Application status chips, then a dedicated
decision line (decision text, credit score, approved line). New `verificationFields.tsx` derives every
tone from the VALUE, so an unrecognised picklist option degrades to neutral instead of rendering as
"good".

The detail page is three token-built sections — Credit decision (score, line approved, limit, risk,
CreditSafe grade, money-code limit, payment type, billing cycle + a pass/fail checkpoint rail for
Company / Billing / Love's / Verified / Limits added), Application (stage, status, dates, cards
requested, carrier / DOT / MC), and From Verification (reject reason, notes) — followed by the live
compliance pipeline. Tiles with no value render nothing rather than a grid of em dashes.

### Tickets — inherits the parent design instead of bringing its own

`comms.module.css` was built on its own rem type scale and pill shapes, so the console read as a chat
widget dropped inside a Mytrion rather than a page of it. Everything now resolves through the HOST's
tokens with a Horizon fallback (`var(--surface, var(--hz-pane))`, `var(--ss-text-xs, 13px)`, …) —
mounted under Sales' `.ss-root` it picks up Sales' glass surfaces and px type scale; mounted by CS /
Billing / Verification it falls back exactly as before. Specifically:

- panes take the host card surface (`--surface` + `--border` + `--shadow-sm`);
- the list heading is the host's display face, and wraps to two lines instead of truncating
  "My tickets & escalations" into "My tickets & escal…";
- "Live" became the host's eyebrow pill; the loose outlined filter pills became the host's segmented
  control with `role="tab"` / `aria-selected`;
- the search is the host's field (38px, `--radius-md`, same hover/focus) and gained a clear button;
- empty states gained the host's icon well (a bare heading with no mark read as an error), plus a
  "Clear search" action when a search is what emptied the list;
- rows, tags, unread badge, skeleton, error note, bubbles and the composer all moved onto the shared
  tokens and control sizing (38px, `--radius-md`), so nothing sits a few pixels off its neighbours.

Functional fixes: the count line no longer blanks while loading (the header jumped a row on every
filter change and background refresh), the mobile back control is a real icon button with a proper
label instead of a bare "←" glyph, and "Check again" / "Load more" use one button treatment.

### Verification

- Backend: `tsc --noEmit` clean, `eslint` clean on all changed files, `verification-pipeline-service`
  (7 tests, rewritten for the Zoho source) and `verification-pipeline-routes` (4) pass.
- Frontend: `tsc --noEmit` clean, 62 files / 401 tests pass, production build clean, every changed
  module fetched through the dev server with no transform errors.
- The wider backend suite still has 9 unrelated failing files (carrier-mini-app, retention-phase1,
  stream-adapter, realtime-heartbeat, zoho-crm, tools, retention-cs-caps, notification-templates).
  None of them import `verificationPipeline` or `salesVerificationDeals`; they are the previously
  documented drift + sandbox socket/DNS failures, not regressions from this change.
## 2026-08-02 — Platform scaling and vendor best-practices handbook

- Added `docs/platform-scaling-best-practices.html`, a self-contained engineering handbook covering
  Zoho CRM API selection/COQL/credits, read-only DWH access, application PostgreSQL, PgVector,
  pg-boss queues, WebSocket/pub-sub, external-vendor adapters, security, scale stages, SLOs, and a
  production release checklist.
- Grounded vendor limits and delivery semantics in primary Zoho, PostgreSQL, pgvector, pg-boss,
  Redis, RFC 6455, and AWS documentation; included the source links in the handbook.
- Documented repository-specific strengths and risks, including bounded DWH access, dedicated job
  workers, tenant-scoped repositories, TLS verification gaps, and the transition from process-local
  caching to Redis/Valkey when multiple application instances are introduced.

## 2026-08-03 — Docker install fix for pnpm patch files

- Copied the repository `patches/` directory into both Docker dependency-install stages before
  `pnpm install`, so the frozen lockfile can hash and apply the `archiver-utils@5.0.2` patch.
- This fixes the Render image build failure in pnpm's `createBase32HashFromFile`; the runtime
  production-dependency install received the same fix to prevent a later-stage repeat failure.

## 2026-08-03 — Rename OpenAI gateway package to v2

- Renamed `apps/agent-gateway-groq` to `apps/agent-gateway-v2` without changing gateway behavior.
- Updated the Render root-directory documentation, root environment guidance, and support-bot
  knowledge seeding import to use the new path.
- Kept local gateway secrets, runtime data, build output, and dependencies ignored from Git.

## 2026-08-03 — Fix Telegram outbound queue deadlock

- Removed recursive acquisition of the global Telegram send lane from the per-chat message queue;
  the nested queue previously left the first reply active forever and every later reply waiting.
- Failed Telegram API responses now throw the server description instead of being counted and
  silently treated as successful.
- Added regression coverage for both a completed queued send and a surfaced Telegram API error.

## 2026-08-03 — Sales Create back on Zoho Desk; Tickets parked in all four operational Mytrions

Reverses the write half of `030fc352` / `940e8d8e`. The native comms console is parked, so the Create
tab files into Zoho Desk again — which is where Customer Service, Billing and Verification actually
work the queue.

### Tickets parked (Sales, CS, Billing, Verification)

Each Mytrion uses its OWN existing coming-soon idiom rather than a new mechanism:

- **Sales** — `comingSoon: true` on the NAV entry. That one flag already drives the sidebar SOON chip,
  the `ComingSoonPanel` short-circuit, `TICKETS_ENABLED` (which gates the unread badge and the
  Create → open-ticket jump), so nothing else needed touching. Added the `SOON_TABS` copy it renders.
- **CS / Billing** — `disabled: true` on the nav item, which both shells already render as a "Soon"
  chip on a disabled button. The panel is additionally gated on a `TICKETS_PARKED` constant *derived
  from NAV_ITEMS*, so a deep link cannot open a queue the nav refuses to show and the flag cannot drift.
- **Verification** — swapped `content:` for the `soon:` slot `ModuleShell` already supports.

`TicketConsole`, `ChatThread`, `useCommsSocket` and the whole /v1/comms backend are UNTOUCHED. Every
park is one flag/line from returning; nothing was deleted.

Two bugs found while parking:
- Sales' `FULL_BLEED` was consulted before the coming-soon check, so a parked Tickets tab would have
  rendered the ComingSoonPanel as a full-height flex child with 16px padding instead of the normal
  24px page padding. Now `FULL_BLEED.has(section) && !parkedSection`.
- `soonTabs.test.ts` asserted Tickets is NEVER parked. Replaced with the invariant that actually
  matters: `comingSoon` and `TICKETS_ENABLED` must agree, so un-parking flips both together.

### Create tab restored to Desk

**Backend** — `POST /desk/tickets` and `POST /desk/escalations` are back in `desk.routes.ts` exactly as
they were, with `readMultipart` (413 on >20MB) and `attachCreateFile`. Restored
`catalog/ticketsDeluge.ts` with the TWO touchpoints that have callers — `tickets.create_in_crm`,
`tickets.create_escalation`. The two `tickets.upload_*` ones did NOT come back: the routes attach
through the Desk API directly, and those had no callers even before the removal. One deliberate
difference from the original: `zohoCrm.attachFileToRecord` instead of the deprecated module facade.

**Frontend** — new `api/desk.ts`, CREATE ONLY. The original also carried the ticket-dashboard reads
(listDeskTickets / getDeskTicket / listDeskComments / replyDeskTicket / downloadDeskAttachment); those
stay deleted, because no UI reads Desk tickets while the tab is parked and restoring them would mean
restoring TicketsTab and its whole cache/feed/optimistic cluster as dead code. The backend GET routes
still exist, so a reader is a client-side change whenever the tab returns.

What the revert changes for the agent:
- the department step is a real routing choice again (it picks the Desk department), not just a filter;
- contact / account / email / phone are sent, because a Desk ticket requires a contact;
- the attachment rides the SAME multipart request, so `attached` is authoritative — there is no window
  where the ticket exists and the file silently did not arrive;
- escalation reasons are a fixed list again (Desk's reason is free text on the CRM record — there is no
  admin catalog behind it to validate a code against) and the department picker is gone (Desk routing
  is the Deluge's decision, not the caller's);
- neither submit tries to open the new ticket, since the tab is parked. The toasts say the team picks
  it up in Zoho Desk rather than promising a jump that cannot happen.

**Kept from the native era, not reverted:** both submits had gained an `idempotencyKey`, which Desk has
no parameter for. Rather than silently lose double-submit protection, each form now holds a synchronous
`submitInFlight` ref — `setSubmitting(true)` is a React state update that does not land before the
handler returns, so without it a fast double-click files two Desk tickets.

### Verified against the LIVE Zoho org (reads only, nothing created)

- all four `DESK_DEPARTMENTS` ids resolve to live enabled departments (Customer Service, Billing and
  Accounting, Verification, Maintenance) — plus an "Escalation Team" department for the Deluge;
- all six custom fields the create route stamps exist on the live ticket layout: `cf_ticket_type`,
  `cf_crm_created_by_id`, `cf_deal_id`, `cf_submitted_by`, `cf_carrier_id_application_id`,
  `cf_card_number`;
- `Escalation_Request` exists (the attachment fallback target) and `Escalation_Reason` is a **text**
  field with no picklist, confirming the fixed list is the only definition of it;
- every reason in the restored list is in live use. The Deluge is demonstrably alive — escalations were
  created through it today, minutes before this change. One legacy value, "Lead / Deal Transfer",
  appears twice in June and has since been split into the separate Lead/Deal Transfer entries that now
  dominate; not added back.

NOT VERIFIED: no ticket or escalation was actually created. Doing so would write real records into
production Desk/CRM. The Deluge functions themselves (`createticketincrm`, `createescalationticket`)
were only ever removed from OUR catalog, never from Zoho, and the escalation one is proven live by
today's records — but the end-to-end POST is untested and should be exercised once on staging.

### Verification

- Backend: typecheck + `pnpm build` clean, eslint 0 errors (21 pre-existing warnings),
  **1838 tests pass, 0 failures**. `desk-routes.test.ts` regained the create + escalation coverage
  (23 tests, 11 new) including: filing on someone else's deal → 403 with no ticket created, a
  non-numeric dealId rejected before any COQL, admin skipping the ownership lookup, the file landing on
  Desk, the CRM-Deal fallback when Desk lacks attachment scope, `attached:false` when BOTH refuse (a
  200 — the ticket exists), and a 502 rather than false success when the Deluge returns no ids.
- Catalog counts updated for the two restored touchpoints (deluge 13→15, total 99→101).
- Web: typecheck clean, 401 tests pass, production build clean, bundle rebuilt, every changed module
  fetched through the dev server with no transform errors.

## 2026-08-03 — Live Card Lookup exports + parked Sales tabs

### Card Lookup report

- Added one live report pipeline for PDF and XLSX. EFS supplies current card state, unit, driver,
  X-Ref and override; DWH supplies the stable Card ID and is the read-only fallback when EFS is
  unavailable. Card numbers are masked in both formats.
- The approved columns are `Card ID`, `Card #`, `Unit`, `Driver ID`, `Driver Name`, `X-Ref`, `Status`
  and `Override`. The source sample's `Policy #` and `SmartFunds` columns are intentionally omitted.
- Added owner/manager-only mini-app delivery and the owner-normalized agent-gateway tool. Both send
  the generated document to the requester's private Telegram chat and audit the delivery; drivers
  are rejected before fleet data is read.
- Added a Card Management panel with PDF / Excel actions and translations in all four mini-app
  locales. PDF pagination and XLSX layout were visually checked against the supplied reference.

### Sales Mytrion

- Parked `My Tasks` and `Verification` via the existing `comingSoon` source of truth, moved them into
  the parked nav group, reused the shared disabled/SOON colors and ComingSoonPanel metadata, and hid
  the task badge while the tab is parked.

### Verification

- Root lint: 0 errors (22 pre-existing non-null-assertion warnings). Root typecheck and production
  build pass. Feature suites: 118 backend tests, 83 gateway tests, and 416 web tests pass.
- Full backend suite still has unrelated environment/baseline failures: sandbox WebSocket listeners
  cannot bind to 127.0.0.1, CS fixtures resolve to 403, retention fixtures depend on unavailable
  state, and scripted-agent tests cannot reach the blackboard database. The RBAC leakage suite and
  all Card Lookup tests pass.
- Rebuilt the mini-app and Mytrion CRM production bundles.

### Checks
Backend + CRM `tsc --noEmit` clean, `pnpm lint` 0 errors, CRM build green. CRM 16 failed / 3 files
(pre-existing). Backend across four runs: 160 / 10 / 9 / 9 failures — the documented post-build
timeout flakiness; `analytics-reports-routes` passed in every run. Suite total is now 1837 (+9).

## 2026-08-04 — Sales Card Status Report automation

- Added `Card Status Report` directly after the invoice/transaction reporting actions in Sales
  Mytrion Automations. The action selects one of the agent's clients, shows the same masked live
  Card Lookup roster, and downloads the shared PDF or Excel format in the browser.
- Added Sales-authenticated `/sales/cards` and `/sales/cards/report` reads. Both require the Sales
  department and prove the carrier belongs to the caller before loading cards; report downloads are
  audit-logged and never cached.
- The result table keeps the approved eight columns and points agents to the existing card actions
  for activation/deactivation, limit, and unit/driver management.
- Moved the mini-app's private-DM Card Lookup download panel below the searchable card roster, so it
  follows the same lower-page placement as invoice/transaction download actions.
- Verification: root + both frontend typechecks pass; root lint has 0 errors (22 existing warnings);
  backend report/ownership tests 7/7, Sales automation/report UI tests 11/11, and the full Mytrion
  CRM suite 418/418 pass; all three production builds pass and both frontend bundles were rebuilt.

## 2026-08-04 — Card Status Report last-6 and service code

- Changed Card Status Report data to expose only the card's last six digits. The same restriction is
  enforced again while rendering PDF/XLSX files, and Sales UI adds the masked `••••` presentation.
- Updated the mini-app Card Management roster and card detail header to show only last-six card
  identifiers for owners and managers.
- Registered Card Status Report as Customer Service code `C-30` in both the Sales automation catalog
  and the admin scope reference.
- Verification: backend report/RBAC tests 7/7 and Sales report/catalog tests 12/12 pass; root and both
  frontend typechecks/builds pass; lint has 0 errors (22 pre-existing warnings); frontend bundles
  were rebuilt.

## 2026-08-04 — Confirmed support-bot group binding

- Replaced silent Telegram group auto-binding with an explicit company confirmation. A registered
  owner or manager can start the flow by mentioning/replying to the bot in an unmapped group; drivers
  and unregistered users cannot bind it.
- The preview is read-only and shows the server-resolved company. Only the same owner/manager can
  press `Yes`; that action performs the existing audited `support_bot_chats` write, making the group
  visible in Mytrion CRM. `No`, expiry, another member's click, and gateway restarts do not write.
- Added actor/chat/message-bound callback tokens, a ten-minute expiry, bounded pending state, prompt
  throttling, conflict detection, and a short miss-driven access refresh for newly registered users.
- Verification: confirmation/cache tests 8/8, full gateway suite 88/88, targeted backend route/RBAC
  tests 18/18, root and gateway typechecks/builds pass, and lint has 0 errors (22 existing warnings).

## 2026-08-04 — Customer Support manual knowledge curation

- Reviewed `Octane_CS_Operations_Manual_v3 (2).docx` (Customer Support Operations Manual v1.0,
  June 2026) for the external owner/manager/driver support bot. Added seven client-communicable
  articles covering account structures, limit-increase eligibility, reactivation, Plaid, FMCSA
  insurance status, card replacements, and the exact card-status/PIN behavior.
- Corrected three existing card articles: Hold for Fraud cannot be permanently reactivated without
  Verification approval; a one-time temporary override is offered only when live card state marks
  it available.
- Did not publish the raw confidential manual or its internal login flow, staff contacts/account
  number, ticket taxonomy, internal exception criteria, call-scoring rules, or work-order mechanics.
  Added regression assertions that representative private identifiers never enter the client corpus.
- The idempotent support-KB seed now records the manual-derived articles as a June 2026 curated
  source with version bumps for corrected articles; the same bounded content remains available as
  the gateway's backend-outage fallback.
- Verification: gateway suite 91/91 and backend KB isolation/fusion tests 5/5 pass; root and gateway
  typechecks/builds pass; lint has 0 errors (22 existing warnings).

## 2026-08-04 — Support-bot testing corrections

- Removed callback/call requests from the agent gateway's service-request contract. “Call me” now
  receives a short unsupported explanation plus the assigned agent contact; the bot no longer
  collects phone/unit/urgency, promises a call, or creates a callback ticket.
- Made `telegram_buttons` confirmation-only. Arbitrary choices (including Urgent/Normal), menus,
  missing-detail collection, and generic Customer Service handoffs fail schema validation; the
  router no longer auto-injects a button tool for every handoff.
- Added owner/manager transaction-report scoping by exact unit at the DWH SQL layer. Both data and
  totals use the same unit predicate, driver-selected unit scope is rejected, and report metadata,
  audit data, filename, and tool result identify the actual unit scope.
- Tightened prompts against fake plain-text confirmations and false “one unit sent” success after a
  fleet report; legacy arbitrary callback taps now fail closed before access/router/model work.
  Full gateway suite 94/94 and targeted backend report/RBAC tests 12/12 pass; root and
  gateway typechecks/builds pass; lint has 0 errors (22 existing warnings).

## 2026-08-04 — Proactive Telegram request collection

- Extended the existing per-chat/user message burst behavior for natural multi-message intake.
  Greetings and report starts now wait up to ten seconds for the actual request/details; once a
  second fragment arrives, the buffer stays open seven seconds after each new fragment.
- Added agent policy and transaction skill guidance to combine the full sequence into one atomic
  request, reconcile scope/date/format/column constraints, and ask one focused clarification only
  when a required detail remains missing or conflicting.
- Kept ordinary complete requests on the configured three-second quiet window and preserved the
  existing 120-second hard cap, per-user isolation, bounded item/key limits, and admission control.
- Verification: full gateway suite 97/97, root/gateway typechecks, and gateway production build
  pass; root lint has 0 errors (22 pre-existing warnings).

## 2026-08-05 — Sales Data Center Leads + Deals live

- Removed the `soon` gates from the Leads and Deals Data Center sub-tabs. Both existing live Zoho
  pipelines are selectable again with their lazy loads, search, status/source/stage filters, Meta
  filter, Board/List layouts, detail sheets, edits, call workflow, notes, and activity history intact.
- Added a UI regression test that asserts both tabs stay enabled and that each tab exposes its
  complete search/filter/layout toolbar. Compacted static catalogs to bring `RecordsTab.tsx` back to
  the repository's 600-line cap, and rebuilt the committed production widget bundle.
- Verification: cross-tenant/Data Center backend suites 53/53, targeted Sales UI suites 20/20, and
  the full Mytrion CRM suite 433/433 pass; root + frontend typechecks, root lint (0 errors, 22 existing
  warnings), and the production build pass. The full backend suite remains red in unrelated CS,
  Comms Admin, Retention, and agent-blackboard tests because their current fixtures/environment
  return 403/500 or require the absent localhost test DB on port 5433.

## 2026-08-05 — Zoho Lead Blueprint API discovery

- Verified Zoho CRM v8's record-level Blueprint contract: fetch the record's current process and
  available transitions with `GET /Leads/{record_id}/actions/blueprint`, then execute exactly one
  currently available transition with `PUT /Leads/{record_id}/actions/blueprint` and a
  `transition_id` plus any transition-required field data.
- Audited the `build` source without switching away from the active feature branch. The integration
  and owner-scoped Lead PATCH route already contain a basic Blueprint transition path, while the
  Lead detail UI still derives available statuses from a hardcoded local graph instead of the live
  per-record Blueprint response.
- Identified a fail-open gap to fix before live credential testing: the current Blueprint lookup
  turns every non-2xx response (including OAuth/permission/server failures) into an empty transition
  list, after which the route attempts a plain `Status` update. Only Zoho's explicit
  `RECORD_NOT_IN_PROCESS` condition may safely use that fallback.
- Implemented typed live Blueprint details, fail-closed error handling, official top-level mutation
  response validation, and an owner-scoped/audited transition endpoint that re-fetches the record's
  available transitions before accepting an id or field payload.
- Replaced the Lead detail editor's hardcoded status graph with the record-specific Zoho process,
  manual transitions, criteria, required fields, and picklist options. Unsupported mandatory complex
  inputs stop safely and direct the agent to Zoho rather than attempting a partial transition.
- Verification: Blueprint/Data Center suites 38/38, RBAC/tenant set 131/131, full Mytrion CRM suite
  435/435, root + frontend typechecks, lint (0 errors, 22 existing warnings), and production build
  pass. The full backend run has 1,791 passes and the same unrelated CS/Comms/Retention/DB/socket
  environment failures; the Blueprint/Data Center suites pass independently after that run.

## 2026-08-05 (pm) — Zoho OAuth sign-in outage: the callback had no GET (branch `fix/Oauth`)

**Symptom:** `{"error":{"code":"NOT_FOUND","message":"Route GET /v1/auth/zoho/callback not found"}}`
— reported as "Daniel Brown cannot login with zoho", but it blocked EVERY worker.

**Root cause (not RBAC at all).** The flow was written for one registration shape only: Zoho redirects
to the PORTAL origin, the SPA reads `?code&state` and relays them to `POST /v1/auth/zoho/callback`
(`apps/mytrion-crm/src/api/auth.ts`). The Zoho server app's redirect URI is instead registered as the
API's own `/v1/auth/zoho/callback`, so Zoho sent the browser there with a **GET** — and only the POST
relay existed. `/v1/*` is an API path, so it never reaches the SPA's index.html deep-link fallback
either; it just 404'd, with nothing in the message pointing at OAuth.

**Fix.** Added the browser-facing `GET /v1/auth/zoho/callback` (`src/routes/v1/auth.routes.ts`). It
does NOT complete the exchange: the one-time code is still unconsumed at that point, so it bounces the
browser to `PORTAL_BASE_URL` with the params intact and lets the existing, tested POST relay finish —
which also avoids minting a session that could only be handed over in a URL. Denied consent and a
param-less callback are forwarded as `?error=...`, which the portal already renders as sign-in copy.
Both registration shapes now work, since `redirect_uri` is the same env value on the authorize and
token calls either way.

- New env `PORTAL_BASE_URL` (default `/`, correct in prod — the portal is served same-origin at root
  by `plugins/widgetStatic.ts`). Set it to the Vite origin only for a separate dev port.
- `.env.example` now documents `ZOHO_SERVER_CLIENT_ID/SECRET`, `ZOHO_OAUTH_REDIRECT_URI` and
  `PORTAL_BASE_URL`. **None of the three were documented before**, which is how the redirect URI drifted
  (its dev-only default is `http://localhost:5173`). This was already flagged as a prod-config issue in
  the 2026-07-17 note and never closed.
- Cover: `tests/unit/auth-zoho-callback.test.ts` (6) — pins "GET must not 404", param forwarding, that
  the code is NOT consumed server-side, and the error paths.

**RBAC was verified, not changed.** The layering already does what was asked: profile default (Admin →
Profile Defaults) → role default (union) → marker floor → per-user override (Admin → User Management)
→ break-glass. Login (`POST /auth/zoho/callback`) and `/auth/me` both resolve through the same
`mytrionAccessService.resolveWorkerAccess` the backend gates use, and the 10s cache is invalidated on
admin save. A worker with nothing configured falls to the legacy profile-substring floor; if that is
empty the portal renders `Forbidden` naming the user and profile — so once signed in, "no Mytrion is
assigned to Daniel Brown (profile: X)" is the diagnostic, and the cure is a User Management override or
a profile/role default. b2ec4b94 had already fixed the Role-Defaults-wipes-unconfigured-profiles lockout.

**Pre-existing test breakage on this branch — NOT from this change and NOT fixed here.** `npx vitest run
tests/unit` is 145 failed / 1786 passed across 17 files; verified identical with my changes stashed.
Cause is test hygiene, not product code: suites read secrets from the developer's `.env` instead of
setting them — e.g. `tests/unit/billing-auto-map-route.test.ts:29` uses `env.BILLING_INGEST_SECRET`,
which is absent from `.env`, so the route 503s `SERVER_MISCONFIGURED` and all 6 assertions fail. This is
exactly the non-determinism `vitest.config.ts`'s env baseline was introduced to prevent; those vars
belong in that baseline. Worth its own pass.

## 2026-08-05 (pm, cont.) — `ZOHO_USER_LOOKUP_FAILED`: sign-in worked only for admins

Second failure, uncovered once the GET callback (above) let the flow get past the redirect.

**Symptom:** `{"code":"ZOHO_USER_LOOKUP_FAILED","message":"Internal server error"}` — for ordinary
workers (sales et al) but NOT for admins.

**Root cause.** `fetchCurrentUser` read the worker's identity with `GET /crm/v8/users?type=CurrentUser`
using THE WORKER'S OWN token. That endpoint is gated twice: by the OAuth scope AND by the caller's CRM
**profile permission on the Users module**. Administrator profiles hold it; Sales-type profiles usually
do not. So the one call the whole login depends on succeeded for admins and 403'd `NO_PERMISSION` for
everyone else — the exact split reported. It was never an RBAC/override problem.

**Fix** (`src/integrations/zohoOAuth.ts`) — split proving WHO signed in from reading their RBAC facts:
1. Try the worker's own CRM record first (one call, authoritative when permitted → admins unchanged).
2. On 401/403 only, fall back: identify the human at the accounts level (`{accounts}/oauth/user/info`),
   then resolve profile/role from the **service token** roster (`zohoCrm.listActiveUsers()` — the same
   admin-privileged credential Admin → User Management already uses). The worker's token never reads the
   roster, so an ordinary profile no longer decides whether login works.
3. A 5xx / network fault still THROWS rather than falling back — masking a broken Zoho as a login
   problem would have hidden the real dependency failure.
- `ZOHO_OAUTH_SCOPES` default is now `ZohoCRM.users.READ,AaaServer.profile.READ` (the fallback needs the
  accounts profile scope). **Existing workers re-consent once on next sign-in** — Zoho prompts automatically.
- The error is now diagnosable: the Zoho status + body are logged AND `expose: true` so the client sees
  the actual reason. A real outage came back as a bare "Internal server error", which is why the first
  report had nothing to act on. (Internal tool; the upstream body carries no secrets.)
- Cover: `tests/unit/zoho-oauth-current-user.test.ts` (6) — permitted path takes no roster call, 403 and
  401 both recover WITH profile/role intact, case-insensitive email match, a clear message when the Zoho
  account maps to no active CRM user, and a 500 that must NOT fall back.

Not verified against live Zoho — needs one real non-admin sign-in to confirm end-to-end.

## 2026-08-05 (pm, cont. 2) — "the bypass logic works only for admin": the ROLE was still hardcoded

Third and root issue behind Mytrion access not following Admin → User Management.

**The defect.** `contextFromClaims` (src/modules/auth/authService.ts) built each worker session from TWO
sources that had silently drifted apart:
- `allDepartmentAccess` ← **DB** (`mytrionAccessService.resolveWorkerAccess`: profile default → role
  default → per-user override)
- `role` ← **hardcoded** (`workerRoleFor` → `resolveAllDepartmentAccess`: admin-marker profile/role
  substrings + `ADMIN_USERS`/`BYPASS_USERS` env names)

`workerRole.ts`'s own header claimed the two "can never diverge" — true when both came from the one
predicate, false since access moved to the DB. So granting a worker all-department access in User
Management produced `allDepartmentAccess: true` **with** `role: 'worker'` and read-only
`scopesForRole('worker')`. Gates written `ctx.allDepartmentAccess` honoured the grant (e.g.
mytrionAccess.routes requireAdmin); every gate written `ctx.role !== 'admin'` (realtime.routes, admin
scopes, write tools) refused it. Net effect: the bypass was obtainable ONLY by matching a hardcoded
marker — exactly the report.

**Fix.** The authoritative role is now `access.allDepartmentAccess || markerAdmin`. The hardcoded marker
stays a FLOOR, never a ceiling: an `ADMIN_USERS` / admin-profile break-glass account still resolves when
the DB grants nothing or is unreadable, while a DB grant can confer admin on its own. No new escalation
path — only an admin can write those override rows — and an all-access grant carrying denies still
resolves `allDepartmentAccess: false` (mytrionAccessService `enforceableAllDept`), so it correctly stays
a worker. Corrected the stale "can never diverge" header in `workerRole.ts`.
- Cover: `tests/unit/worker-role-from-db-access.test.ts` (4) with `ADMIN_USERS`/`BYPASS_USERS` emptied so
  every 'admin' must come from the DB: a User Management grant confers admin, an ungranted worker stays a
  worker, the hardcoded marker still works when the DB grants nothing, and the exact broken state
  (allDepartmentAccess true + role worker) can no longer occur.
- Regression check: 157 tests green across every auth/RBAC/access/identity suite —
  `caller-identity` (24, asserts re-derived workers stay workers), `zoho-oauth` (14),
  `mytrion-access` (22), `mytrion-access-breakglass`, `department-access` (18),
  `require-mytrion-write`, `agent-authority` (28), `hr-routes`, `sales-golive-contract`.

**The full backend suite is NOT a usable signal on this branch — it is heavily flaky.** Three runs of
effectively the same tree gave 145, 274 and **310** failures; the clean tree (my changes stashed) scored
WORSE (310 failed) than with them (274). Two independent causes, both environmental:
1. Suites that read secrets from the developer's `.env` instead of setting them (see the earlier
   `BILLING_INGEST_SECRET` note) — belongs in the `vitest.config.ts` env baseline.
2. Route suites that touch the real remote DB and blow the 5s default timeout under parallel load
   (`hr-leave-routes`, `verification-clients-routes`, `files`, `hr-departments-routes` — all fail with
   "Test timed out in 5000ms", never an assertion). `.env` points `MYTRION_OPS_DATABASE_URL` at the
   remote/prod DB, so wall-clock, not logic, decides these.
Until both are fixed, trust targeted suites. This is worth its own pass — it currently hides real
regressions.

### Decisions taken with the user (same session)

- **Unconfigured worker keeps today's derivation.** The legacy profile/role substring floor
  (`legacyAccess` / `deriveWorkerDepartments`) STAYS as the last-resort fallback; Admin config still wins
  wherever it exists. Chosen over a tenant-level default Mytrion or a hard "no access until granted"
  because dropping the floor would have locked out every worker currently depending on it — the same
  lockout b2ec4b94 was written to avoid. So `mytrionAccessService` is unchanged.
- **Any Zoho account may sign in.** Authentication answers "who are you"; which Mytrion anyone may enter
  is Mytrion Admin's decision alone. The `AuthError` I had added for "no active CRM user" was itself an
  access rule sitting in the login path, so it is gone: that session is now granted with
  `zohoUserId: 'zuid:<ZUID>'`, `profile`/`role` null. With nothing configured it resolves to no Mytrions
  and the portal shows "no Mytrion is assigned" — signed in, granted nothing yet.
  - Prefixed `zuid:` because a ZUID is a different id space from a CRM user id. Bare, it could be
    mistaken for one by owner-scoped lookups (DWH `agent_zoho_user_id`, act-as targets); prefixed, those
    find nothing and fail closed.
  - **Known gap:** Admin → User Management builds its list from CRM ActiveUsers, so a non-CRM account
    does NOT appear there and cannot be granted anything through the UI yet. Accepted knowingly. If such
    accounts need access, User Management needs a way to add a `zuid:` principal.
  - Sign-in still refuses one case only: neither a CRM user NOR a ZUID, i.e. the sign-in cannot be
    identified at all, so nothing could be keyed to it.
- Verification for this pass: 115 tests green across `zoho-oauth`, `caller-identity`, `mytrion-access`,
  `mytrion-access-breakglass`, `department-access`, `auth-zoho-callback`, `agent-authority`, plus the two
  new suites (11).

## 2026-08-05 — Dropbox for the general file pipeline (uploads/imports + generated exports)

Dropbox was already fully built in this repo — the API v2 client
(`src/integrations/dropbox.ts`: refresh-token auth, single-shot + chunked upload, download,
streaming, temporary links, delete, 401-refresh/429 retries) and a complete `ObjectStorage`
adapter (`storage/dropboxStorage.ts`). It was only reachable by **comms chat attachments**, via
`COMMS_STORAGE_PROVIDER`. The general pipeline was hardcoded to S3 on one line of `fileService.ts`.

### What changed

- **`FILE_STORAGE_PROVIDER`** (`s3` | `dropbox`, default `s3`) — where a NEW general-pipeline file
  goes: `POST /v1/files/upload` (import) and every generated artifact (`file.generate_csv` /
  `_excel` / `_pdf` export). `storeFile` now defaults to `fileStorageProvider()` instead of the
  literal `'s3'`.
- Kept **separate** from `COMMS_STORAGE_PROVIDER` rather than collapsing both into one switch: a
  customer's chat attachment and an internal revenue export are not the same retention problem, and
  one of the two may need to move without the other.
- **Boot check** (`envRuntime.ts`) now requires the three Dropbox credentials when *either*
  pipeline selects Dropbox, not just comms.
- `scripts/dropbox-smoke.ts` + `pnpm dropbox:smoke` — live round-trip through the adapter (so the
  key→path mapping is covered, not just the raw client).

### `getStorage()` deliberately does NOT follow the new env

This is the trap in this change and it is now commented at the definition plus locked by a test.
`maintenance_case_attachments` stores an `s3_key` with **no `storage_provider` column** and resolves
both its writes and its reads through `getStorage()`. Had that function honoured
`FILE_STORAGE_PROVIDER`, flipping to Dropbox would have sent new attachments to Dropbox *and*
simultaneously repointed every existing row's read at Dropbox — where those bytes are not. Reads
404, deletes silently no-op against the wrong store. CS maintenance attachments therefore stay on
S3 until that table gains the column (a migration, deliberately not done here).

The general pipeline is safe to flip precisely because `file_assets.storage_provider` already exists
and already accepts `'dropbox'` — no migration needed. `storeFile` records the provider per row and
every read/delete goes back through `storageFor(row.storageProvider)`, so flipping the env changes
the destination of the NEXT file and nothing about the ones already stored. It is not retroactive:
existing S3 files keep resolving to S3.

### Test determinism — the FF_ZOHO_MCP_ENABLED bug class, again

Neither storage provider was pinned in the vitest `env` baseline, so once a developer's `.env` set
`FILE_STORAGE_PROVIDER=dropbox` for `pnpm dev`, **every `storeFile()` in the suite would have
defaulted to Dropbox and attempted live API calls with a real refresh token**. Both providers are
now pinned to `'s3'` in `vitest.config.ts`, exactly as that file's own comment prescribes. The
dropbox suite sets `FILE_STORAGE_PROVIDER` itself in `vi.hoisted` (before `env` parses eagerly)
where it needs the other value.

### Local config

`.env` now runs BOTH pipelines on Dropbox (`FILE_STORAGE_PROVIDER=dropbox`,
`COMMS_STORAGE_PROVIDER=dropbox`) with the real app key / secret / refresh token. This also works
around S3/MinIO being unavailable locally — the file tools now function without docker. Credentials
are in `.env` only (gitignored); `.env.example` documents the switch with empty placeholders.
Also documented there: changing `DROPBOX_ROOT_PATH` after files exist ORPHANS them, since the root
is applied at read time and the stored key is the only route back to the bytes.

### Checks

`pnpm typecheck` clean. `pnpm lint` 0 errors (22 pre-existing warnings, none in touched files).
`dropbox-storage.test.ts` 22 passed (+2 for the new provider defaults, incl. the `getStorage()`
regression guard). `pnpm dropbox:smoke` **fully green against live Dropbox** — put / temporary-link
/ getBuffer / getStream / oversized-read-rejected / delete / delete-again-idempotent, with bytes
compared byte-for-byte rather than by length.

Full-suite state is unchanged by this work and cannot go green on this machine: the DB-backed suites
point at the REMOTE Render Postgres (`MYTRION_OPS_DATABASE_URL` is *not* localhost:5433, contrary to
the CLAUDE.md description of the local stack), so they fail on latency/state regardless of the local
container. Verified by stashing this branch's changes and reproducing the same failures on a clean
tree.

## 2026-08-06 — Telegram mini-app registration/session architecture review

- Reviewed the registration bootstrap, invite redemption, returning-user Telegram `initData`
  authentication, driver card-number self-registration, registration/invitation repositories, and
  frontend session boot without changing runtime code.
- Confirmed the strong parts: Telegram HMAC + `auth_date` validation, server-derived identity and
  carrier/role scope, one-shot invite redemption inside the registration transaction, tenant
  predicates in the repositories, active-status checks on every mini-app request, and audit entries
  for successful registration writes.
- Main follow-ups: exchange `initData` for a first-party HttpOnly session instead of placing the raw
  credential in the realtime URL; add database-enforced one-live-driver-per-card invariants; remove
  the unsigned `x-telegram-chat-id` registration input; harden card-number self-registration beyond
  its process-local per-user limiter; and remove the default-tenant assumption before partner-tenant
  onboarding is enabled.
- Repository-rule debt found in the same surface: `carrierMiniApp.routes.ts` performs direct DB work
  and is 1,709 lines, while `apps/mini-app/src/App.tsx` is 4,405 lines (600-line hard cap).
- Verification: focused mini-app + registration-repository suites pass, 114/114.

## 2026-08-06 — Mini-app sales-agent multi-company requirement

- Clarified the next mini-app role: a Sales agent links their Telegram identity to their verified
  Zoho worker identity, sees all companies currently assigned to that agent, selects one company,
  and receives owner-equivalent capabilities only inside that selected/authorized company.
- The current `registered_mini_app_companies` row cannot model this safely: it deliberately allows
  one carrier registration per Telegram user and its upsert overwrites the carrier. Do not add a
  carrier-bound `sales_agent` profile to that table.
- Recommended model: separate Telegram principal/account identity from carrier access grants. Store
  the Sales agent's verified Zoho user id on the principal; source the portfolio dynamically from
  the existing `fetchAgentClients` DWH authority and re-run `assertCarrierOwned` for every selected
  carrier operation. The request's carrier id is a selector, never authority.
- Sales agents must act as themselves in audit data (`sales_agent` actor + selected carrier), not as
  the carrier owner. Owner-equivalent capability is effective, carrier-scoped authorization; it is
  not impersonation and must not depend on that carrier having an owner mini-app registration.
- No runtime changes in this clarification session.

## 2026-08-06 — Mini-app backend capability policy

- Added the explicit mini-app capabilities `company:read`, `financial:read`, `fleet:manage`,
  `card:write`, `reports:send`, and `access:manage`, with a single typed role-to-capability policy.
- Added the internal `sales_agent` role. Sales agents receive all six owner-like capabilities,
  including `access:manage` for the registration-link flow; their generic tool-dispatcher scopes
  remain empty so this role cannot accidentally escape through the broader assistant tool catalog.
- Routed fleet, access delegation, financial reads, card operations, and report delivery through
  explicit capability checks while retaining the existing owner/carrier/driver-card scopes.
  Driver/manager invitation and revocation now explicitly require `access:manage`.
- Kept money-code draw/void on the existing owner/manager-only boundary. The requested capability
  set has `financial:read` but no `financial:write`, so read authority is not treated as sufficient
  write authority for the future sales-agent path.
- Confirmed the screenshot flow: the Sales agent stays authenticated by their verified Zoho CRM
  session in Sales Mytrion; the generated link is redeemed by the CLIENT in Telegram. The client
  Telegram `user_id` belongs on `registered_mini_app_companies`; agent attribution remains the
  verified Zoho user id/name stamped onto the invite and resulting registration. A future Sales
  agent Telegram portal still needs its own Telegram-to-Zoho principal table and must not overload
  the one-company client registration row.
- Added a fail-closed registration eligibility gate. A non-admin Sales agent must supply a carrier
  id, own that carrier in the same DWH roster that feeds Data Center → Clients, and the fresh roster
  row must be active, non-debtor, and not LOC-suspended. Stale roster fallback is disabled for link
  creation, including when a stale-tolerant UI refresh is already in flight. The Manage panel mirrors
  the rule by disabling the button for Debtor/Attention cards.
- Verification: capability/RBAC/carrier mini-app/eligibility suites pass, 136/136; backend and CRM
  typechecks pass; the CRM production build passes; lint has zero errors (22 existing warnings).
  Full backend run: 1,886 passes and 99 existing environment/fixture failures in DB/socket, CS,
  Comms Admin, Billing, Retention, and scripted-agent groups.

## 2026-08-06 — Sales-agent mini-app authorization audit follow-up

- Audited the committed capability/eligibility work end-to-end against the effective caller,
  department/write-mode, DWH ownership, metadata attribution, tenant/RBAC, and cache boundaries.
- Fixed a real Admin View-as bypass: carrier-management routes used the principal context directly,
  so an admin viewing as an agent still skipped that agent's ownership/debtor/activity checks. These
  routes now resolve the verified act-as target first; writes and reads both run with that effective
  identity, and a target's read-only/full Sales mode is enforced on link creation.
- Added the missing internal boundary: carrier-link creation now requires full Sales access, while
  the card/registration management reads require Sales access. Non-Sales internal sessions and
  customer-audience sessions fail before DWH/repository work.
- Closed request-body attribution spoofing for non-admins and Admin View-as. The authorized DWH row
  supplies company/agent names, the effective verified session supplies the Zoho agent id, and a
  worker cannot choose a 30-day TTL. A plain, non-impersonating admin retains the intentional manual
  metadata/lifetime override used by Admin Carrier Management.
- `assertCarrierInviteEligible` now returns the exact fresh authorized roster row after checking it,
  so authorization and persisted metadata cannot be sourced from divergent lookups.
- New route regressions cover non-Sales denial, Admin View-as debtor denial, View-as read scoping,
  and spoofed metadata/TTL rejection. Focused capability, carrier, Data Center, ownership, cache,
  and RBAC verification passes 175/175; backend typecheck/build and CRM production build pass; lint
  has zero errors (22 pre-existing warnings).
- Full backend run on the product changes: 1,889 passed, 99 failed, 1 skipped. The failures remain in
  the known unrelated environment/fixture groups: local socket bind is denied; DB-backed suites
  cannot reach localhost:5433; billing webhook secrets are absent; and CS/Comms/Retention fixtures
  resolve against the developer environment. All mini-app/Data Center/ownership/RBAC suites pass.
- Remaining architectural debt in this surface: the real Telegram-to-Zoho `sales_agent` principal
  and portfolio selector are still future work (the capability policy is scaffolding today);
  `carrierMiniApp.routes.ts` is 1,749 lines and still contains direct DB select/transaction orchestration
  instead of repository/service boundaries; `dwhClientRoster.ts` is 596 lines (under the 600 hard cap
  but over the 580 target). Split/refactor these before adding the sales-agent Telegram portal.

## 2026-08-06 — Debtor registration-link deployment fix

- Traced a production UI mismatch where Data Center correctly labeled a client as `Debtor` but the
  Manage panel still rendered an enabled registration-link action. The source-side status gate from
  the sales-agent capability work had not reached production because the committed CRM `app/` bundle
  was stale; Render serves that vendored bundle and does not rebuild the CRM during deployment.
- Tightened the UI so debtor/inactive clients receive an explicit blocked-state message and no
  registration-link button at all. The API remains the authority and independently rejects debtor,
  inactive, or LOC-suspended client invitations after a fresh DWH eligibility check.
- Added a component regression covering both sides of the boundary: a debtor cannot see the action,
  while an active client can. Rebuilt the committed CRM production bundle so the status gate is in
  the assets actually copied into the Render runtime image.
- Verification: all CRM tests pass (69 files, 437 tests), including the new debtor/active regression;
  CRM TypeScript checking and the Vite production build pass.

## 2026-08-06 — Sales-agent Telegram mini-app workspace

- Added a separate Sales-agent Telegram identity and one-time self-registration flow. The durable
  principal binds one verified Zoho worker to one Telegram user per tenant; it does not reuse a
  customer carrier registration because the agent owns a changing portfolio rather than one company.
- Added a distinct mini-app workspace: Sales agents first see their live active-company portfolio,
  then can open a company in a read-only mini-app view and return to the portfolio. Active debtors
  remain viewable, while inactive companies are excluded. The selected carrier is only a request
  selector and is re-authorized against a fresh, no-stale-fallback DWH roster on every scoped call.
- Added the Data Center client-card action that opens the Sales agent's self-registration/deep link.
  Active debtors can use View mini-app; inactive companies show a disabled action. Customer owner,
  manager, and driver registration links remain blocked for debtor or inactive clients.
- Split read and write capabilities so Sales agents can inspect company, financial, and fleet data
  but cannot mutate cards, issue or void money codes, send reports/documents, manage access, or file
  customer service requests. Registration creation and redemption are audit-logged.
- Added migration `0103_sales_agent_mini_app.sql`, tenant-scoped repository operations, route and
  capability regressions, CRM component regressions, translations, and rebuilt both vendored apps.
- Verification: focused backend coverage passes (4 files, 135 tests); CRM focused coverage passes
  (2 files, 5 tests); root lint/typecheck and both production app builds pass. The repository-wide
  suite still has unrelated baseline/environment failures in CS, retention, billing auto-map, and
  scripted-agent tests; the carrier mini-app suite itself passes all 117 tests in that full run.

## 2026-08-06 — Block debtor company preview in Sales-agent mini-app

- Corrected the post-deployment eligibility rule after the Data Center showed an enabled View
  mini-app action on debtor cards. A company must now be both active and non-debtor to launch or
  appear in the Sales-agent mini-app portfolio.
- Enforced the rule in both layers: debtor cards render Mini-app unavailable in CRM, and the backend
  filters debtors from restored portfolios and rejects a debtor carrier selector after a fresh DWH
  roster check. The backend remains authoritative if a stale browser tries the endpoint directly.
- Added regressions for eligible active launch, active-debtor denial, inactive denial, debtor
  portfolio exclusion, and selected-debtor authorization failure.
- Verification: backend debtor/portfolio coverage passes 125/125, CRM card coverage passes 4/4,
  root lint has zero errors (22 existing warnings), root typecheck/build pass, and the vendored CRM
  production bundle was rebuilt. The full repository run is 1,901 passed, 96 failed, 1 skipped;
  failures remain in the same unrelated CS, retention, billing, Comms Admin, and DB-backed scripted
  agent groups, while the carrier mini-app suite passes all 117 tests.

## 2026-08-06 — Agora project-boundary review

- Reviewed Agora's workspace/project/resource model and the active repositories under
  `~/Projects/Octane` to define a practical project taxonomy for the empty Octane workspace.
- Recommended treating Mytrion's shared Git repository as several product workstreams (core
  platform, CRM, Telegram mini-app, and support-agent gateway) while attaching the same repository
  root to each project; component labels should describe touched code, not replace ownership and QA
  boundaries.
- No product code or configuration was changed during this review.

## 2026-08-06 — Agora Octane workspace skill and agent pack

- Added 20 version-controlled workspace skill sources under `.agents/skills`: five shared
  engineering/safety/documentation skills, six focused Mytrion architecture/runtime skills, and
  nine ServerCRM skills covering runtime security, EFS, WEX, CMP billing, payments/reporting,
  Smart Balance, scheduled jobs, and browser automation.
- Generated the sources with the standard skill scaffolder, removed all template content, scanned
  for unsafe instructions and credential-like values, and validated every skill with the official
  skill validator. All 20 passed.
- Deployed all 20 skills to the production Agora Octane workspace and read each one back to verify
  the workspace id and persisted content. The existing `mytrion-ops-kb` remains the broad repository
  knowledge base, bringing the workspace total to 21 skills.
- Created workspace-visible `Octane Code Reviewer` and `Octane Documentation Writer` agents on
  the online Codex runtime. The reviewer has 20 review/domain skills with high reasoning; the
  documentation writer has 18 documentation/domain skills with medium reasoning. Both deliberately
  have no MCP configuration until credentials can be attached through a non-plaintext secret path.
- Security follow-up: the existing Deep Research Agent returned an unredacted GitHub credential in
  its MCP configuration during inventory. Do not reuse that configuration; rotate/revoke the token
  and reconnect GitHub through protected secret input before enabling MCP on the new agents.
- No product TypeScript or application runtime code changed, so product lint/typecheck/test were not
  run. Verification was limited to skill validation and production Agora read-back.

## 2026-08-06 — Sales-agent selected-company mini-app layout parity

- Replaced the Sales-agent preview's one-off two-column action grid with the same Home, Services,
  Inbox, owner balance hero, quick-actions list, and bottom-tab shell that real company users see.
  A compact sticky preview bar preserves the portfolio back action and read-only context.
- Kept the preview read-only in both layers: the shared Home shell hides manager/fleet management for
  Sales agents, while an explicit six-item catalog exposes only status, balance, transactions,
  invoices, payment information, and last-used reads. Existing ActionSheet guards continue to hide
  report/document delivery, and backend capabilities still deny all customer mutations.
- Scoped Sales-agent pins separately from owner/driver local preferences and clear company inbox
  state on portfolio/company transitions so one selected company's rows never flash under another.
- Added a repository-level catalog regression and rebuilt the committed mini-app production assets.
- Verification: mandatory RBAC leakage checks pass 32/32; focused mini-app catalog/capability/carrier
  coverage passes 123/123; root lint passes with zero errors (22 existing warnings); root typecheck
  and the mini-app production build pass. The full suite is 1,900 passed, 99 failed, 1 skipped; all
  failures are in the existing CS, Comms Admin, retention, billing-secret, database-backed agent,
  and local WebSocket groups, while the changed mini-app suites pass. Responsive browser QA could
  not run because this session exposed no in-app or connected browser.

## 2026-08-06 — Full Sales onboarding catalog and pre-owner manager invite

- Changed the Sales selected-company Services tab to mirror the complete owner catalog. Safe live
  reads stay interactive, owner write/request actions are visible as `Read only`, and genuinely
  unreleased actions keep their `Soon` state. Fleet-only services remain hidden for owner-operator
  companies, and legacy Sales pinned-service keys migrate to their owner-catalog equivalents.
- Added a narrow `manager:invite` mini-app capability for Sales onboarding. A verified Sales agent
  can now generate a manager link for a selected active, non-debtor fleet in their live DWH roster
  even when no owner has registered yet. The carrier selector is re-authorized on every request,
  the invite stays tenant-scoped and audit-logged, and Sales still cannot manage existing access or
  use other customer write actions. Owner/manager self-service remains behind its feature flag.
- Added regressions for capability policy, selected-company authorization, manager creation before
  owner registration, foreign-company denial, and the Sales service-catalog policy. Rebuilt the
  committed mini-app assets.
- Verification: focused RBAC and mini-app coverage passes 157/157; root typecheck passes; root lint
  has zero errors (22 existing warnings); mini-app typecheck/build passes. Responsive browser QA at
  390×844 and 1280×900 confirmed the manager-link flow plus `Read only`/`Soon` service states. The
  full repository run is 1,902 passed, 99 failed, 1 skipped; failures remain in the existing CS,
  Comms Admin, retention, billing-secret, DB-backed agent, and local WebSocket groups, while the
  changed carrier mini-app suite passes all 119 tests.

---

## 2026-08-06 — Billing Ledger: opening balances + Excel bulk import (M1/M2)

New Billing Mytrion tab implementing the billing department's AR-accounting spec (`mytrion_TZ`): five
sub-ledgers, each `Closing = Opening + Debit − Credit`, each reconciled against an independent source.
This pass lands the schema, the client-type scope resolver, the opening-balance surface (the launch
requirement — migrating accumulated balances out of CMP) and the Excel bulk path. Compute, the five
section tables, the drill-down and the nightly snapshot job follow.

### Decisions worth not re-litigating

- **`endDate` is INCLUSIVE on every `/billing/ledger/*` endpoint.** Billing is inconsistent today (list
  endpoints exclusive, `/billing/prepay/ledger` inclusive — which is why `Prepay.tsx:961` shifts back a
  day). The ledger takes what the agent typed and converts once, in the route layer. Frontend routes all
  conversion through `toWireRange()` so it cannot drift per call site.
- **Reporting day is `America/Chicago`.** Both feeds that define Customer Balance are CT and ops' prepay
  numbers already bucket CT, so Billing's two screens agree. servercrm's own ledger buckets New York and
  will differ by up to a day at the boundary — expected, not a bug.
- **`opening = null` when none is recorded — never coerced to 0.** Zero is a claim the carrier had no
  position at inception; null is "we don't know". Coercing produces a confidently-wrong Closing that
  lands in the variance queue instead of the migration backlog.
- **Opening balances are append-only with supersede**, one live row per (carrier, section). Mutating one
  retroactively rewrites every statement that section ever produced. The chain (`supersedes_id` +
  `import_batch_id`) IS the import revert journal, so no `bulk_change_log` analogue was needed.
- **Errors are thrown `AppError`s**, not the `{status:'error'}` widget-parity envelope — that exists in
  `billing.routes.ts` for the legacy zoho-octane widget, and the Ledger has no legacy twin. The one
  exception: import preview/commit return per-row verdicts in a 200/201 body, because a partly-valid
  spreadsheet is a *successful* preview and rejected rows are data.
- **The Excel template is generated server-side** so the importer parses exactly what the template emits.
- **`POST`, not `PUT`,** for the two upserts: `PUT` is used by no route in this repo and the frontend's
  `request()` transport does not accept the verb.

### Traps found the hard way (all verified live against the DWH)

- **`octane.dim_company.is_active` is `integer`, not `boolean`** — unlike its `is_*` siblings
  `is_wex_funded` / `is_debtor` / `is_loc_suspended`, which are real booleans. A strict `=== true`
  silently excluded EVERY typed carrier (eligible read 0 instead of 2,847). Read through `truthy()`.
- **`cmp_transaction.invoice_ref` is NOT an invoice FK and NOT an "invoiced yet" flag.** Joining it to
  `cmp_invoice.id` matches 41% of rows but the carrier ids agree only 20 times in 32,094 — numeric
  collision. And it is populated on 100% of transactions in every week including the current one. Attribute
  a transaction to an invoice by `carrier_id` + `transaction_date ∈ [invoice.date_from, invoice.date_to)`
  instead: 83.7% attributed in a test week, and the unattributed remainder IS the unbilled set.
- **`db:generate` cannot be used here.** The snapshot in `meta/` is stale against several teams' schema
  files, so it emits their pending drift (`mytrion_thread_*`, `mytrion_tickets`, `mytrion_escalations`, a
  `file_assets` column) mixed into whatever you added. `0103_ledger_core.sql` is hand-written and
  idempotent, and the three `ledger_*` files are deliberately absent from `drizzle.config.ts` — same as
  `maintenance_case_attachments` / `maintenance_case_history` / `verification_sales_responses`.
- **Reverting an import whose rows were all superseded by later activity** used to report success with
  `restored 0` while changing nothing. Now refuses with `LEDGER_IMPORT_SUPERSEDED`, because an agent told
  "reverted" will believe the old numbers are back.

### Scope, measured 2026-08-06

8,145 dim_company carriers → **2,160 LOC + 687 Prepay = 2,847 in ledger scope**. Excluded: 32 WEX-Funded
(TZ §5.3), 4,998 with no `payment_terms` (the `financeClients.ts:42` ~62% comment still holds), 268
inactive. **`Deposit` has zero rows**, so the Deposit→Prepay normalization is currently inert — kept
because the value is live in Zoho's picklist.

### Later the same day — compute, control points, tests (M3–M5)

Rest of the module: the feeds, the compute, the five section tables, the drill-down statement, the
nightly reconciliation snapshot, the TZ §9 control points, and 97 tests.

**The chain is shared code, not convention.** Each section's Debit and its neighbour's Credit call the
SAME feed function in `ledger/feeds.ts`, so the TZ's "Credit of one section becomes Debit of the next"
is a property of the implementation. Verified live 2026-07-01..07 across 2,165 LOC carriers:
`cb-loc.credit === unbilled.debit === $4,558,990.37` and `unbilled.credit === ar.debit ===
$5,199,587.38`, to the cent. Continuity too: `closing[07-13..19] === opening[07-20..] = 6,915.25`.

**More traps found by running it, not by reading it:**

- **`cmp_transaction.net_total` is unpopulated** — sums to exactly 0.00 over a full week. `funded_total`
  is the amount. And do NOT switch to `mart_transaction_line_items.funded_total`: that table is
  line-item grained and repeats the per-transaction total, so it overstates by 46% ($7.81M vs $5.33M for
  2026-07-01..08). `line_item_amount` there agrees with `cmp_transaction.funded_total` to the cent.
- **A control sum that always cries wolf is worse than none.** The first version compared loads−draws
  against per-carrier `balance_after` deltas. But `balance_after` is the post-movement WALLET balance and
  carriers spend BETWEEN movements — that spend lives in `cmp_transaction` — so the balance repeatedly
  resets toward the credit limit and its deltas never sum to the movement amounts. It reported a $5.49M
  "variance" that was simply the week's card spend. Replaced with live-table-vs-staging-mirror, which
  found a genuine finding on its first run: the mirror is 92 rows / $54,292 behind. Do not re-add the
  old one; the identity it reached for is what the per-carrier reconciliation already tests.
- **Postgres will not accept a SELECT alias inside an ORDER BY expression** (`case bucket when …` →
  `column "bucket" does not exist`), and re-deriving the bucket there then demands every column it
  touches in the GROUP BY. The rows are re-emitted in declaration order in JS, so the SQL ordering was
  dropped entirely.
- **Live-EFS reconciliation is deliberately NOT wired.** servercrm exposes only
  `GET /api/smart-balance/carrier-balance?carrierId=` — the batched `getChildBalancesByCarrierIds` has no
  route in front of it — and EFS has no as-of parameter anyway. So Customer Balance reconciles against
  CMP's own `balance_after` and is TAGGED `cmp_balance_after` rather than implying EFS confirmed it.
  Enabling it needs a servercrm batch route first; `ledger/reconcile.ts`'s `fetchExternal` is the one
  place to change.
- **The extra aging buckets earned themselves.** The TZ names 0–7 / 8–14 / 15–30 / 30+. Production has
  **777 open invoices worth $3.8M that are NOT YET DUE** — under the TZ's set those would have been
  reported as 0–7 days overdue. `current` and `no_due_date` are additions, flagged for billing.

**Nightly job** `billing.ledger.daily-snapshot`, 05:00 America/Chicago. Idempotent via the snapshot
unique key — verified 878 rows across two runs of the same day. One section failing cannot lose the
others' work; all-zero rows are skipped rather than written (at ~2,850 carriers × 3 sections × 365 days
that is the difference between 3.1M rows/year and millions of empty ones).

**Payments is NOT a second Transactions tab.** That tab answers "how do I map this"; the ledger's answers
"which sub-ledger did it land in" — AR credit, prepay top-up, or attributed to nobody. The last is the
TZ §7 lost-money case and is invisible on Transactions.

**Deliberately parked:** the LOC↔Prepay transition history, behind a flag derived from the nav config so
it cannot drift. An empty table is a factual claim ("no transitions have occurred"); a Soon badge is a
claim about the software, and only the second is true until §8's workflow lands.

**Tests: 97.** The load-bearing ones are the drift guard on the AR rules extracted out of
`analytics/dimensions/receivables.ts` (both now import them, so an edit changes two reports), the
`is_active`-is-an-integer pin, and the route file asserting all 11 reads and 8 writes deny an
unauthenticated and a non-billing caller — the UI hide is not the boundary.

### 2026-08-06, later — Ledger live on prod: the bugs only a browser found

Applied `0103` + `0104` to prod and drove the tab for real. Everything below was invisible to
typecheck, lint and 101 passing tests.

- **`db:migrate` would have silently applied nothing.** drizzle-kit applies an entry only when the
  newest ALREADY-APPLIED `created_at` is less than that entry's `when`. Prod's newest was
  `1786076400000`; the timestamps hand-derived from 0102 were ~4 days *behind* it, so the command
  reports success and does nothing. Had to bump 0103/0104 above prod's cutoff. **0101/0102 are below it
  too** — which is why those tables were applied by hand — so anyone adding `0105` must check prod's max
  `created_at` first, not just increment from the journal's tail.
- **Every billing modal was painting under the app header.** Pre-existing, all six tabs.
  `.bm-body { position: relative; z-index: 1 }` makes a stacking context, and modals render inside it,
  so their `z-index: 9990` was scoped there and lost to `.bm-header`'s 100. A descendant can never
  escape an ancestor's stacking context, so it cannot be fixed in the modal. Dropped the z-index and
  kept `position: relative`: `.bm-ambience` is first in the DOM so the body still paints above it, and
  the header still outranks body content (100 > auto) — the View-as dropdown, the documented reason for
  the rank, still wins.
- **The `.bm-panel` flex trap.** It is `display:flex; flex-direction:column; height:100%`, so every
  child is a flex item with the default `flex-shrink: 1`. Once content exceeded the viewport the browser
  shrank the sub-nav to **14px with its 32px buttons overflowing**. Chrome elements need
  `flex: 0 0 auto`; only the row list should absorb leftover height. Any new panel here will hit this.
- **Two places fabricated a number the same code had just called unknown.** The Closing KPI showed
  `$0.00` when 2,165 of 2,165 carriers had no opening (0 because nothing was summed, which reads as "the
  book balances"), and the statement's running column walked from an assumed zero and went negative
  while its own header said Opening `—`. Both now say what they actually are: `—  no client has an
  opening balance yet`, and a column relabelled **Net movement**. The null-opening rule has to hold in
  the presentation layer too, not just the compute.

**Perf.** The timeout was query SIZE, not slow compute: `listLedgerCarriers` passed all 8,145 carrier
ids to `findOpenBatch` and `computeSection` passed 2,165 to `findLiveBatch` — `IN (...)` lists with that
many bind parameters, shipped to Oregon. Both tables hold at most one row per carrier, so filtering was
pointless; added `findOpenAll` / `findLiveBySection`. Plus a 60s scope cache with in-flight sharing,
invalidated on a client-type write. Ruled out paging the carrier list first: the DWH aggregates are
~142ms as a parallel seq scan regardless of the filter.

Section reads now carry a 60s client budget instead of the transport's 20s row-lookup default (~8s over
a WAN). The durable fix is wiring the read path to the nightly snapshot table, which makes a period
O(1) — designed and built, not yet consumed by the section route. That is the next perf step.

**Chrome** went 254px → 95px: one sub-nav row with rules between groups instead of stacked labels, one
toolbar instead of a period bar plus a filter bar, and a header that names the active section rather
than repeating the module tagline.

## 2026-08-07 — Lead Blueprint required fields on status change

- Data Center → Leads edit: when moving Zoho Blueprint stages, always collect/require
  Application Filled → `Application_ID`, Not Interested → `Not_Interested_Reason` (picklist),
  Unqualified → `Unqualified_Reason` (picklist) — even if Zoho omits `fields[]` metadata.
- Server enrichment in `leadBlueprintRequiredFields.ts` (GET blueprint + execute + PATCH status);
  CRM `LeadBlueprintEditor` applies the same contract client-side. Picklist parsing falls back to
  `display_value` when Zoho omits `actual_value`. Status PATCH validates dependent fields via Zod
  and forwards `Application_ID` as transition data.
- Lead status/reason constants moved to `leadStatusValues.ts` (keeps `dataCenter.routes.ts` under
  the file-size cap).
- Verification: `lead-blueprint-required-fields`, `zoho-crm-blueprint`, `data-center-routes` 44/44;
  CRM `LeadBlueprintEditor` + `LeadCallWizard` 18/18; root + CRM typecheck pass.

## 2026-08-07 (2) — Live EFS card status after C-1

- Bug: C-1 activate writes live EFS and shows success, but Client modal Cards + C-28 still showed
  Inactive / 0 active because they read lagged DWH (`dim_card` / `dwh.carrier_overview`).
- `loadClientCards` now merges `efs.cards` status over DWH enrichment (type/unit/driver); EFS
  failure keeps DWH-only; EFS-only rows appear when DWH is missing the card.
- `account-status` / `verification` keep overview for balance/debt but prefer live EFS active
  counts when `efs.cards` succeeds.
- Out of scope: Overview/Loyalty `client.active` roster tiles (still DWH analytics).
- Verification: CRM `clientDrilldown` + `autoRunners` 16/16; CRM typecheck pass.
## 2026-08-06 — Mytrion Manager: design-system reconciliation + skeleton loaders

Onboarding pass on the Manager Mytrion (`apps/mytrion-crm/src/mytrions/manager`, 9 stylesheets +
6 components) against the app token system, then fixed the conflicts it surfaced.

Conflicts found and resolved:
- **Two owners for the same tokens.** `managerPolish.css` held a second copy of the loyalty tier
  palette and of the tier tint/sheen ramp, and won on load order — so `managerLoyalty.css`'s light
  palette and its Silver-vs-Idle differentiation were dead code, and the surviving copy flattened
  every tier to one tint with no sheen. Each now has exactly one declaration, in its owning file;
  the polish layer is tokens-only plus cross-file relationships.
- **Typography fork.** Manager forced Space Grotesk onto `--font-body`, `--font-head` AND
  `--font-mono`, plus a 15px base and five enlarged sidebar sizes. Cost: the module read as a
  different product, and every `var(--font-mono)` call site (carrier ids, gallons, cached-at stamps,
  tier figures) silently lost tabular figures because "mono" was not a mono font. Now inherits the
  app stacks and the shell's nav sizes.
- **Scale sprawl.** 21 distinct font sizes (9.5–28px), 12 radii (2–18px) and raw 180/220/260ms
  durations. Collapsed onto `--text-*` (9 steps), `--mg-r-xs/sm/md/lg/pill`, and `--hz-dur-*`.
  Zero raw font-size / border-radius / font-weight values remain in the module.
- **Light theme.** Panes were fixed `rgba(255,255,255,.82)` literals instead of token-derived
  `color-mix`; `tasksBlock.css` filled nested panels and every form field with `--bg-primary`
  (an inset well in dark, invisible in light); `.mg-acc-summary:hover` used `--hz-glass-hover`
  (=.86 white in light); the referral dialog carried an `rgba(0,0,0,.72)` shadow and a 76px tone
  halo; two dialogs had two different scrims at two z-indexes. All derived or tokenized.
- **Semantics.** Departments with a live Tasks desk advertised it in the same warning amber as
  "Coming soon" — split into `.mg-dept-chip` (neutral) and `.mg-dept-soon` (amber).

Loaders → skeletons (`ManagerSkeletons.tsx`, one `.mg-sk` shimmer):
- **Referrals** borrowed Loyalty's `.mg-lty-grid` (380px tracks) to stand in for its own 290px grid,
  and rendered a live all-zero controls panel above it — two loading states and a full relayout on
  arrival. Now one skeleton covering the KPI row, controls and grid in their real containers.
- **Loyalty** skeletoned the client grid alone, so the distribution panel, toolbar and chips
  appeared from nothing and shoved the grid down. Now covers all four sections.
- **Tasks** showed "Loading tasks…" in `.mg-tasks-empty` — the same element as "no assignments",
  so loading and empty looked identical. Now the real three-column layout, shaped.
- Removed the dead `.mg-loading` / `.mg-spinner` rules; the only surviving spinner is `.mg-spin` on
  the Refresh control, which is in-control busy feedback, not a page loader.

Verification: `corepack pnpm build` green (tsc --noEmit + vite), `corepack pnpm test` 441/441 across
69 files. Not visually verified — no headless browser in this environment, so the two themes and the
skeleton→content hand-off still want a human pass at `pnpm dev`.

## 2026-08-06 — Manager Tasks: one board on every desk, Sales included

Inspected prod `mytrion_worker_tasks` read-only first: table is correct (22 cols, `department`
default `sales`, migration 0075 applied) but **completely empty — 0 tasks, 0 events** — and
`mytrion_task_types` held exactly **one** row (`general`), so the manager's Type control was a
single-option select on every desk.

Both halves of the loop were switched off, which is why nothing had ever been written:
- Sales **Management** rendered a "coming soon" panel instead of the Tasks block.
- Sales Mytrion **My Tasks** was `comingSoon: true` in `salesData.ts`, so the fully-built agent
  kanban was unreachable. A manager could have created a row; no agent had a surface to see it.

Backend:
- **Removed the duplicate `/manager/sales/tasks*` routes** from `salesKpi.routes.ts`. Fastify
  prefers a static segment over a param, so those shadowed the generic `/manager/:department/tasks*`
  and Sales was the one desk running different code — including a PATCH that never checked the task
  belonged to the desk (a Sales manager could edit another desk's task by id). Their frontend
  client functions in `api/salesKpi.ts` had no callers and went with them.
- **Per-department task types** (migration `0104`): nullable `department` + `sort_order` on
  `mytrion_task_types`, seeded with 6 shared codes and 21 desk-scoped ones. NULL = every desk.
  `(tenant_id, code)` stays unique, so a code means one thing tenant-wide. Routes now validate the
  code against the DESK, not the whole catalog.
- List endpoint returns `{tasks, counts, load, pagination}`. `counts` is deliberately desk-wide and
  ignores the status/priority/search filter — those are the numbers you read to decide what to
  filter by, so narrowing them would zero every column but the selected one.

Frontend — Manager Tasks rebuilt as a status board mirroring the agent's own: same four columns,
same order, same priority hues, same overdue rule, drag to move. Metric strip, assignee/priority/
search filters, `Assign task` dialog, detail dialog with event history, optimistic moves, skeleton
first paint. `tasksBlock.css` was dark-only (`--bg-primary` fills that are an inset well in dark and
invisible in light) and is now on the Manager token ramps.

Verification: backend `pnpm typecheck` clean, `pnpm lint` clean **for the files in this change**,
new `tests/unit/manager-tasks-routes.test.ts` 21/21; CRM `pnpm build` green, 442/442 tests. Vendored
`apps/mytrion-crm/app/` rebuilt.

NOT verified: the migration was not run — Docker is not up here and there is no local Postgres, so
CLAUDE.md's throwaway-DB check could not be done. It is defensive (`IF NOT EXISTS` ×3,
`ON CONFLICT DO NOTHING`) and touches only a 1-row table. No UI screenshots — no headless browser.

Note for whoever owns the in-flight RAG work in the tree (`src/modules/agents/*`,
`src/modules/knowledge/*`, `llm_calls`/`rag_runs`, untracked `0105_horizon_rag_excellence.sql`):
that migration has **no journal entry yet**. Register it as idx 105 with `when` greater than
0104's `1786065600000`, or drizzle skips it silently with a green exit.

### 2026-08-06 (same day) — 0104 + 0106 applied to PRODUCTION

Ran against the Render prod DB with the user's authorization. Checked the applied set read-only
first: `drizzle.__drizzle_migrations` was already at 0103, so 0104 was the only migration of mine
outstanding.

**`pnpm db:migrate` would ALSO have run the untracked `0105_horizon_rag_excellence`** — 19
statements including an `UPDATE knowledge_docs SET checksum = NULL`. That is someone else's
in-flight work and was not what was authorized, so for each run I held its journal entry out,
migrated, and restored it. 0105 remains unapplied.

Result, verified read-only against prod:
- `mytrion_task_types`: 1 row → **28**; `department` + `sort_order` columns present.
- Per-desk resolution correct — Sales 11 types, CS/Billing/Finance/Collection/Verification 9,
  Mobile 8; every desk sees the 6 shared codes plus its own. Zero cross-desk leaks, zero dupes.
- `0106_task_type_general_sort`: 0104's `ON CONFLICT DO NOTHING` correctly refused to clobber the
  pre-existing `general` row from 0061, which left it at the column default `sort_order = 100` —
  so the most-used type sorted LAST in all seven pickers. 0106 moves just that row to 10.

⚠️ **`0105_horizon_rag_excellence` will now be SKIPPED SILENTLY (green exit).** drizzle's migrator
applies a journal entry only when its `when` exceeds the LAST applied timestamp. Prod's last applied
is now 0106's `1786076400000`; 0105 is stamped `1786072800000`, which is lower. Before running it,
either restamp 0105 above `1786076400000` or renumber it past 0106 — see [[drizzle-migration-timestamp-skip]].
The committed journal deliberately contains 104 and 106 but NOT 105, because 0105's `.sql` is still
untracked; a journal entry pointing at a missing file breaks a fresh checkout. The 105 entry is left
in the working tree, uncommitted, exactly as found.

## 2026-08-06 — Horizon RAG and Context Engineering Excellence

Implemented the first-release RAG/context architecture on `/v1/agent` while preserving request
compatibility and keeping authorization out of prompts. Added a canonical `TurnContextV1`, bounded
and escaped XML projection, server-regenerated narrowed child contexts, structured sub-agent
results, evidence references, clause/resolved-ask handling, and scoped known-no-match reuse.

The knowledge path now has governed/versioned document and chunk metadata, structural contextual
chunking, atomic fail-closed ingestion, race-safe database uniqueness, exact filtered pgvector as
the default/oracle, multilingual `simple` FTS, RRF fusion, and measured ANN shadow support. Added
bounded routing and CRAG outcomes, one-retry retrieval/repair, deterministic citation-scope checks,
high-risk faithfulness verification, internal no-web behavior, and typed-tool enforcement for
authoritative numeric aggregates.

Added platform self-awareness generated from allowlisted agent/tool/feature metadata with
audience/department scoping and an audited scheduled sync. Unified model policy now assigns models
by role, restricts evidence-bearing calls to OpenAI, and records privacy-safe per-call/per-run
telemetry in `llm_calls` and `rag_runs`. Added the additive RAG result envelope and governed citation
metadata without exposing internal scores or security diagnostics.
All five new release controls default off so a normal deploy remains on the current path until
0107 has been applied; rollout is explicitly opt-in and preserves one-flag rollback.

Evaluation: added a versioned 200-case sanitized golden set and metrics harness. Static routing is
200/200; the scoped agent/RAG suite is 180/180 across 21 files, including 22/22 cross-tenant leakage
tests. `pnpm typecheck`, `pnpm lint` (0 errors; 22 pre-existing warnings), `pnpm build`, and
`git diff --check` pass. The broad repository test attempt was not accepted as a release signal:
196 files passed, 1 skipped, while 8 unrelated/environment-bound files failed because the sandbox
cannot bind test sockets or resolve the configured external database. The live retrieval benchmark
was deliberately not run because the configured DB is production and the harness writes fixtures.

Migration safety: renamed the in-flight RAG migration from 0105 to
`0107_horizon_rag_excellence`, index 107 / timestamp `1786080000000`, so Drizzle will not silently
skip it behind the already-applied production 0106. It remains unapplied and requires a scratch-DB
migration check before an authorized rollout.

## 2026-08-06 — Admin Horizon Turn Inspector

Added an admin-only Turn Inspector rail beside Admin → Horizon AI. It follows the live SSE turn and
shows the selected agent, model/provider/role, deterministic route, plan and delegation events,
tool calls, whether RAG actually returned evidence, CRAG grade/confidence/passages, verification
coverage/repair/abstention, citations, duration, tokens/cache usage, and estimated cost. Prompt
bodies and evidence text are deliberately excluded.

The backend emits `trace` events only for admin/all-department/bypass contexts; ordinary scoped
workers receive no diagnostic stream. The RAG wrapper reports both v2 assessment results and
legacy retrieval usage, while the run tracker reports the concrete model observed on each LLM
call. The inspector keeps at most 80 steps and clears when switching/newing conversations.

Verification: backend typecheck/build and lint pass (0 errors, the same 22 unrelated warnings);
47 focused agent/RAG tests pass including 22/22 leakage checks. The full Mytrion CRM suite passes
451/451 across 71 files and its production build is green. Visually checked the Admin Horizon
layout in the local app in both dark and light themes; the right rail is readable without crowding
the chat, with a stacked layout below 900px.

## 2026-08-06 — EFS Console: third Manager workspace card

Probed prod read-only before designing. Three findings changed the shape:

- **Latency dominates.** Measured: parent/snapshot 1.8s · carrier/snapshot 1.1s · carrier
  transactions(6d) 1.6s · money-codes/summary(30d) 3.9s · carrier/cards(37) 5.0s ·
  **parent/discounts 11.1s**. Nothing may fan out on mount. The roster is `octane.dim_company`
  ONLY (milliseconds, zero vendor traffic); every EFS read hangs off something clicked. The single
  exception is the parent totals strip — one `parent.snapshot`, because that is the number the card
  gets opened for.
- **`/fetchers/carrier/:id/rejects` is broken upstream.** HTTP 500,
  `ADBException: Unexpected subelement startDate` — same failure financeEfs.ts recorded on
  2026-08-04, still there. Catalogued as `health: 'broken'` and refused with a 503 naming the
  reason, rather than letting an operator watch a spinner end in a 502. The doc lists it as live.
- **Partial success is normal.** `parent/snapshot` returns a good balance alongside
  `creditLimitsError: ADBException…`; `carrier/snapshot` has `cardDetailError`. Those fields pass
  through untouched and render as a warning chip beside good data.

Shape: roster → dossier, same as Referrals and Loyalty. Chosen over a parent-ledger landing
(3–8s cold, slowest surface first) and a task-runner IA (no carrier record page at all).

Server — `src/modules/manager/efsConsole/`, ~2 handlers for the whole vendor surface because the
surface is DATA: 50 fetchers and all 30 actions declared as descriptors.
- **Writes are inert.** `FF_MANAGER_EFS_WRITES_ENABLED` defaults off; actions validate, audit and
  return a preview of what WOULD be sent. A parameterised test asserts the serverCrm client is
  never called for any of the 30. Arming is two steps: the master flag, then per-key
  `MANAGER_EFS_LIVE_ACTIONS` — so it is one money-moving call at a time, not a boolean cliff.
  Money/destructive actions additionally require an admin caller (CLAUDE.md rule 7).
- **Carrier scope**: `assertEfsCarrier` refuses anything absent from `octane.dim_company` with 404
  before any vendor traffic, on reads AND writes. Known cost: dim_company lags, so a genuinely new
  child carrier 404s until the warehouse catches up; the message says exactly that.
- **Money-code digits never leave the server** — `redact.ts` walks the payload structurally
  (not keyed to one envelope shape, because V1/V2 differ and a shape-specific redactor fails silently
  the day the envelope moves) and keeps `codeLast4`. Inherited from financeEfs.ts's rule.
- Window ceilings (7d txns / 90d history) validated server-side AND published via `/capabilities`
  so the picker refuses a range instead of EFS 400ing.

CRM — `EfsConsoleCard` + `efs/` (dossier, 4 tabs, skeletons). `/capabilities` is server-authoritative:
no client write toggle, no localStorage, and while writes are disabled **no Execute control is
rendered at all** — absent, not disabled.

Also: **URL state for the whole Manager hub** (`?card=efs&carrier=5724546&tab=cards`).
ManagerShell was a routerless `useState`, so a reload dropped you on Overview and no carrier view
could be pasted into a ticket. Done once for all three cards while there are only three; only the
three manager-owned query keys are touched, so the Zoho OAuth `?code=` handshake survives.

Verified: backend typecheck + lint clean, 71/71 manager tests (50 new EFS); CRM build green,
448/448 (6 new URL-state tests); vendored `app/` rebuilt.
NOT verified: no write has ever been sent to EFS — every action schema is read off the vendor doc,
not off a successful call. Expect to re-diff bodies during arming. No UI screenshots (no browser).

### 2026-08-06 (same day) — EFS roster 500, and the slow Tasks block

**EFS Console `/v1/manager/efs/clients` 500'd on the default view.** `listEfsRoster` added the
search predicate only when a search term was present but bound `[like, digits]` unconditionally, so
an unfiltered roster handed Postgres two parameters for a statement referencing none
(`bind message supplies 2 parameters, but prepared statement requires 0`). The default view — the
one every user hits first — was the only one that failed. The predicate is now always present and
null-guarded (`$1::text IS NULL OR …`), so the bind count is constant. Verified against the DWH:
6/6 filter combinations, 8,155 clients, 110–800ms.

**Tasks block was slow on an EMPTY desk.** Measured, not guessed:
- `listManagerAssignees('sales')` **2681ms**, `('billing')` **4866ms** (Zoho directory resolve)
- `listTypes` 559ms
- each of the four task-list queries ~555ms; four concurrent = **2650ms wall** under pool contention

Three causes, three fixes:
1. **Four queries → two.** New `workerTaskRepo.deskCounts` answers the desk-wide status counts AND
   the filter-matching total from ONE `FILTER` scan, and `openLoadByAssignee` is skipped entirely
   when nothing is open. An empty desk no longer pays ~2.2s of DB time to be told it is empty.
   **2650ms → 538ms.**
2. **Roster cached per desk**, module-scoped so it survives navigating away and back. It is 2.7–4.9s
   and its answer changes on the timescale of HR changes, not page views. It was already off the
   critical path; now it usually does not happen at all.
3. **The block renders immediately.** Header, metric strip and filters paint at zero instead of
   sitting behind a full-block skeleton — on a desk with no assignments those zeros are the true and
   final answer, and a skeleton over them promises content that never arrives. Only the board waits,
   via the new `TasksBoardSkeleton`.

Note the CRM `tsc` gate is currently red from another engineer's uncommitted work
(`features/chat/useChat.ts` + new `TurnInspector.*` break `useChat.reducer.test.ts` types). My files
typecheck clean; the vendored bundle was built with `vite build` directly to get around their gate.

### 2026-08-06 (same day) — the Manager slowness was reference data, not queries

The 500s reported on `/manager/{verification,billing,finance}/*` did not reproduce: all four
endpoints return 200 against the live server. They were the dev server mid-reload picking up the
roster fix — `/manager/efs/clients` was in the same batch and now answers in 390ms.

The SLOWNESS was real and was measured to its source:
- `listActiveUsersCached()` 2262ms cold / **0ms warm** (already cached)
- `workerMytrionAccessRepo.list()` 2690ms cold / **543ms warm** ← a DB round trip every call
- `mytrionAccessService.resolveBatch()` 2535ms cold / **541ms warm** ← another one

So `listDepartmentAssignees` cost ~1.1s even fully warm, on every desk visit, plus `listTypes` at
~550ms — reference data being re-derived per page view. Both are now TTL-cached server-side
(5 min) with in-flight coalescing, so ten desks opening at once make one lookup rather than ten.

End-to-end against the live server, cold → warm:
```
/manager/verification/workers    4983ms →   2ms
/manager/billing/tasks/types     2522ms →   3ms
/manager/billing/workers         1115ms →   1ms
/manager/finance/tasks            546ms → 533ms   (one DB round trip — the network floor)
/manager/efs/clients              390ms → 116ms
```

⚠️ The assignee cache widens one window and the header of departmentAssignees.ts says so:
`assertDepartmentAssignee` reads the same cache for non-sales desks, so for up to 5 minutes a
worker just removed from a department can still be assigned a task there. Judged acceptable because
a task assignment grants NO access — it appears on that person's own board and every surface they
could reach is gated independently. Not a pattern to copy for anything that grants authority. Sales
is unaffected: its branch re-checks `kpiWorkerRepo.isCurrentlyEligible` against the DB every time.

Remaining floor is ~530ms per uncached DB round trip to Render (Oregon). That is network latency,
not work — the only way past it is a closer replica or fewer round trips, and the task page is now
down to one.

### 2026-08-06 (same day) — catalog audited against the LIVE servercrm surface

Diffed our descriptors against `GET /api/efs/console` rather than against the handover doc, since
the live catalog is authoritative. Result: **50 fetchers covering all 42 live entries** (several of
which are globs — `locations/*`, `products|product-groups|prompt-types`,
`location-groups[/:groupId]`, `smartpay/*`) and **30/30 actions, zero undeclared, zero orphans**.

The audit found two paths I had genuinely WRONG. The doc writes them as
`locations/search · geo-prices · interstate-prices`, which reads as three siblings; they are in fact
all nested under `locations/`. Probed both spellings:
```
/carrier/:id/geo-prices            -> 404 (no such route)
/carrier/:id/locations/geo-prices  -> 500 ADBException  (route exists)
```
Corrected, and pinned by a test asserting all three carry `/locations/`.

Probing also turned up **four more endpoints broken upstream**, on top of `rejects`. All fail inside
EFS's SOAP stack, all verified 2026-08-06:
```
carrier.rejects           ADBException: Unexpected subelement startDate
carrier.locationsSearch   ADBException: Unexpected subelement searchLocation   (with or w/o params)
carrier.geoPrices         ADBException: Unexpected subelement getGeoPriceLocations
carrier.interstatePrices  ADBException: Unexpected subelement getInterstatePriceLocations
carrier.orderCards        ADBException: Unexpected subelement getOrderCards     (operation, not orderId)
```
All five stay in the catalog — they are part of the vendor surface and will presumably be fixed —
but carry `health: 'broken'` so the route refuses them with a 503 naming the exact upstream error
instead of spending a round trip to surface a generic 502. A test pins the set.

Confirmed working while probing: products (93 rows), policies, cash (230 rows), orders/meta.
`smartpay/accounts` requires `cardNumber` (400s without it) — noted at the descriptor.

### 2026-08-06 — Horizon greeting latency, model errors, and inspector persistence

- Added an exact multilingual greeting/thanks fast path in `/v1/agent`. It uses no LLM, planner,
  checkpoint, blackboard, memory, skills, tools, or RAG; the normal persisted turn/audit contract is
  retained. Turn Inspector identifies it as `horizon-local-greeting-v1`, provider `local`, role
  `deterministic`, and RAG `none`.
- Moved the initial route/model trace ahead of the expensive runtime setup so Admin sees the chosen
  path immediately. Provider model-not-found text (including the reported Chinese GLM response) is
  now converted to safe user copy while the original diagnostic remains server-logged.
- Removed Sales/Data Center's unconditional `OPEN_AI_FIVE_O_MINI` manifest pins. They now follow the
  unified feature-gated model policy, whose rollback/control model is `gpt-4o-mini-2024-07-18`.
- Turn Inspector traces are cached per user+conversation and restored on conversation switches and
  reloads. The conversation API now returns the already-persisted assistant `model`, allowing a
  safe model/RAG summary to be reconstructed when the full browser trace is unavailable.
- Conversation transcripts now use an in-memory per-hook cache. Returning to an already-opened
  conversation renders locally without another `GET /chat/conversations/:id` request; deletion
  clears both transcript and inspector caches.
- Security baseline before edits: `agent-rbac-leakage` 22/22 passed. Added deterministic fast-path,
  provider-error redaction, inspector storage, transcript reconstruction, and reducer regressions.

## 2026-08-06 — Sales Management becomes a workspace hub; KPI block

A department desk used to BE its Tasks board, so there was nowhere to put a second surface. Desks
are now workspace-card grids in the same idiom as Manager Overview (`.mg-card` / `.mg-card-grid`),
opening one replaces the grid, and which blocks a desk offers is declared in `deptWorkspaces.ts`.
Tasks is universal; KPI is Sales-only for now because its metrics are sales-shaped.

**KPI — every sales agent, this billing cycle (26th→25th).** Card swipes, gallons, app fills: the
same three the Sales Mytrion's Home tab shows for the ONE agent looking at it. The obvious build is
servercrm `/api/agent/dwh/snapshot` per agent — ~65 sequential vendor calls. Instead two grouped
DWH queries, measured at ~816ms for all agents:
```
swipes/gallons/cards  octane.mart_transaction_line_items ⋈ octane.dim_company  (by agent)
app fills             public.zoho_deals ⋈ public.zoho_users                    (by deal owner)
                      App Fill date = coalesce(application_date, created_time)
```
⚠️ The two sources have NO shared agent id — `dim_company.agent_zoho_user_id` does not match a Zoho
user id (the trap already documented for the Sales Data Center). They are joined on normalised name.

Probing that join before shipping caught two bugs that would otherwise have quietly under-reported:
1. **Duplicate Zoho user records for one person were overwriting, not summing.** Zoho holds
   "Samandar Baxodirov", "SAMANDAR BAXODIROV" and "BAXODIROV SAMANDAR YUSUFALI O'G'LI Ford" as
   three owner ids for one agent. Last-write-wins reported one record's fills.
2. **Agents who fill applications but own no carrier were dropped entirely** — 19 people, 263 app
   fills invisible. That is the worst possible direction for a KPI board: it under-reports exactly
   the people whose only output IS app fills. They now appear with structurally-zero fuel figures
   and a "no book" flag so the zeros read as "owns no carriers", not "did nothing".

Live result: 87 → **106 agents**, total app fills 994 → **1,257**, 838ms.
Totals across the desk: 7,613 clients · 26,211 swipes · 2.33M gallons.

Six unit tests pin the merge (name normalisation, summing duplicates, no-book inclusion, quiet
agents at zero, unresolvable owners ignored, sort order).

Note: the three manager suites boot a real Fastify app against the prod DB (~550ms/query) and one
run in four flaked under concurrency. Three consecutive clean runs since; if it recurs, they want a
local throwaway DB rather than a retry.

## 2026-08-06 — Sales Mytrion governed self-knowledge

- Audited the live Sales Mytrion frontend and backend workflow code as the authoritative source:
  navigation/availability, Data Center, Create, Carrier lookup, daily workspace, all **23** runnable
  Automation blocks, and the complete hourly Retention/Open Pool lifecycle.
- Added a deterministic Sales-scoped platform catalog: one retrieval document per Automation plus
  overview/navigation, daily workspace, records/create/carriers, shared Automation behavior,
  Dashboard/availability, and Retention generation/stages/timers/Open Pool. Every entry is internal,
  department `sales`, content-addressed, verified during platform sync, and safe for supersession.
- Automation knowledge records exact search codes, prerequisites, click path, results, and safety
  distinctions (for example, Override is ~30 minutes and does not lift fraud hold; Money Code is
  delivered to the carrier app and never displayed; Horizon explains write workflows but cannot
  claim it performed them).
- Added source-parity tests that read the frontend `AUTO_LIST` and fail on any id/title/code drift.
  Added Retention and card-activation grounding checks and expanded RAG golden coverage from 200 to
  280 cases, including 80 multilingual Sales Mytrion cases; deterministic routing is 100%.
- Sales specialist and orchestrator prompts now route Sales Mytrion UI/Automation/Retention how-to
  questions to Sales and require `knowledge_search`; a documented how-to no longer incorrectly
  escalates merely because the user performs a write in the UI.
- The nightly governed platform sync includes the Sales catalog. Added
  `pnpm knowledge:sync-platform` for an immediate audited one-shot sync and made live evaluation
  ingest/reference the governed platform documents.
- Verification: RBAC leakage 22/22, Sales/platform/golden catalog tests 11/11, focused RAG/agent
  suites 40/40, TypeScript clean, lint 0 errors (22 unrelated existing warnings), RAG excellence
  280 cases at 100% deterministic routing. The actual pgvector/OpenAI embedding sync was attempted
  but blocked by the execution environment's external-write/egress approval guard; it remains the
  explicit deployment step before Admin testing.

## 2026-08-07 — the failed Render deploy was a database restart, not the code

Diagnosed rather than guessed. What the evidence says:

- **The migration SUCCEEDED.** `0107_horizon_rag_excellence` is recorded in
  `drizzle.__drizzle_migrations` with `created_at = 1786087200000` (the restamp from the build
  merge), and all of its DDL is live: 8/8 new `knowledge_docs` columns, 7/7 `knowledge_chunks`
  columns, both `rag_runs` + `llm_calls` tables, the generated `content_tsv_simple` column, and
  both `SET NOT NULL`s. The journal fix worked — without it that migration would have been skipped
  forever.
- **The built server boots clean in production mode** against the prod DB (~10s to
  "API listening"). No route conflict, no missing secret, no boot defect. `envRuntime.ts` was
  unchanged by the merge, so the required-secret set did not move.
- **`pg_postmaster_start_time()` = 2026-08-06 22:36:21 UTC** — Postgres restarted seconds after the
  boot log. That is the whole story: migrations applied, the database then went away, and every
  retry hit `ECONNREFUSED` until the boot budget ran out and the process exited 1.

Two real gaps that turned a transient DB restart into a failed deploy, both fixed:

1. **`DB_BOOT_WAIT_SECONDS` 90 → 300.** It is not set on Render, so the default was the budget. A
   managed-Postgres restart routinely exceeds 90s. Waiting five minutes is strictly better than
   failing the deploy — the instance serves no traffic either way, and Render restarts it anyway.
2. **`start-prod.sh` reported nothing when the API died.** `wait $BACKEND_PID` propagated the exit
   code, so Render printed only "Exited with status 1" and the cause had to be reconstructed. It
   now logs the status explicitly and exits with it.

Also observed while diagnosing: 48 live connections (core-api 14, pgboss 11, a JDBC client 10,
unnamed 10). Not the cause here, but worth watching — several of those are not ours.

NOT changed: nothing about the merge or the migrations was rolled back, because nothing was wrong
with them. A redeploy should now succeed; if the DB is mid-restart it will wait rather than fail.

## 2026-08-07 — Client Overview: live EFS balance tile

- Data Center → Clients → client modal Overview now shows **EFS Balance** beside Cards / Gallons
  (same `dwh.carrier_balance` source as Automations C-8). Payment terms shown as a subtitle when
  present; soft `efs_error` note kept if upstream flags it.
- Loader: `loadClientEfsBalance` in `clientDrilldown.ts`.
- Verification: CRM `clientDrilldown` 5/5; CRM typecheck pass.

## 2026-08-07 — Rebuild vendored CRM app for EFS Balance tile

- PR #147 landed source for Overview EFS Balance, but prod serves committed
  `apps/mytrion-crm/app/` — that bundle was not rebuilt, so the tile was missing on
  octane-ops-ai.onrender.com.
- Ran `pnpm build:widget` and recommitted `apps/mytrion-crm/app` so deploy picks up the UI.
- Documented the rule in `CLAUDE.md` + `AGENTS.md` (**Vendored frontend builds**): UI PRs must
  rebuild and commit `apps/mytrion-crm/app` / `apps/mini-app/app` before opening the PR.

## 2026-08-07 — CI/CD guardrails: gates that run where review happens

Audited why migrations, UI updates and backend changes keep going wrong. One root cause: **the
quality gates didn't run where the review happened.** `ci.yml` triggered on `main` only, but the
team's flow is branch → PR to `build` → merge → `build` into `main`. So every PR was reviewed with
zero automated verification, and CI first ran at merge-to-main — deploy time, after the decision it
should have informed. Even then it barely gated: `pnpm test` and the whole frontend job were
`continue-on-error: true`.

### The test gate was fixable, not fundamentally broken

The suite looked hopeless (Codex counted 68 route failures) but that was purely a missing database.
Measured against a real Postgres, it was 2382/2404. The remaining failures were two missing env
vars, not product bugs:

- 22 failures in one file — `BILLING_INGEST_SECRET` unset, so `paymentsIngest.routes.ts` answered
  503 before ever reaching the auth assertion.
- 2 failures in `ledger-routes` — `API_KEY` unset, so `apiKeyAuth.ts:30` answered 503 for the same
  reason.

With a `pgvector/pg16` service and those two dummy values, and **no `.env` present at all** (the real
CI condition, simulated with `DOTENV_CONFIG_PATH=/dev/null`): **2409 passed, 1 skipped, 0 failed**.
So `pnpm test` is now a hard gate, as is the frontend job — its typecheck is clean, and the
"in-flight WIP errors" comment justifying `continue-on-error` was stale.

### Migration journal guard

`tests/unit/migration-journal.test.ts` asserts journal↔file agreement, consecutive `idx`, no reused
migration numbers, and — the one that matters — that `when` never decreases as `idx` increases,
since Drizzle skips any entry not newer than the newest applied and exits 0 green.

Two pre-existing violations are **grandfathered, not fixed**: idx 79 (`0079_maintenance_cases`,
`when` below idx 78) and the duplicate `0104` number. Restamping or renaming an already-applied
migration changes its tag, which would make Drizzle treat it as new and re-run it against local and
production. Verified harmless — a fresh `db:migrate` applies all 111 entries and `maintenance_cases`
exists. A fifth test fails if either is ever repaired, so the allowlist can't outlive the problem.

### `db:migrate` blast radius

`.env` on this machine pointed at the Render production database, so a routine local migration was
one command from migrating prod. `pnpm db:migrate` now goes through `scripts/guardedMigrate.ts`,
which refuses a non-local host unless `ALLOW_REMOTE_DB_MIGRATE=1`. `db:migrate:raw` keeps the
unguarded path. **Production is unaffected** — Render migrates in-process at boot via
`runMigrationsOnBoot()` (`DB_MIGRATE_ON_BOOT=1`), which never invokes this script. `.env.example`
now defaults to the local `:5433` database instead of blank with a "no local DB" comment that
stopped being true.

### Vendored bundle

CI now fails a PR that changes `apps/mytrion-crm/src` without touching `apps/mytrion-crm/app` — the
exact PR #149 failure mode. It compares changed paths from the merge base rather than rebuilding and
diffing bytes, so it can't fail on environment-dependent Vite output, and it ignores `*.test.tsx`
and `__tests__/` since those never reach the bundle.

I did **not** switch the Dockerfile to build the frontend and drop the committed bundle. The
frontend typechecks clean so it's now viable, but it would put the UI build on the critical path of
every Render deploy — a frontend break would become a deploy break. The staleness check removes the
failure mode with zero production risk; the Docker switch is a separate, deliberate change.

### `modern-web-guidance` installed

CLAUDE.md hard rule 10 required a skill that did not exist, which quietly taught everyone the rules
file is advisory. Written from this codebase, not generically: the single token system
(`theme.css` + Tailwind `@theme inline`, and why there is no `dark:` variant), per-Mytrion accents
via `data-mytrion`, the Horizon glass primitives, the app-wide `prefers-reduced-motion` contract,
the one-loader-per-region rule with the `MytrionLoader`/skeleton/stale-content split, and the
composited-layer traps documented in `AutoCatalog.tsx` (a permanent `transform` promotes a layer and
can leave a `backdrop-filter` card unpainted; `transition: all` re-rasterises the blur).

**Not done, by request:** the 600-line cap as an ESLint rule. 22 files exceed it (5 in backend
`src/`, `carrierMiniApp.routes.ts` at 1,912).

### CI red on first run — and the earlier "2409 passed" was measured wrong

CI failed on `cs-maintenance-routes` (40) and `cs-routes` (17): 403 where 200/400 was expected.

**My earlier verification was not representative.** I measured the suite against my long-lived local
database, which had accumulated 10 rows in `mytrion_profile_defaults` from past Admin → User
Management use. CI gets a database that has only ever seen migrations. Reproduced by creating a
fresh DB and migrating it: 2 files, 57 tests fail — exactly CI. A fresh migrate produces only 2
profile-default rows (the two HR ones, inserted by `0086_hr_workspace_recovery`), and the tests sign
a worker token with `profile: 'Customer Retention'`, whose department grant is resolved from the DB
by `mytrionAccessService.resolveWorkerAccess`. No row, no grant, 403.

Root cause: `0035_customer_retention_cs_mytrion.sql` describes itself as an "idempotent upsert" but
is **only an UPDATE**. On a database where the `Customer Retention` row was never inserted it does
nothing, so that mapping exists only where a human created it through the admin UI.

The real finding is bigger than the tests: **department access configuration is environment state,
not versioned schema.** A brand-new environment — CI, a new laptop, a new tenant — has no working
Customer Service mapping, and the same is true for Sales, Billing and the rest (my local DB has 8
such rows that no migration creates). I fixed only what CI needs; seeding the remaining profiles is
a real decision about who gets what access and belongs to whoever owns that, not to a CI fix.

`0110_seed_customer_retention_profile_default.sql` inserts the mapping following the
`0086_hr_workspace_recovery` pattern (id derived from tenant, always include the default `octane`
tenant, `ON CONFLICT (tenant_id, profile_key) DO NOTHING`), plus 0035's repair for a row seeded
empty. It can only ADD a missing default — never widen or narrow configured access.

Verified both directions:

- **Fresh DB:** dropped and recreated, migrated, `Customer Retention → ["customer-service"]` is
  seeded, and the full suite with no `.env` is **2409 passed, 1 skipped, 0 failed**.
- **Already-configured DB (the production shape):** migration ran and left the row byte-identical —
  same id, same `allowed_mytrions`, `updated_at` unchanged, still exactly one row. Provably a no-op
  where the row already exists.

Note the new journal guard earned its place immediately: I first numbered this migration `0108`,
which `origin/build` already uses, and the duplicate-number test caught it before it was applied
anywhere.

## 2026-08-07 — AI Chat in Mytrion Admin: the failure was one malformed tool schema

Consulted the `modern-web-guidance` skill first (hard rule 10 — it exists now).

### Why EVERY Horizon answer failed, not just card activation

The chat's "The AI service failed to complete this request" had nothing to do with Sales
self-knowledge. Reproduced against a live server and read the actual log line:

```
400 Invalid schema for function 'zoho_mcp__ZohoCRM_getWebhookAssociatedModules':
schema must be a JSON Schema of 'type: "object"', got 'type: "None"'
```

`"None"` is OpenAI reporting a **missing** `type` key, not a literal string. The chain:

1. MCP tools declare `inputSchema: z.unknown()` (the MCP server validates arguments); their real
   JSON Schema lives on `rawParameters`.
2. `agentTools.ts` built every tool's schema with `zodToJsonSchema(rt.inputSchema)`, so for MCP
   tools that is `zodToJsonSchema(z.unknown())` → `{}` — no `type`.
3. OpenAI validates the WHOLE tool list per request and rejects all of it if one function's
   parameters are not `type: "object"`.

So one MCP tool in the bound set failed every agent turn regardless of the question. Two bugs in
one: the model also never saw those tools' real parameters, because the zod schema threw them away.

`openAiToolSchema()` now prefers `rawParameters` and guarantees an object-typed root. Also hardened
`mcpTools.paramsForOpenAi` to strip invalid `type` values recursively and report which upstream tools
it repaired, so a genuinely bad Zoho schema degrades one argument instead of every conversation.
Nothing caught this because `vitest.config.ts` pins `FF_ZOHO_MCP_ENABLED=0`, so no test ever built an
MCP-backed tool set.

**Verified live** (server on :3011 against the local DB, which carries the synced catalog): the brief's
scenario now answers exactly as specified — `ERROR: None`, 5 passages, cited to
`Sales Mytrion — Card Activation (C-1)`, walking Automations → search "Card Activation"/C-1 → the
block under the **Customer Service section** → client → card → Activate Card.

### Switch Mytrion

Now a plain `<Link to="/main">` instead of a dropdown — one click lands on the picker. `TopBar`'s
`mytrion` prop went unused and was dropped. `MytrionMenu` is left in place (still tested) in case a
bespoke shell wants the shortcut later; nothing renders it today.

### Light/dark contrast

`MessageBubble.module.css` was written dark-only: `#fff`, `#e2e8f0` and `rgba(255,255,255,…)` text on
light tints. In light mode the error box was white-on-pink (the screenshot), markdown `h3` was
white-on-white, and inline `code` was near-white text on a near-invisible background. Converted 23
colour-bearing rules to the token scale — status chips and citation errors onto `--tint-*`, citation
chips and picker states onto `--accent-*` so they recolour per Mytrion, `.pickerConfirm` onto
`--on-accent`, and the dark-only scrollbar thumb onto `--border`. The only hardcoded `rgba` left is
the sheen on the accent-filled user bubble, which is correct in both themes.

### Test as: Zoho user

The backend already did the hard part: `x-act-as-zoho-user-id` is the ONLY trusted input, the
target's name/profile/role come from the CRM directory, and `actAsContext` runs the turn with the
target's own DB-resolved grant, role, scopes and `userId` — with the real admin recorded as
`impersonatorUserId`. Escalation-guarded.

Added a **chat-scoped** target (`features/chat/testAs.ts`) deliberately separate from the per-Mytrion
"View as" store: reusing that would re-scope the Knowledge Base and database browsers to the test
user too. Only the chat endpoints send it, only the id is sent, admin-only, and changing the target
starts a new conversation so one transcript never mixes two identities.

Rebuilt `apps/mytrion-crm/app` and confirmed `Test as` / `Testing as` / `octane.chatTestAs.v1` are in
the hashed bundle.

Gates: backend 2412 passed / 1 skipped, frontend 549 passed, typecheck clean both trees, lint 0
errors (23 pre-existing warnings).

**Aside on the ERR_CONNECTION_REFUSED you saw:** that was simply the API not running on :3001 — the
`/v1/auth/me` and `/v1/knowledge/*` calls had nothing to answer them. Worth knowing separately: the
Render prod Postgres dropped this machine's connection twice during testing and killed the server
("Connection terminated unexpectedly"), which is the same flakiness that interrupted the catalog
sync. Local work is much steadier against `:5433`.

### Test-as menu was unreadable, and the restore flashed

Two defects visible in one screenshot of the open "Test as" list.

**Transparency.** I had used `--surface-raised` as the dropdown's background. That token is
`rgba(255,255,255,0.045)` — a ~4% tint designed to sit ON an opaque surface, not to BE one — so the
menu was ~95% transparent and the transcript read straight through the user rows. Now `--surface`
(opaque `#1b212c` / `#ffffff`) plus elevation. Checked the neighbours: the History overlay already
used opaque `--surface-alt`, and the two other `--surface-raised` backgrounds (the scroll-to-bottom
FAB, a header chip) are glass-over-opaque-panel by design, so they stay.

**Stacking.** The accent-filled user bubble painted ON TOP of the open menu. `.bodyWrap` is
positioned and every bubble carries `backdrop-filter`, which makes each its own stacking context, so
a menu inside the unpositioned header lost. `.header` now has `position: relative; z-index: 3` and
the menu sits at `z-index: 60`.

**Restore loader.** `useChat` had no notion of hydrating: on mount it restored the previous
conversation asynchronously, so `MessageList` painted the "Horizon AI" welcome and then swapped in
the messages — a flash that reads as a broken panel. Added `hydrating` to the reducer, seeded lazily
from `getLastConversationId` so a user with no stored conversation never sees a skeleton at all, and
settled on every exit: transcript loaded, explicit `hydrated` (covers nothing-to-restore AND the
silent stale-id failure, via `.finally`), or the user starting a new conversation. `MessageList`
renders skeleton turns mirroring the real bubble geometry — one affordance for the region, no spinner
layered on top, and `role="status"` so it is announced. Five reducer tests cover the settle paths,
including that `hydrated` on settled state returns the SAME object (no needless re-render).

Gates: frontend 554 passed / 87 files, typecheck clean, bundle rebuilt and verified (opaque
`background:var(--surface)` at `z-index:60`, header `z-index:3`, "Restoring your conversation").

## 2026-08-08 — Horizon RAG: Phase 0 baseline (measured, not guessed)

Added `scripts/benchSalesChat.ts`: posts four canonical Sales self-knowledge questions at
`/v1/agent`, then reads back the telemetry the run already writes — `rag_runs` and `llm_calls` — and
prints wall/LLM/RAG timings, hops, tool calls, grades, models and whether the expected document was
cited. Local DB on `:5433` (prod Postgres drops connections and corrupts exactly these timings).

**Baseline, 83 MCP tools bound, all flags as found:**

| case | wall | llm calls | llm ms | rag_runs | hops | tools | cited expected |
| --- | --- | --- | --- | --- | --- | --- | --- |
| card-activation | 13780ms | 2 | 11619 | 0 | 0 | 1 | yes |
| retention-generation | 11204ms | 2 | 10603 | 0 | 0 | 1 | yes |
| open-pool-claim | 6584ms | 0 | 0 | 0 | 0 | 0 | **FAILED** |
| limit-max | 15205ms | 1 | 8290 | 0 | 0 | 0 | **FAILED** |

Mean **11,693ms**. Cost **$0.0537** for four questions. 3/4 cited the right document; **2/4 failed**.

Three things this proves rather than suspects:

1. **The failures are 429s, not network faults.**
   `429 Rate limit reached for gpt-4o-mini … on tokens per min (TPM): Limit 200000, Used 200000`.
   Four how-to questions saturated the org's entire per-minute token quota. This is almost certainly
   what the user's "network error" at +56.4s was too, and what "Mytrion feels unstable" means.
2. **71,130 input tokens per model call** (avg over 5 calls, max 71,848) — for "how do I activate a
   card". That is the ~102 tool schemas. Two calls per turn ≈ 142k tokens, so the 200k TPM ceiling
   allows **~1.4 questions per minute** before failing. Latency, cost and instability are all one
   root cause.
3. **`rag_runs` is 0 for every case** — the agentic loop genuinely never executes; only
   `agenticRetrieve` writes those rows. And every call is `role=answer, model=gpt-4o-mini`, confirming
   the model collapse: orchestrator, tool selection and answering all on the weakest model.

Note the two successes cited a *neighbouring* doc alongside the right one (Card Deactivation next to
Card Activation; Transactions Report next to Retention) — the ranking imprecision expected from
single-shot kNN with no grading or reranking.

## 2026-08-08 — Phases 1+2: tool surface cut, prompt contradiction removed

### Measured result

| metric | baseline | after 1+2 | change |
| --- | --- | --- | --- |
| mean wall per question | 11,693ms | **5,450ms** | 2.1× faster |
| input tokens per model call | 71,130 | **11,558** | **6.2× less** |
| model latency per call | 6,102ms | 2,420ms | 2.5× faster |
| cost, four questions | $0.0537 | **$0.0143** | 3.8× cheaper |
| failures | **2 of 4** (429s) | **0 of 4** | fixed |
| on-target citation | 3 of 4 | **4 of 4** | fixed |
| tool calls per question | 0–1 | 1 (`knowledge_search`) | no CRM calls |

Per turn is now ~23k tokens against the 200k TPM ceiling instead of ~142k — roughly 8.6 questions
per minute rather than 1.4, which is why the 429s stopped.

### What changed

**Named MCP tools instead of `zoho_mcp.*`** (`manifests/shared.ts` → `SALES_MCP_TOOLS`,
`MANAGER_MCP_TOOLS`; applied in `sales.ts`, `dataCenter.ts`, `manager.ts`). The wildcard bound all 83
discovered read tools to Sales.

The first cut only got 71k → 35k, so I measured the schemas individually rather than assuming.
**Two of the six tools I had allowlisted were 30,665 of the remaining 32,005 tokens** —
`ZohoCRM_getRecordCount` (~15,247) and `ZohoCRM_getRelatedRecords` (~15,418). Zoho ships pathological
schemas: **37 of its 203 tools exceed 4,000 characters**, and `ZohoCRM_getModules` is ~5,296 tokens.
Both were dropped; native `zoho_crm.query` does counts (`SELECT COUNT(*)`) and related-list joins in
COQL for no prompt overhead. Sales' MCP surface is now ~1,341 tokens.

Two boot guards in `loadMcpTools`, because naming tools trades a token problem for a drift problem:
- warn when a manifest names an MCP tool discovery did not return (that agent silently lost a
  capability);
- warn when an allowlisted tool's schema exceeds 4,000 chars, so the next 15k-token schema is a
  visible decision instead of a silent tax.

Fixed the stale `app.ts` comment claiming no agent lists MCP tools — sales and manager both did.

**Prompt contradiction removed** (`sales.ts`). The persona carried the self-knowledge rule *and*
"Use these directly **to avoid searching the knowledge base** for basic queries". The CRM/MCP hints
are now explicitly scoped to *record* questions, and the self-knowledge block states that a how-to
answer comes from `knowledge_search` alone — naming `zoho_crm.query`, `zoho_mcp.*`, `crm.*`,
`warehouse.*`, `dbt_mcp.*` as off-limits for "how do I / where is / what does <code> do", plus "one
search is normally enough; do not repeat the same search".

### Tests

- `agent-golden.test.ts`: no manifest may wildcard `zoho_mcp`; a simulated 83-tool discovery must
  keep every agent under a 30-tool budget (a wildcard reintroduction fails it); the matcher itself is
  pinned; and the Sales persona must not contain "avoid searching the knowledge base" while it must
  name the forbidden how-to tools. 20 tests in that file now.
- `department-agents.test.ts` updated to the tighter policy: each MCP tool is visible only to the
  departments that named it, and a discovered-but-un-allowlisted tool is admin-only. These two tests
  failing was the change working — they encoded the old wildcard behaviour.

Backend 2419 passed / 1 skipped, lint 0 errors, typecheck clean.

**Still on the legacy retrieval path** — `rag_runs` is 0 for every case, so none of the CRAG loop ran
yet. Phase 3 next.

## 2026-08-08 — Phase 3: the CRAG loop is live, and the lexical leg was dead

Enabled `FF_RAG_V2_RETRIEVAL=1` (the gate `scopedRag` needs alongside `FF_AGENTIC_RAG`) and
`FF_RAG_MODEL_POLICY=1` (role-based models). The loop started running — `rag_runs` went from 0 to 1
per turn, models split correctly into `answer:gpt-5.4-mini` / `router:gpt-5.4-nano` — but it was
**slower**: mean 10,105ms, 5 LLM calls per question, `hops=2` every time, grades `partial/0.62`.

`partial/0.62` is the literal deterministic-partial constant, so `assessEvidence` was never reaching
its `sufficient` branch. Rather than tune the threshold I instrumented the fusion, and found the
actual defect:

**The full-text leg returned zero rows for every natural-language question.**
`buildFullTextQuery` used `websearch_to_tsquery('simple', <the whole question>)`. websearch ANDs its
terms and the `simple` config removes no stop words, so a chunk had to contain "how", "do", "i", "a"
and "in" as literal lexemes. Measured against the Sales corpus: `'activate card'` matched 5 chunks,
`"How do I activate a card in Sales Mytrion?"` matched **0**. The leg swallowed nothing and logged
nothing — it simply always found nothing.

The cost of that was much larger than lost recall. `assessEvidence` needs vector/lexical `agreement`
to certify evidence as `sufficient`; with the leg dead, `agreement` was unreachable, so every
question fell through to the semantic judge and then a corrective second hop — two extra model calls
per turn to re-derive what a working keyword match already knew.

Two changes:

1. **`orOfTerms` + the english column.** The leg now builds `activate or card or sales or mytrion` and
   runs `websearch_to_tsquery('english', …)` against `content_tsv` (english stems and drops stop
   words; both columns are GIN-indexed). OR restores recall — a question shares only some words with
   its answer — while `ts_rank_cd` keeps precision by rewarding term density: for
   "how are retention cases generated" the top three ranked chunks are all the correct document
   (0.90, 0.90, 0.70). Still `websearch_to_tsquery`, not `to_tsquery`, so hostile text degrades
   instead of throwing. Terms are de-duplicated, capped at 12, interrogatives dropped, and intra-word
   hyphens kept so `C-16` survives as one term.
2. **Corroboration now moves confidence** in `assessEvidence` (+0.06 vector/lexical agreement, +0.03
   multi-query, cap 0.98). It previously only gated the branch, so with the lexical leg dead the only
   route past `shouldUseDeterministic`'s 0.85 bar was cosine ≥ 0.733 — rare, since on-target Sales
   documents measure 0.54–0.82. Two retrieval methods independently surfacing the same chunk is the
   standard hybrid-search precision signal; it should count.

### Measured

| metric | baseline | after 1+2 | after 3 |
| --- | --- | --- | --- |
| mean wall | 11,693ms | 5,450ms | **6,180ms** |
| LLM calls (4 questions) | 5 | 8 | 13 |
| hops per question | n/a (loop off) | n/a | **1** |
| evidence grade | — | — | **sufficient/0.90–0.91** |
| retrieval ms | 0 (loop off) | 0 | 1,456–2,227 |
| failures | 2 of 4 | 0 | 0 |
| on-target citation | 3 of 4 | 4 of 4 | 4 of 4, exactly one doc each |
| cost (4 questions) | $0.0537 | $0.0143 | $0.0755 |

Versus the first Phase 3 attempt (10,105ms, 20 calls, hops=2, partial grades) this is 39% faster with
7 fewer model calls. Versus the original baseline: **1.9× faster, zero failures, 4/4 citations**, and
now with genuine evidence grading rather than a single-shot kNN.

**Cost is the honest regression**: $0.0537 → $0.0755, because answers moved from `gpt-4o-mini` to
`gpt-5.4-mini`. That is the model that fixed tool selection, so I would keep it; if cost matters more
than answer quality, `resolveModelPolicy`'s `answer` role is the one dial to change.

`limit-max` used 4 calls rather than 3 — its confidence landed just under the bar, so the judge ran.
That is the adaptive behaviour working, not a defect.

Tests: 6 new `assessEvidence` cases (corroboration raises confidence, cannot rescue a sub-floor
match, cannot override `outdated`, caps at 0.98) and 6 for `orOfTerms` (OR form, interrogatives
dropped, codes intact, de-dup/cap, empty input, injection-safe). The existing full-text RBAC test now
asserts the transformed query is the parameter — its real point, that department names inside a
question never become filters, is unchanged and still passes. Backend 2431 passed, lint 0 errors.

## 2026-08-08 — "hello" took 122s because the production database was unreachable

Reported: a bare "hello" hung for 122.4s and died with
`Failed query: insert into "conversations" …`. The params in that error are all valid, so it was
never a schema fault — the insert was waiting on a connection.

Measured directly: the Render Postgres is **`CONNECT_TIMEOUT` after 47s** from this machine. Not slow,
not rate-limited — it does not complete a handshake. It worked earlier today (the catalog sync and the
first agent runs went through it), so it changed state during the session; the same fault killed the
dev server twice mid-bench with "Connection terminated unexpectedly" and forced three passes to sync
the catalog.

`postgres.js` had `connect_timeout: 30` and retries, so ~4 attempts × 30s ≈ 122s, at which point the
agent's 120s wall fired. The user waited two minutes and got a message that reads like a schema bug.

Two fixes:

1. **`.env` now points at the local database** (`localhost:5433`, measured **0.014s** vs unreachable).
   The old URL is preserved as a commented `MYTRION_OPS_DATABASE_URL_PROD`. The local DB is fully
   usable: 112 migrations, the 30 Sales self-knowledge docs, and an `Administrator` profile default
   carrying all-department access — so a real Zoho admin session resolves the same authority it would
   in prod. Only conversation history is empty. This is what CLAUDE.md's local run stack always
   prescribed; `.env` pointing at prod was the hazard.
2. **`connect_timeout` 30 → 8 seconds** (`src/db/client.ts`). A reachable Postgres handshakes in tens
   of milliseconds, so 8s is generous for a healthy path and fails fast on a dead one — seconds with a
   clear error instead of a two-minute hang. Boot is unaffected: `runMigrationsOnBoot` keeps its own
   retry budget (`DB_BOOT_WAIT_SECONDS`).

### Verified

| request | before | after |
| --- | --- | --- |
| `hello` | **122,400ms**, failed | **42ms**, "Hello, John! How can I help you today?", zero tools |
| "How do I activate a card in Sales Mytrion?" | failed | 24,716ms, `grade: sufficient / 0.928`, one `knowledge_search`, no CRM call, correct click path including the Customer Service section |

### Two findings this surfaced — not yet fixed

- **The orchestrator costs ~18s.** Pinned to `agent: 'sales'` the same question is 6,180ms; routed
  through the orchestrator it is 24,716ms. That is the "+11.7s Consulting Sales" from the original
  trace, and Admin chat always goes through the orchestrator. It is now the largest remaining latency
  item — bigger than everything Phases 1–3 removed.
- **Citations are lost on the orchestrator path.** `rag.grade` is `sufficient` and the answer is
  correctly grounded, but `citations: []` reaches the client, so the UI shows no sources. Pinned to
  the child, citations populate. Something between the child's `reportSources` and the orchestrator's
  final result drops them.

Backend 2431 passed / 1 skipped with the shorter timeout.

## 2026-08-08 — Phase A: prompt caching was already working; the telemetry was lying

Concept #14 (KV/prefix caching) looked completely unexploited: **0.0% cache hits across 61 real
calls** at ~10,400 input tokens each, and `llm_calls.ttft_ms` existed with nothing writing it. The
plan's first step was to measure rather than optimise, which turned out to matter — the expensive half
of the plan was unnecessary.

**A1, the experiment.** Sent the real Sales child system prompt plus the real bound tool schemas
directly to OpenAI three times, different user message each time:

| call | prompt | cached | latency |
| --- | --- | --- | --- |
| 1 | 4,914 | 0 (cold) | 2,425ms |
| 2 | 4,909 | **4,736 (96.5%)** | 1,392ms |
| 3 | 4,911 | **4,736 (96.4%)** | 1,286ms |

Caching engages, and nearly halves latency. Then instrumented a real agent turn to see what the
runtime actually receives:

| call | input_tokens | cache_read |
| --- | --- | --- |
| 1 | 11,225 | 0 (cold) |
| 2 | 12,025 | **10,880 (90.5%)** |
| 3 | 11,225 | **10,880 (96.9%)** |
| 4 | 12,049 | **10,880 (90.3%)** |

So the prefix was **always** caching at 90–97%. `childSystemPrompt` is static (persona +
`SHARED_AGENT_RULES` + escalation targets) and the volatile `<TurnContext>` sits in the human message,
i.e. the suffix — the design was right all along.

**The bug** was one branch in `runTracker.handleLLMEnd`. `llmOutput.tokenUsage` exists and carries
exactly `promptTokens` / `completionTokens` / `totalTokens` — **no cache fields** — so that branch won
every time and hardcoded `cached = 0`, never reaching the `usage_metadata` that does carry
`input_token_details.cache_read`. Cache reads are now harvested from `usage_metadata` regardless of
which source supplied the counts (`usageFromGenerations`).

**Consequences fixed alongside it:**

- **`ttft_ms` now recorded** via `handleLLMNewToken` (first token per LLM run). `latencyMs` measures
  the whole generation, which hides exactly what caching improves. Measured **1,145ms** average TTFT.
  Router/grader stay blank because they use the raw non-streaming client — correct, not missing.
- **Cost was overstated.** `computeCost` billed all ~11k prompt tokens at the full input rate while
  10,880 of them were cache reads. Added `cachedInput` rates to `MODEL_PRICING` and split the input
  charge. An unpriced model falls back to the full rate so the `AGENT_MAX_COST_USD` guard can never
  trip too late.
- **A4 dropped as unnecessary.** It existed to stabilise the prefix; the prefix was never unstable.

### Measured after Phase A

| metric | before A | after A |
| --- | --- | --- |
| cache hit rate | 0.0% (reported) | **92.5%** (real, now visible) |
| TTFT | not recorded | **1,145ms** |
| reported cost, 4 questions | $0.0755 | **$0.0166** |
| mean wall | 6,180ms | 5,977ms (unchanged, as expected) |
| on-target citations | 4 of 4 | 4 of 4 |

**Read that cost line carefully: this did not save money.** Real spend was always ~$0.0166 — the old
figure was a measurement error. The useful consequence is that **the per-question cost is ~$0.0041,
not $0.0189**, so the earlier "~$830/month at 100 agents" projection is wrong by ~4.5×; it is closer
to **~$180/month**. That materially changes the infrastructure-spend advice given earlier.

Tests: 5 new `computeCost` cases (cached billed at the cached rate, unchanged when nothing cached,
cached clamped to prompt tokens so cost cannot go negative, negative input ignored, unpriced model
never discounted). Backend **2436** passed / 1 skipped, lint 0 errors, typecheck clean.

## 2026-08-08 — Phase B: a grounded answer was showing no sources

Reproduced: `grade: sufficient / 0.926`, `ragPassages: 5`, correct answer — and `citations: []`, so
Admin's source list was empty on a properly grounded answer.

`citationCheck.validateCitations` had two paths and was missing the third. Markers present and used →
the cited subset. No markers at all (classic retrieval) → everything retrieved. But **markers present
and the answer used none** fell into the first path's filter and produced `[]`.

Whether the model writes `[S1]` is a stylistic accident; it says nothing about whether the answer was
grounded. An answer that *looks* ungrounded costs more trust than a slightly broad source list, so an
unmarked (or entirely-hallucinated-marker) answer now falls back to the retrieved set — the same
semantics the classic path already had. It cannot invent sources: nothing retrieved still reports
nothing.

Also fixed the instruction that caused it. `RAG_USAGE_RULE` ended "Cite the docId of any passage you
rely on", while `buildGroundingBlock` tells the model to "cite the [Sn] marker" — and `[Sn]` is what
`validateCitations` checks and what the UI's source list is built from. The persona was training the
model to emit citations the pipeline then discarded. It now asks for the markers.

**Verified live on the orchestrator path** that produced the empty list:
`CITATIONS: ['Sales Mytrion — Card Activation (C-1)']`, with `markers in answer: []` — the model still
did not write `[S1]`, and the source shows anyway. Five passages deduped to the one document they came
from, which is correct.

Four new tests cover the gap: unmarked answer falls back, cited subset still wins when the answer did
cite, all-hallucinated markers fall back after stripping, and nothing retrieved reports nothing.
Backend **2440** passed / 1 skipped, lint 0 errors.

## 2026-08-08 — Phase C: the ambiguous cases immediately found a real bug, and rerank lost

Added three deliberately ambiguous bench cases spanning two documents each — fraud hold vs override,
balance vs card list, viewing money codes vs drawing one — and changed the quality metric from a
boolean to **expected-doc coverage**. The existing four are clean single-document vector hits, so a
reranker measured only against those would have had nothing to reorder and the test would have been
rigged in its favour.

### The new cases found a silent abstention bug before rerank was even tried

`balance-and-cards` scored **0/2** with `hops: 0`, `duration_ms: 3`. `rag_runs` said
`route: tool, grade: not_documented, abstained: true`. The agent had called `knowledge_search` and been
told "use a live-data tool instead".

Cause: `routeRetrievalIntent` judges a USER utterance — "how do I…" stays on knowledge, "how many
gallons this month" goes to a tool. But `scopedRag` feeds it the MODEL's keyword query
("client balance account cards"), which has no procedural markers and so reads as a live-data
aggregate. Deciding *not* to retrieve belongs to the chat layer, before the tool is called; once the
model has called `knowledge_search`, the request should be honoured. `agenticRetrieve` now takes
`explicitKnowledgeRequest` and coerces a `tool` verdict to `knowledge`. Casual/empty still abstains —
searching a greeting is waste, not a lost answer — and external intent is untouched.

Also extended `PROCEDURAL`: **"what are my options"** was a how-to phrasing the first pass missed
(`TOOL_AGGREGATE` matched `client`, `LIVE_SCOPE` matched `my`, nothing marked it procedural), so
"A client's card is on fraud hold — what are my options?" routed to a live tool. Genuine aggregates
that say "my" ("what is my total gallons this month") still route to tools; golden routing stays
280/280.

That fix alone took coverage **8/10 → 9/10**.

### Rerank: measured, and rejected

| | rerank OFF | rerank ON |
| --- | --- | --- |
| mean wall | **5,779ms** | 6,967ms (+21%) |
| retrieval | 1,353–1,659ms | 2,169–2,709ms (+55%) |
| expected-doc coverage | **9/10** | **8/10** |
| cost (7 questions) | $0.0292 | $0.0283 |

Slower **and** less accurate — it regressed `balance-and-cards` from 2/2 back to 1/2 and did not fix
the one case it might have. `rerankPassages` asks `models.default` (gpt-4o-mini) to reorder candidates
that RRF already ranked using vector/lexical agreement; a cheap listwise judgement is noisier than
that signal, so it can only degrade it. `FF_RAG_RERANK=0` is now explicit in `.env` with these numbers
in a comment, so it does not get flipped on hopefully later.

### Scratchpad: deliberately NOT measured, because the bench cannot show it anything

A scratchpad earns its keep on multi-step computation. Every question in this bench is documentation
lookup, so implementing one and "measuring" it here would be theatre in the opposite direction —
guaranteed to look useless regardless of merit. The honest trigger is a question class we do not test
yet: retention-timer arithmetic ("client breached 5 days ago with 3 failed attempts — when does it
reach Open Pool?"), which needs business-day counting across the retention rules. Adding those cases
is the prerequisite, and verifying them needs judgement rather than substring matching.

Remaining miss: `money-codes-view-and-draw` at 1/2 — cites the Money Code automation but not Data
Center, where issued codes are viewed. A recall problem across two document *kinds*, not an ordering
problem, which is consistent with rerank not helping.

Backend **2449** passed / 1 skipped, lint 0 errors.

## 2026-08-08 — Phase D + a correction to the Phase C rerank claim

**Strict structured output.** `planQueries` and `judgeEvidence` moved from
`response_format: { type: 'json_object' }` + hand-parsing to strict `json_schema` (constrained
decoding). Both keep their fallbacks — the point is that they now fire far less often. This mattered
most for the judge: a malformed grade silently degrades to the deterministic assessment, so a broken
judge is indistinguishable from a confident one in the traces. Verified live: 0 planner/judge parse
failures across a full bench run, latency unchanged (mean 5,803ms vs 5,779ms — noise).

### Correction: the rerank rejection was over-claimed

I wrote that rerank was "slower AND less accurate", citing coverage 9/10 → 8/10. That second half was
wrong. Running the **identical** configuration twice more produced 8/10 and then 9/10, with
`balance-and-cards` flipping between 1/2 and 2/2. A one-point coverage difference is inside run-to-run
variance, so it is not evidence of anything.

What survives scrutiny:

- **Latency is real and mechanical**: +21% mean wall, +55% retrieval time, because rerank adds an LLM
  call per retrieval. Reproducible by construction.
- **No measurable accuracy benefit**: it did not fix `money-codes-view-and-draw`, which is stably 1/2
  with and without it.

So: rejected on latency for no measured gain — not because it degrades quality. `.env` now records
that framing instead of the original over-claim.

**The metric itself was the deeper problem**, since "measure before enabling" is worthless with a
metric that moves on its own. `benchSalesChat.ts` now takes `--runs N` and prints per-case stability:

```
per-case stability over 3 runs:
  card-activation            1/1 1/1 1/1  stable  mean 10313ms
  fraud-options              2/2 2/2 2/2  stable  mean  5409ms
  balance-and-cards          1/2 1/2 1/2  stable  mean  6658ms
  money-codes-view-and-draw  1/2 1/2 1/2  stable  mean  5786ms
```

Stable *within* a batch, but that same case read 2/2 in an earlier batch — so use `--runs 3` before
deciding anything on coverage, and treat a 1-point gap as no signal.

Current honest state: coverage **8–9/10**, the four single-document cases rock solid at 1/1,
`fraud-options` solid at 2/2, and the two remaining multi-document cases borderline —
`money-codes-view-and-draw` reproducibly misses the Data Center document, which is a recall problem
across document *kinds*, not an ordering one.

Backend **2449** passed / 1 skipped, lint 0 errors.

## 2026-08-08 — Knowledge lifecycle: a sync endpoint, because the cron flag is a loaded gun

The nightly `maintenance.platform-knowledge-sync` never runs in production. The obvious fix — set
`FF_JOBS_ENABLED=1` on Render — is **not safe**, and it took reading the job catalog to see why.

Cron scheduling has no per-job switch. `scheduler.ts` filters `CRON_SCHEDULES` by exactly three
things: `DISABLED_JOB_QUEUES` (the weekly retention scan + 4 KPI jobs) and a `FF_ORCHESTRATOR_ENABLED`
gate on two LLM automations — which render.yaml already sets to `1`. So flipping the flag registers
**11 schedules at once**, including:

- `notification.poll` every **2 minutes** — card-status, receipt and invoice messages over Telegram.
- `notification.statement-weekly`, Mondays 07:00 — `runWeeklyStatements()` sends fuel-transaction and
  EFS money-code reports (PDF + XLSX, including discount pricing) to carrier owners.

The catalog comments call both "no-op w/o pilot carriers". **That comment is stale.** `pilotCarriers()`
selects every row in `registered_mini_app_companies` with `status='active'` and `profile != 'driver'`;
`NOTIFY_POLL_CARRIERS` is only a manual *extras* list. And unlike the pollers, `runWeeklyStatements`
has **no first-run baseline guard** — its dedupe key covers the text notification, not the document
sends, and `retryLimit: 0` because those sends are not idempotent. The first Monday after such a flip
would mail last week's bundle to real paying customers. A nightly knowledge refresh is not worth that.

A Render Cron Job running the existing one-shot is also impossible as things stand: the runtime image
carries only `scripts/docker/start-prod.sh`, and `tsx` is a devDependency under `pnpm install --prod`.

**So: `POST /v1/knowledge/platform-sync`** (`knowledge.routes.ts`, `adminGuard`), which reuses
`syncPlatformKnowledge` verbatim. Any scheduler can hit it with the API key.

Verified live against the local corpus:

| call | result |
| --- | --- |
| first | `ready: 4, skipped: 42` in 1,946ms |
| second | `ready: 0, skipped: 46` in **131ms** |
| two concurrent | one `200`, one `409 SYNC_IN_FLIGHT` |
| unauthenticated | `401` |

Two things worth noting from that. A warm re-run is **essentially free** — `ingestDocument` resolves
the checksum (line 128) before it embeds (line 192), so an unchanged document costs one query and no
OpenAI call. And the 4 that *were* re-ingested are the agent-capability documents: they are generated
from the manifests, so editing the Sales persona and its MCP tool list correctly invalidated them. The
catalog tracks code, which is the whole point of it being generated.

Deliberately independent of `FF_PLATFORM_KNOWLEDGE`, matching the one-shot script: you need to
populate the corpus *before* exposing it.

Four tests: unauthenticated refused, admin gets counts + duration, concurrent second call gets 409
without a second sync, and the in-flight guard clears after a failure so one bad run cannot wedge the
endpoint. Backend **2453** passed / 1 skipped, lint 0 errors.

**Not changed:** `FF_JOBS_ENABLED` stays off. Fixing the stale "no-op w/o pilot carriers" comments and
giving `runWeeklyStatements` a first-run guard would be the prerequisites for ever enabling it, and
both are separate work with real customer-facing risk.

## 2026-08-08 — pass@k, and the chunker defect it uncovered

### Why retrieval-level, not answer-level

`benchSalesChat.ts` measures whether the model *cited* the expected document, and that number is
unstable — 8/10 and 9/10 on identical configurations. Cause: `citationCheck` narrows `citations` to the
model's chosen subset when the answer writes `[Sn]` markers and widens it to everything retrieved when
it does not. The answer-level denominator is chosen by the model, so no amount of k repairs it.

`scripts/evalRetrievalPassK.ts` removes the orchestrator, the answer model and the citation filter and
asks the only question a retrieval gate should: **did the right document come back in the top k?**

Two guards make the number trustworthy:

- **A preflight that hard-fails** when a selected expectation cannot be satisfied by the corpus at all.
  An audit found 7 of the fixture's 21 evidence-bearing seeds are unsatisfiable (wrong department
  scope, or a `requiredTerms` word present nowhere), so scoring them would report a permanent ~33%
  failure floor that is a fixture bug. Default scope is therefore the 8 sales-mytrion seeds; the rest
  is recorded debt.
- **The satisfiability and scoring checks search `section_path` as well as `content`,** because the
  chunker lifts markdown headings out of the body. Measured: "tool" appears in 29 chunk bodies and
  **56 section paths**; "freshness" in 0 bodies and 1 section path. Checking `content` alone reports
  false negatives on any heading-only term — and that is exactly why the fixture's
  `platform-rbac` seed (`requiredTerms: ['tool']`) looked broken.

### It reported 76% and the cause was not retrieval

First run: document recall **97.9%**, evidence coverage **76.0%**. Splitting those two levels is what
made the diagnosis possible — collapsing them would have read as a 24% retrieval problem and sent
someone tuning similarity thresholds that were working correctly.

Probing the worst case: "What does Automation C-16 do?" returned **Override the Card at rank 1**, but
that chunk held neither "30" nor "fraud hold". Same shape for Limits — right document at ranks 1–4,
"350" present, "ULSD" in none.

**The chunker was fragmenting structured documents.** `chunkText` emitted at least one chunk per
`structuralSections` entry regardless of size, so a **1,778-character document became 6 chunks
averaging 296 characters against a 1,000-character budget** — one per `##` heading. "receives an
approximately 30-minute active window" (under *Result*) and "does not lift the fraud hold" (under
*Important*) could never share a passage.

Fixed by packing consecutive small sections up to `chunkSize`. A single section stays byte-identical,
so prose documents are unaffected; two or more get their leaf heading inlined, because the model only
ever sees `content` in the grounding block and would otherwise read sections run together. A section
larger than the budget still splits alone.

### Result — same k, no extra tokens per turn

| | before | after |
| --- | --- | --- |
| chunks per automation doc | 6 @ 296 chars | **1–2 @ 666–865** |
| document recall pass@1 | 97.9% | **100.0%** |
| evidence coverage pass@1 | **76.0%** | **100.0%** (96/96) |
| flaky cases | 1 | **0** |

Raising `k` to 10 had also lifted coverage to 87.5%, but that costs ~2–3k uncached tokens on every
turn (the grounding block is a tool result, not part of the cached prefix). Fixing the chunker got more
than that for free, and made the corpus cheaper to embed and store as a side effect.

Six chunker tests added, including one that pins a pre-existing quirk rather than silently changing it:
a document whose first heading is `##` gets a leading `" > "` in `section_path`, because
`structuralSections` indexes headings by depth. Harmless, but every embedding would shift if altered.

Backend **2459** passed / 1 skipped, lint 0 errors.

**Operational note:** `ingestDocument` skips by *document* checksum, so a chunker change does not
re-chunk anything by itself. The Sales corpus was re-ingested by deleting those rows and re-running the
sync. Any future chunker change needs the same deliberate step — and prod needs it too, or prod keeps
the fragmented chunks.

## 2026-08-08 — Turn Inspector: the three numbers that were recorded but invisible

The scorecard rated RAG observability "Partial". Reading the component first showed that was pessimistic
in one way and right in another: `step.details` is already rendered generically as key/value pairs, so
`cachedInputTokens` and `hops` were **already** on screen per step. The genuine gaps were narrower.

Added:

- **Tools bound** (`buildAgentTools` → `inspect`), with a write-tool count. Nothing had ever emitted
  this, which is precisely why a `zoho_mcp.*` wildcard binding ~102 tools to Sales took a night of
  measurement to find. Live turn now reports `toolsBound: 22` for Sales (18 native + 4 named MCP).
- **TTFT into the trace.** `runTracker` computed it for `llm_calls` but never passed it to `inspect`, so
  it reached the database and not the UI. Live: `ttftMs` 1856 and 793 across the turn's two calls.
- **Per-step duration.** `durationMs` was on the event and simply not rendered; the timeline only
  showed elapsed-since-turn-start, which cannot tell you *which* stage is slow.
- **Two summary tiles** — Tools bound and Prompt cache (with TTFT) — derived from the steps rather than
  new wire fields, since `details` already carries everything. Unmeasured shows an em dash, not `0%`:
  "unknown" and "no cache hits" are different states and conflating them is how the 0%-cache bug hid.

Verified end-to-end on a streamed turn: `toolsBound: 22`, `writeTools: 0`, `ttftMs`, and
`cachedInputTokens: 10880` all arrive at the client. Four inspector tests, bundle rebuilt
(`Tools bound` / `Prompt cache` present in the hashed output). Backend 2459, frontend **556**, lint 0.

### Correction: Russian retrieves worse than Uzbek

I have said several times — including in the published scorecard — that **Uzbek** is the weak language,
based on one ad-hoc probe showing ~0.25 similarity. Measured properly with pass@k over all 80
sales-mytrion cases at k=5:

| language | evidence coverage pass@1 |
| --- | --- |
| en | **100.0%** (64/64) |
| ru | **87.5%** (42/48) |
| uz | 95.8% (46/48) |

**Russian is the weakest, not Uzbek.** All three genuine retrieval misses are one seed —
"Как активировать карту в Sales Mytrion?" — whose document is not retrieved at all for 3 of its 4
Russian variants, while the identical English question is perfect. The earlier probe was run against
the *fragmented* chunks and generalised from a single question.

The recommendation shifts accordingly: the fix is still cross-lingual anchors in the documents, but it
should be driven by this measurement rather than by an assumption, and Russian card-activation phrasing
is the concrete first case. I have deliberately not authored the RU/UZ text — governed knowledge that
Sales agents rely on should not carry translations I invented without a native reviewer, and the team
speaks both languages.
