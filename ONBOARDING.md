# ONBOARDING.md — Mytrion Horizon / Octane Assistant

> System brief for a new engineer or agent joining this repo. Written 2026-07-26 against
> `feature/MytrionOrganize` @ `49b1d8a`. Companion docs: `CLAUDE.md` (hard rules — read first),
> `AGENTS.md` (same rules for non-Claude agents), `ORCHESTRATION.md` (multi-agent delegation),
> `WORKING_NOTES.md` (383 KB session log — the real changelog), `apps/mytrion-crm/ARCHITECTURE.md`.

---

## 1. What this is

**OctaneFuel** is a US fuel-card company. Carriers (trucking companies) buy fuel with Octane cards at
Pilot/Love's/TA stations; Octane bills them, extends credit, issues money codes, and chases debtors.
The business runs on **Zoho CRM + Zoho Desk** (system of record) and **servercrm/CMP** (the card
platform, which fronts WEX/EFS).

This repo is **`octane-assistant`** — the backend + internal apps that sit on top of that stack.
Two names for two things:

| Name | What it means |
| --- | --- |
| **Mytrion** | The AI/automation product line. Originally a separate codebase; this repo borrows its *patterns* only. **Never import Mytrion code.** |
| **Mytrion Horizon** | The current design system + the CRM SPA built on it — `apps/mytrion-crm`. "Horizon" = the glass/gradient visual language (`src/styles/horizon.css`, `--hz-*` tokens). |

**A "Mytrion" (singular noun) = one department workspace.** There are nine, and they are the primary
organizing concept of the whole product:

`admin · sales · billing · collection · finance · verification · manager · analyst · customer-service`

Canonical list: `src/lib/mytrions.ts` (backend, owns the slug→`department_access` join) mirrored by
`apps/mytrion-crm/src/access/mytrions.config.ts` (frontend, owns display). **A mismatch between those
two files is a bug** — the UI shows a workspace the backend can't map to a department.

Per-Mytrion access mode is `read | full`. Billing is the one shipped today with `read` downgrades.

---

## 2. Repo topology

```
octane-assistant/
├── src/                      Fastify 4 backend (the product)
│   ├── app.ts / server.ts    app factory; server.ts also boots pg-boss
│   ├── worker.ts             optional standalone pg-boss worker entry
│   ├── config/env.ts         631-line Zod env schema — THE source of truth for config
│   ├── db/schema/ (39 files, 45 tables) + db/migrations/ (58 SQL files)
│   ├── repos/ (34)           ONLY place raw DB access is allowed; enforces tenant_id
│   ├── routes/v1/ (39)       HTTP surface
│   ├── modules/ (30 dirs)    business logic
│   ├── integrations/         outbound vendor clients
│   └── wrappers/             domain façades over servercrm
├── apps/
│   ├── mytrion-crm/          ⭐ THE CRM SPA — React 18 + Vite + Tailwind v4
│   ├── mini-app/             Telegram Mini App for carriers (external audience)
│   ├── agent-gateway/        Telegram support bot v2 (Claude Agent SDK, separate deploy)
│   └── agent-telegram-bot/   ⚠️ upstream "hamroh" framework — NOT ours, do not run
├── scripts/ (32)             dev-local.sh, db-tunnel.sh, evals, inspectors
├── metadataScripts/          Zoho/DWH schema dumpers
├── tests/                    Vitest — rbac.test.ts is the gate
└── eval-reports/             committed agent behaviour eval runs
```

**Two Telegram bots share one token.** Running `agent-telegram-bot` and `agent-gateway` at the same
time = Telegram 409 Conflict. `agent-gateway` is the product one.

---

## 3. The CRM app — `apps/mytrion-crm`

A single React SPA served **same-origin by the backend** (`src/app.ts` serves the committed
`apps/mytrion-crm/app/` build with SPA fallback). Zoho OAuth sign-in; the backend resolves which
Mytrions the worker may enter and drops them in.

**Stack:** React 18 + TS strict · React Router v6 (`createBrowserRouter`, v7 flags on) · Vite 5
(`base:'./'`, `outDir:'app'`) · **Tailwind v4 CSS-first** (`@theme inline` in `src/styles/global.css`,
no `tailwind.config.js`) + CSS Modules (legacy shell/admin) · Base UI + Radix primitives ·
`lucide-react` · `recharts` · `@xyflow/react` (Admin scope graph) · `framer-motion` · `sonner`.

**No global store, no React Query.** (`@tanstack/react-query` is installed and imported nowhere —
remove it or adopt it, don't leave it.) Data flows through:

- `src/mytrions/_shared/useLoad.ts` — homegrown `useLoad(fn, deps)`: loading/refreshing/error/reload,
  stale-drop, one retry. **This is the data-fetching convention.**
- Per-module React contexts (`sales/redesign/ctx.tsx`, `finance/redesign/ctx.tsx`).
- Hand-rolled caches: `fetchDedupe.ts`, `dcCache.ts`, `dashCache.ts`, `ticketListCache.ts`.

**Routing:** `/main` → Landing (0 accessible → Forbidden, 1 → auto-enter, 2+ → picker);
`/main/:slug` → `MytrionGuard` → lazy module from `mytrions/registry.ts`.

**Workspace inventory:**

| Mytrion | State | Screens |
| --- | --- | --- |
| **Sales** | flagship, ~90 files | Home · Inbox · Data Center · Create · Carriers · Retention (Cases + Open Pool + call wizard) · Automations · Dashboard · RingCentral softphone. *Parked:* Tickets, Verification Pipeline, Call Hub |
| **Billing** | production, daily use | Data Center · Transactions · Debtors · Prepay · Returns · BillingCopilot |
| **Customer Service** | production | Home · Applications · Retention Cases · Open Pool · CITI Folder · Citifuel · Analytics · Data Center · Inbox · Service Center |
| **Admin** | production, 16 tabs | Horizon AI · Knowledge Base · Train · Knowledge Browser · User Mgmt · Carrier Users/Invitations · Client News · Deals · Audit Log · Jobs · CMP/DWH/Verification schema browsers · Octane Scope |
| **Finance** | built, gated | redesign/ Home · Transactions · Clients · Dashboard — **but flagged coming-soon** |
| **Collection** | built, static fixtures | Cases · Array Report · Inbox (`collection/data.ts` is seed data) |
| **Verification** | built, static fixtures | Applications · Inbox · Configuration |
| **Manager** | new | Referrals card only |
| **Analyst** | new | single Overview dashboard |

⚠️ `COMING_SOON_MYTRION_IDS = ['collection','finance','verification','analyst']` — shown on the
picker, filtered out of `resolveAccessibleMytrions`, **not enterable** even though the code exists.

**Two visual languages coexist:** Admin/CS/Billing use Horizon tokens + CSS Modules; Sales and
Finance redesigns style with inline `style={s('css-string')}` helpers. `DESIGN_BRIEF.md` exists to
resolve this (and is itself stale — it claims all data is mock, which is false).

**Auth:** Zoho OAuth authorization-code, backend as confidential client. Session in
`localStorage['octane.session.v1']`. `api/transport.ts` attaches the bearer and does a **de-duplicated
single refresh** on 401; only 400/401/403 clears the session (5xx deliberately does not log you out).
Admin "View-as" sends `x-act-as-zoho-user-id` only — the backend verifies against the CRM directory
and audits it. Client-sent `x-department-access` is a **legacy no-op**; RBAC is session-authoritative.

**Biggest API surface: touchpoints.** `POST /v1/touchpoints/:key` with **77 typed keys** across
`retention.* dwh.* finance.* dashboard.* cs.* inbox.* efs.* carrier.* billing.* wex.* money_code.*
cards.* clients.* leads.* browser.* activity.* tickets.* fraud.* zapier.*`
(`apps/mytrion-crm/src/api/touchpointTypes.ts`, 33 KB → `src/modules/touchpoints/{dispatcher,catalog}`).
Most of these ultimately execute **Zoho Deluge custom functions** or servercrm calls.

**Realtime:** own WS at `GET /v1/realtime?token=` (`src/modules/realtime/hub`) **plus two external
servercrm sockets** (`useServerCrmSocket.ts`, `billing/useMappingSocket.ts` → `wss://servercrm-*`).

**Build:** `pnpm -C apps/mytrion-crm build` → `app/`, and **`app/` is committed** (the Docker runtime
stage copies it). It shows up dirty in `git status` constantly; reset with
`git clean -fd -- apps/mytrion-crm/app && git checkout -- apps/mytrion-crm/app`.

---

## 4. Data model

**45 tables** in one Postgres (pgvector/pg16), Drizzle ORM, 39 schema files, **58 migrations**
(latest `0057_mytrion_access_modes`). House rule: **no cross-domain foreign keys** — integrity lives
in `src/repos/`. The retention subsystem is the one FK-rich island.

**By domain:**

- **Auth/tenancy (6)** — `tenants`, `users` (internal workers), `carrier_users` (external, owner|driver),
  `worker_mytrion_access` (per-Zoho-user override: allowed/denied/home/`all_department_access`/
  `view_as_user_ids`/`mytrion_access_modes`), `mytrion_profile_defaults`, `mytrion_role_defaults`.
- **Knowledge/RAG (2)** — `knowledge_docs` (title, `department_access` NULL=global, sha256 `checksum`,
  freshness `effective_at`/`expires_at`/`last_verified_at`), `knowledge_chunks` (`embedding vector(1536)`
  HNSW cosine + generated `content_tsv` GIN).
- **Chat (3)** — `conversations`, `messages`, `tool_calls` (one row per dispatch, with `risk_class`).
- **Agents (6)** — `agent_runs` (cost ledger), `agent_tasks` (async job mirror), `agent_memories`
  (vector), `agent_skills` (learned trajectories, vector), `agent_blackboards`, `approvals`.
- **Notifications/inbox (8)** — `mini_app_notifications` (+prefs/reads/state), `client_news`(+reads,
  localized en/ru/uz/es), `inbox_events`, `mytrion_inbox_messages`.
- **Billing/payments (4)** — `money_code_requests`, `payment_transactions` (mx|zelle|chase|stripe,
  unique `(source, source_record_id)`), `payment_returns`, `payment_carrier_memory` (learned
  company-name → carrier mapping).
- **Carrier/mini-app (4)** — `carrier_invitations` (Telegram deep-link token IS the PK),
  `registered_mini_app_companies`, `support_bot_chats`, `support_bot_messages`.
- **Retention (7)** — `retention_phases` → `retention_statuses` → `retention_cases` (+ `_events`,
  `_claim_requests`, `_ownership_transfers`, `_rr_cursors`). 3 phases, 26 seeded statuses, 7 terminal.
- **Ops (5)** — `mytrion_calls`, `scope_risk_items`, `audit_log`, `automation_logs`, `file_assets`.

**Multi-tenancy is application-level, not RLS.** `tenant_id` on ~40/45 tables. `TenantContext`
(`src/types/tenantContext.ts`) is threaded as the **first argument to every repo method**. Audience is
actually **three** values — `internal | partner | customer` (README says two; it's stale). `partner`
is a dormant scaffold; `customer` is deny-by-default.

**Repo pattern:** exported const object of async methods, each `(ctx: TenantContext, …)`, every
`.where()` starting with `eq(table.tenantId, ctx.tenantId)`, helpers from `src/repos/util.ts`
(`firstOrUndefined`, `normalizePagination`, `toVectorLiteral`, `isUniqueViolation`).

**⚠️ Known trap:** `drizzle.config.ts` lists schema files explicitly, and **4 are missing** —
`agent_blackboards.ts`, `agent_skills.ts`, `mytrion_role_defaults.ts`, `support_bot_messages.ts`.
Running `pnpm db:generate` today would emit DROP statements for those tables. **Fix the config list
before generating any migration.**

**Read-only external sources — never migration targets:**

| Source | Env | Notes |
| --- | --- | --- |
| OctaneFuel DWH Postgres | `DWH_DATABASE_URL` | `default_transaction_read_only=on`, `statement_timeout=30s`, pool max 5. Shared with servercrm + BI. `$n` placeholders. `octane.intm_zoho_deals` is **broken** (`is_active=false` on all ~253k rows) — code does its own `DISTINCT ON … ORDER BY valid_from DESC`. |
| CMP MySQL | `AWS_MYSQL_*` + `MYSQL_SSH_*` | Via SSH tunnel on **:3307**. `?` placeholders — not portable with DWH. Admin schema tab only. |
| Verification DB | `VERIFICATION_DATABASE_URL` | `credit_platform`, metadata tab only. |

---

## 5. pgvector & the RAG pipeline

Three `vector(1536)` columns (OpenAI `text-embedding-3-small`), all **HNSW / `vector_cosine_ops`**,
pgvector defaults (no `m`/`ef_construction` tuning): `knowledge_chunks.embedding`,
`agent_memories.embedding`, `agent_skills.embedding`. Extension created in
`scripts/enable-pgvector.sql` and line 1 of migration `0000`.

**Ingest** — `src/modules/knowledge/ingestService.ts`: sha256 checksum dedupe → chunk → embed →
`replaceChunks` in one transaction → status `ready` → audit.
Chunker: recursive split on `['\n\n','\n','. ',' ','']`, **1000 chars / 200 overlap**
(`src/config/constants.ts`). Embedder batches at **128**, hard-fails on dim ≠ 1536.
`POST /knowledge/upload` accepts **text only** (md/txt/json); PDFs and DOCX enter through
`src/modules/files/parse/` (unpdf, mammoth, exceljs) via the `file_analyze` tool. Sync in-process
under 2 MB; above that → pg-boss `knowledge.bulk-ingest`.

**Retrieve** — vector leg `1 - (embedding <=> $vec)`, k=6 default / 25 max, **no score threshold**.
Hybrid (`FF_RAG_HYBRID`, off by default in code but **on in `.env`**) adds a
`websearch_to_tsquery`/`ts_rank_cd` leg and fuses with **RRF (k=60, 30 candidates/leg)**, applying a
`0.5` penalty to stale docs (>180 days unverified). Agentic CRAG loop
(`src/modules/knowledge/agentic/loop.ts`): plan up to 3 rewrites → retrieve → short-circuit if top
fused score ≥ **0.032** → else LLM ternary judge (Correct/Ambiguous/Incorrect) → up to 2 hops.
LLM rerank exists but is **off** (`FF_RAG_RERANK=0`).

**The RBAC chokepoint is one function:** `departmentFilter(ctx)` in `src/repos/knowledgeRepo.ts:45`,
reused verbatim by `knowledgeSearchRepo.ts` so reformulated queries **structurally cannot widen
access**. `resolveRetrievalContext` is intersection-only — an agent's RAG scope can never expand,
even for admins. The LLM only ever emits query strings and grades, never filter params.
**This is the single most important security invariant in the codebase.**

**Citations** — `[S1]…[Sn]` markers built in `agentic/citations.ts`, then **post-hoc validated** in
`agentic/citationCheck.ts` which strips hallucinated markers.

**Evals** — `pnpm eval:retrieval` (recall@6 + MRR against `tests/fixtures/retrieval-corpus.json`, hard
floors: single-shot 1.00/0.80, hybrid 0.90/0.70, agentic 0.85/0.65) and `pnpm eval:live` (behavioural,
LLM judge). ⚠️ The last **full** live run (`eval-reports/behavior-2026-07-22T15-25-23-972Z.json`,
41 tasks, $0.40) breached four floors: **routing 0.46** (floor 0.9), **grounding 0.50** (0.8),
**delegation 0.00** (0.75), **web-navigation 0.00**. RBAC and greeting held at 1.0. Treat agent
quality as an open problem, not a solved one.

---

## 6. pg-boss jobs

pg-boss v12 on the **app Postgres**, schema `pgboss` (self-migrating, not in Drizzle), **pool max 3**
(shared budget with the app pool and the LangGraph checkpointer). Boot: `src/modules/jobs/boss.ts`
from `src/server.ts:37` or the standalone `src/worker.ts`.

Flags: `FF_JOBS_ENABLED` (default **0**), `JOBS_WORKER_MODE = inline|send-only|off` (default `inline`),
`JOBS_CONCURRENCY` (2), `JOBS_CRON_TZ` (`America/Chicago`).

| Queue | Trigger | Retry / expire |
| --- | --- | --- |
| `agent.run` | on demand (`POST /v1/agent/tasks`) | 1 / 900s |
| `knowledge.bulk-ingest` | files > 2 MB | 2 + backoff / 600s |
| `notification.dispatch` | event, singleton by id | 4 + backoff / 300s |
| `notification.poll` | cron `*/2 * * * *` | **0** / 110s |
| `notification.statement-weekly` | cron `0 7 * * 1` | **0** / 600s (sends aren't idempotent) |
| `automation.collection.debtor-sweep` | cron `0 8 * * 1-5` | 1 / 600s |
| `automation.verification.recheck-reminders` | cron `0 7 * * *` | 1 / 600s |
| `automation.retention.case-sync` | cron `0 * * * *` | 1 / 600s |
| `automation.retention.deadline-sweep` | cron `*/15 * * * *` | 1 / 300s |
| `automation.retention.weekly-scan` | **DISABLED**, no worker | — |
| `maintenance.checkpoint-ttl-sweep` | cron `30 3 * * *` | 1 / 600s |
| `maintenance.approvals-expiry` | cron `15 * * * *` | 1 / 300s |
| `maintenance.memory-decay` | cron `45 3 * * *` | 1 / 300s |
| `jobs.dead` | dead-letter sink | logs + `audit_log` `job.dead` + fails the `agent_tasks` row |

**Authority model for scheduled work:** `buildSystemContext(departments)`
(`src/modules/jobs/systemContext.ts`) — department-scoped admin, `userId='system:scheduler'`,
**never** `allDepartmentAccess` or `bypassRbac`. On-demand jobs carry the requester's TenantContext
verbatim in the payload.

**Prod reality:** `render.yaml` deliberately **excludes** `FF_JOBS_ENABLED` — pg-boss workers and
crons are **off in production today**. The Dockerfile starts only `node dist/server.js`; there is no
worker service. Also: realtime WS push from retention jobs only works in `inline` mode (the hub is
per-process).

Ordering gotcha, already fixed and regression-tested (`tests/unit/jobs-queue-order.test.ts`): v12
validates dead-letter targets at `createQueue`, so `jobs.dead` must be created before its referrers —
getting this wrong caused a boot crash-loop.

---

## 7. Vendors

**Wired and called at runtime:**

| Vendor | Auth | Files | Mode |
| --- | --- | --- | --- |
| **Zoho CRM** (system of record) | self-client OAuth refresh-token, per-service | `integrations/zoho.ts`, `zohoAuth.ts`, `zohoBase.ts`, `zohoCrm.ts` (COQL read, `assertReadOnlyCoql`, 2000-row cap), `zohoCrmRecords.ts` (write) | R + W |
| **Zoho Deluge functions** | same | `integrations/zohoFunctions.ts` + `modules/touchpoints/catalog/*Deluge.ts` | **the biggest write surface** |
| **Zoho Desk** | OAuth | `integrations/zohoDesk.ts` (569 ln) | R + comment W |
| **Zoho People** | OAuth | `integrations/zohoPeople.ts` | R |
| **Zoho OAuth (worker sign-in)** | separate confidential app | `integrations/zohoOAuth.ts` | — |
| **servercrm** | static `x-api-key` | `integrations/serverCrm.ts` + `wrappers/{serverCrm,cmp,efs}Wrapper.ts` | R + W — **the real EFS/CMP path**, ~42 files |
| **DWH Postgres** | conn string | `integrations/dwh*.ts` (7 files) | R only |
| **OpenAI** | API key | `modules/llm/*` | the only required LLM key |
| **dbt MCP** | OAuth client_credentials | `integrations/dbtMcp.ts` | **agents reach the DWH only through this** |
| **Composio** | shared org account | `integrations/composio.ts` (ZOHO, ZOHO_DESK, FIRECRAWL) | `FF_COMPOSIO_WRITES=0` |
| **Telegram** ×2 | bot tokens; Mini App uses HMAC `initData` | `integrations/telegram.ts`, `telegramCarrierBot.ts` | R + W |
| **Zapier** | webhook URL | `integrations/zapier.ts` | outbound only |
| **Browser automation (BOCA)** | `x-api-key` | `integrations/browserAutomation.ts` | W, 300s timeout |
| **Anthropic** | API key | **only** in `apps/agent-gateway` (`claude-sonnet-4-5`) | sidecar |

**Registered but idle:** CMP REST, CMP MySQL (Admin schema tab only), RingCentral (`FF_RINGCENTRAL_ENABLED=0`
— it's config-only, it just builds the Embeddable adapter URL; call records live in `mytrion_calls`),
S3/MinIO (`FF_FILES_ENABLED=0`), Groq (`FF_GROQ_ENABLED=0`), Zoho MCP.

**Code exists, zero callers:** direct **EFS SOAP** (`integrations/efs.ts` — login/child-token only;
all live EFS traffic goes through servercrm), GLM/Zhipu client, Verification DB.

**Env-only placeholders:** Zoho Projects, `OCTANE_INTERNAL_API_*`, Cloudflare R2 (reach R2 by
re-pointing `S3_*`), Browserbase, LangSmith.

**Not in this codebase at all** — DAT, Pilot Flying J / Love's, Pipedream, Google Sheets, Gong,
Pinecone, Cohere/DeepSeek/Gemini/Mistral. These exist only as Claude *skills*. They are reference
material, **not dependencies** — don't let a skill convince you the integration is live.

**LLM routing** (`src/modules/llm/modelRouter.ts`), four roles:

| Role | Model |
| --- | --- |
| answer + worker | `gpt-4o-mini-2024-07-18` |
| reasoning | `gpt-5.4-mini-2026-03-17` |
| embedding | `text-embedding-3-small` |

Budget guard in `modules/llm/costTracker.ts` — unknown models are billed at gpt-4o rates so
`AGENT_MAX_COST_USD` still trips. Orchestration is **deepagents 1.10.5 + LangGraph** with a Postgres
checkpointer (`langgraph` schema in the app DB).

---

## 8. Running it locally

```bash
docker compose up -d postgres      # app DB on :5433 (pgvector/pg16) — REQUIRED
pnpm install                       # corepack pnpm if not on PATH
pnpm db:migrate
pnpm dev:all                       # API :3001 + CRM :5173 + CMP MySQL tunnel :3307
```

Then optionally the support bot:
`cd apps/agent-gateway && docker compose up -d --build` (logs: `docker logs -f octane-agent-gateway`).

**The #1 false alarm:** if Postgres on `:5433` is down, the backend boots fine but every DB route
fails with `ECONNREFUSED ::1:5433`. The bot reports "Backend issue" — that is *not* the server being
off. Check the container first.

Before pushing: `pnpm lint && pnpm typecheck && pnpm test`.
Baseline today: **183/184 tests** (one pre-existing `dashDebtorsData` failure), **16 repo-wide
typecheck errors** (down from 23 — being burned down module by module).

**Branching:** work off `build` (`feature/*`, `fix/*`, `hotfix/*`), PR back. Never push to `main`
(deploys to prod) or directly to `build`. Currently on `feature/MytrionOrganize`.

---

## 9. The nine rules that actually bite

From `CLAUDE.md` — restated because each one has a real failure behind it:

1. **No Mytrion imports.** Patterns only.
2. **All DB access through `repos/`**, `ctx` first, tenant filter first in every `.where()`.
3. **Every tool implements `ToolManifest`**; every call goes through `toolDispatcher`, which
   re-checks RBAC at dispatch time (not just at planning time).
4. **Read-only default.** `riskClass: 'write' | 'destructive'` requires admin + approval.
5. **600-line file cap** (580 target).
6. **Strict TS, no `any`**, no unexplained `as unknown as X`.
7. **Every tool call is audit-logged.**
8. **RBAC cross-tenant leakage tests must pass** before any feature work.
9. **Never `drizzle-kit push`.** Schema change → edit `src/db/schema/*.ts` → `pnpm db:generate` →
   commit the `.ts`, the generated `.sql`, and `meta/_journal.json` together. `push` is exactly how
   `carrier_invitations` and `registered_mini_app_companies` ended up with schema files and no CREATE
   migration; `0022_bent_invisible_woman` is the idempotent repair.
10. **UI/UX work → consult the `modern-web-guidance` skill first.** Horizon aesthetic: glassmorphism,
    per-Mytrion accent hue, one loader per surface (never double loaders).

---

## 10. Current state & open threads

**Active work (last 5 sessions):** the Horizon glass propagation — Admin (16 tabs standardized),
Customer Service (full repaint + Open Pool rebuild), Billing (deliberately paint-only, it's in daily
use), the light-mode contrast pass, and the workspace picker rebuild.

**Known open items:**

- Four Mytrions are built but gated coming-soon (collection, finance, verification, analyst);
  Collection and Verification are still on static fixtures.
- Sales/Finance use inline-style helpers while everything else uses Horizon tokens.
- Duplicated Finance module (`finance/redesign/` live, old `finance/*.tsx` not deleted).
- Three pagination paradigms in Admin — a product decision, not a cleanup.
- `drizzle.config.ts` is missing 4 schema files (see §4).
- Live-eval floors breached on routing/grounding/delegation (see §5).
- pg-boss is off in prod (see §6).
- Stale docs: `README.md` says two audiences (there are three) and "no queue" for ingestion (there is
  one); `DESIGN_BRIEF.md` says all CRM data is mock (it isn't); `apps/mytrion-crm/package.json`
  description and `api/config.ts` still describe the retired URL-param identity model.

**Where to look things up:**

| Question | File |
| --- | --- |
| What config exists? | `src/config/env.ts` (Zod, 631 lines) |
| What vendors are registered? | `src/integrations/core/registerAll.ts` |
| What jobs exist? | `src/modules/jobs/catalog.ts` |
| What touchpoints exist? | `apps/mytrion-crm/src/api/touchpointTypes.ts` |
| Why is it like this? | `WORKING_NOTES.md` — search by date |
