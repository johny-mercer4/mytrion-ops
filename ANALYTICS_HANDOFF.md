# Analytics / Analyst dashboards — Claude Code handoff

**Date:** 2026-07-28  
**Audience:** Claude Code (or any agent continuing this work)  
**Repo:** `mytrion-ops` (Octane Assistant + `apps/mytrion-crm`)  
**Product surface:** `/m/analyst` (Analyst Mytrion) — category dashboards (Sales, CS, Finance, Billing, Transactions, Reports)

Read this before changing analytics SQL, cache, or Sales dashboard UI. Project hard rules still live in `CLAUDE.md`. Session scraps: `WORKING_NOTES.md` (§ 2026-07-28).

---

## Goal (what we were building)

Category analytics dashboards where **UI filters (agent + date range) are sent as query params to the API and bound into DWH SQL** — not client-only trimming of an org-wide snapshot.

Filters must affect KPIs, trend, breakdown, and leaderboard.

---

## Current architecture

```
Browser (/m/analyst?category=sales&agent=…&range=last_7_days)
  → useAnalyticsSnapshot → GET /v1/analytics/:dimension?agent&agent_name&range&from&to&fresh=
  → routes/v1/analytics.routes.ts (RBAC: non-admins locked to own Zoho id)
  → getAnalyticsSnapshot (cache.ts)
  → computeAnalyticsBlock (service.ts) → dwhQuery (integrations/dwh.ts)
  → read-only Postgres DWH (pool max ~5, statement_timeout=30s)
```

### Dimensions

| Dimension      | Primary tables                                        | Used by category | Agent filter |
|----------------|-------------------------------------------------------|------------------|--------------|
| `sales`        | `octane.mart_sales_dashboard_card_base`               | Sales            | yes          |
| `pipeline`     | `public.zoho_deals` (+ `zoho_users`)                  | CRM              | yes          |
| `support`      | `public.zoho_desk_tickets`                            | Customer Service | **no** (see below) |
| `transactions` | `octane.mart_transaction_line_items` + owned CTE      | Transactions     | yes          |
| `billing`      | `octane.stg_cmp_billing_history` + owned CTE          | Billing          | backend only |
| `receivables`  | `public.cmp_invoice` + `cmp_invoice_payment` + owned  | Finance          | yes          |

Each compute lives in `src/modules/analytics/dimensions/<name>.ts`; `service.ts` is only the
dispatcher and `shared.ts` holds the formatters / `softQuery`.

**`support` cannot be agent-scoped.** Zoho Desk `assignee_id` is the Desk org id space
(`1057080…`); CRM `zoho_users.id` is `6227679…`. Verified zero overlap on the full id *and* on the
last-12-digit suffix, and the DWH carries no Desk-agent roster to bridge them. The CS category
hides the agent picker; if `?agent=` is passed anyway the block stays org-wide and says so in the
caption. Do not add an agent predicate on `assignee_id` — it silently matches nothing.

**`billing` vs `receivables`** are deliberately different questions: billing = money clients put IN
(top-ups, wallet balances); receivables = money they still OWE on issued invoices (AR, aging,
collections). Finance used to point at `billing`, which is why the two tabs were identical.

**`sales` vs `pipeline`.** Sales is the card/volume **scorecard** (Active Companies, Unique Cards,
New Cards, Volume, Revenue) matching the "Sales_new" Power BI report's core metric set; `pipeline`
is the Zoho **deal funnel** (App Fills, stages), which is that report's CRM page. Sales used to
render `pipeline`, so the Sales tab showed the funnel and none of the five core metrics.
`mart_sales_dashboard_card_base` is what the Power BI report is built on — `first_transaction_date`
is the card's first swipe, single-valued per `card_number`, so it drives New Cards and is the cohort
key. **The mart is 1.27M rows and an unfiltered scan is ~3.5s — keep every query date-bounded.**

Reports has no dimension (catalog view only).

### Date ranges (canonical)

- `today` | `last_7_days` | `this_month` | `custom` (+ `from` / `to`)
- Legacy `this_week` still exists in `filters.ts` dateScope; UI maps / prefers `last_7_days`.

### Agent scoping

- **Pipeline:** `pipelineOwnerPred` on `zoho_users` — Zoho id **last-12-digit suffix** wins; else case-insensitive `full_name`.
- **Sales / transactions / billing / receivables:** `ownedCarrierCteFor(alias, …)` via `dim_company` ownership.
- **Support:** none — not agent-attributable (see above).

**Where the agent comes from (UI):** the TopBar **"View as"** impersonation control, NOT a
dashboard picker. `analyst/index.tsx` resolves it as: acting-as → that agent; else non-admin →
their own book; else admin → org-wide. `agent` / `agentName` are no longer URL params — only the
date window is (`?category=…&range=…`), and `writeFilters` strips legacy agent params so an old
bookmark cannot silently re-scope a dashboard. Do not reintroduce a per-dashboard agent picker: two
controls answering "whose numbers am I looking at?" is how they end up disagreeing.

---

## Key files

### Backend

| Path | Role |
|------|------|
| `src/modules/analytics/filters.ts` | `AnalyticsFilters`, `SqlParams`, `dateScope`, owner preds, `ownedCarrierCteFor(alias,…)` |
| `src/modules/analytics/service.ts` | Dispatcher only — maps dimension → compute |
| `src/modules/analytics/shared.ts` | Formatters, `toTrend`, `withCte`, `captionFor`, `softQuery` |
| `src/modules/analytics/dimensions/*.ts` | One compute per dimension (pipeline / support / transactions / billing / receivables) |
| `src/modules/analytics/cache.ts` | Org cache (long TTL + warmer) + **filtered** cache (5 min) + in-flight dedupe + stale fallback |
| `src/modules/analytics/types.ts` | Snapshot / block shapes |
| `src/routes/v1/analytics.routes.ts` | HTTP + maps DWH errors → `ANALYTICS_DWH_ERROR` 502 |
| `src/integrations/dwh.ts` | Pool: `max ~5`, `statement_timeout=30s`, read-only |

### Frontend (CRM)

| Path | Role |
|------|------|
| `apps/mytrion-crm/src/mytrions/analyst/index.tsx` | Shell + URL ↔ filter state |
| `apps/mytrion-crm/src/mytrions/analyst/categories.ts` | Category defs + `DashboardFilterParams` |
| `apps/mytrion-crm/src/mytrions/analyst/DashboardFilters.tsx` | Agent picker + range presets |
| `apps/mytrion-crm/src/mytrions/analyst/tabs/CategoryDashboard.tsx` | Live dashboard + loading/error UI |
| `apps/mytrion-crm/src/components/analytics/useAnalyticsSnapshot.ts` | Fetch + loading flag |
| `apps/mytrion-crm/src/components/analytics/*` | Shared analytics helpers / params |
| `apps/mytrion-crm/src/mytrions/_shared/ComingSoon.tsx` | Import from tabs: `../../_shared/ComingSoon` |

### Tests

- `tests/unit/analytics-filters.test.ts` (if present)
- `tests/unit/analytics-cache.test.ts` — filtered cache + stale fallback

### Skills / notes

- `.claude/skills/external-databases/SKILL.md` — DWH `$n` placeholders, pool caveats
- `ONBOARDING.md` / `dwhClients.ts` — **`octane.intm_zoho_deals` is unreliable** (SCD / `is_active` issues)

---

## Bugs we hit (chronological) and fixes

### 1. Vite: missing `ComingSoon` import

`CategoryDashboard.tsx` imported `../_shared/ComingSoon` (wrong). Correct: `../../_shared/ComingSoon`.

### 2. `column iz.owner does not exist` → 502

Agent-scoped stages queried `intm_zoho_deals.owner` (column does not exist).  
Interim fix: `EXISTS` on `zoho_deals` by `zoho_deal_id`.  
**Superseded by #4.**

### 3. Blank dashboard / pool stampede

Filtered views bypassed long TTL cache → live DWH every filter change. React Strict Mode double-fetch + 4-wide `Promise.all` + warmer → `timeout exceeded when trying to connect`.

**Fixes (still in place):**

- Filtered cache ~5 min + in-flight dedupe
- On recompute failure, serve **stale filtered** snapshot when available
- Cap query parallelism at **2** per compute
- UI: Loading… / clearer error (not empty dark panel)
- Warmer **skips a tick** while interactive `inFlight` / `filteredInFlight` work is running

### 4. Statement timeout on stages (`intm_zoho_deals`) — **main blank Sales cause**

Even with cache, `computePipeline` stages scanned `intm_zoho_deals` and hit **`canceling statement due to statement timeout` (30s)**. That failed the whole pipeline block → 502 / blank Sales (especially `last_7_days`, org-wide).

**Fix (current code in `service.ts`):**

- Stages aggregate **`public.zoho_deals.stage`** with the same owner join as App Fills (sub-second in spot checks: ~360–700ms).
- `softQuery(...)` wraps apps / stages / daily / agents — one slow query returns partial data instead of blanking the block.
- Do **not** go back to `intm_zoho_deals` for pipeline stages unless data team repairs it and you re-benchmark under load.

### 5. Transient infra (not “fix in app” alone)

Logs also showed: `ENETUNREACH`, `ETIMEDOUT`, Zoho `CONNECT_TIMEOUT`, Render Postgres timeouts, local PG `57P02` crash notices. Stale cache / soft-fail help; they do not replace network health.

---

## Verified behavior (after stages rewrite)

Spot-checked via `computeAnalyticsBlock('pipeline', …)` against live DWH:

| Filter | Approx latency | Notes |
|--------|----------------|-------|
| `today` | ~700ms | Org App Fills can be 0 early/late day |
| `last_7_days` | ~360ms | App Fills ~450, breakdown + leaders present |
| `this_month` | ~410ms | App Fills thousands |
| Daniel Brown + `last_7_days` | ~500ms | App Fills:9; funnel KPIs may be 0% if stages are unmapped (order 99, e.g. “Application Approved”) |

**Known product quirk:** `STAGE_ORDER_SQL` only maps classic funnel stages; unmapped stages get order `99` and are **excluded from breakdown** (`stage_order <= 11`). Agent can have App Fills > 0 with empty breakdown — not a timeout bug.

---

## Local git situation (important)

`git pull origin build` previously **aborted** because local changes would be overwritten:

- `WORKING_NOTES.md`
- `apps/mytrion-crm/package.json`, `pnpm-lock.yaml`
- analytics CRM components under `apps/mytrion-crm/src/components/analytics/`
- `apps/mytrion-crm/src/mytrions/analyst/index.tsx`
- (+ related analyst files)

Before merging `origin/build`: **stash or commit** local work, then pull/rebase and resolve conflicts carefully (analytics was actively diverging on both sides).

Do not commit unless the user asks.

---

## Hard constraints (do not violate)

1. Every DB query through repos / wrappers — analytics uses `dwhQuery`, not raw routes.
2. ESM + `.js` extensions in `src/` imports; no `@/*` in backend source.
3. No `any`; no unjustified `as unknown as`.
4. DWH is **read-only**; `$n` placeholders (Postgres), not `?`.
5. Shared DWH pool is tiny — prefer cache, dedupe, parallelism ≤ 2, soft-fail over raising pool max casually.
6. Non-admins must not query another agent’s analytics.
7. Append dated notes to `WORKING_NOTES.md` for sessions; run `pnpm lint && pnpm typecheck && pnpm test` before push.

---

## How to run / smoke-test

```bash
pnpm dev:all
# API http://localhost:3001  Web http://localhost:5173
# Analyst: /m/analyst?category=sales
```

Smoke API (with auth cookie/token as your env requires):

```text
GET /v1/analytics/pipeline?range=last_7_days
GET /v1/analytics/pipeline?agent=…&agent_name=Daniel+Brown&range=last_7_days
GET /v1/analytics/pipeline?fresh=1&range=today
```

Direct compute (no HTTP) for SQL timing:

```bash
pnpm exec tsx -e "
import 'dotenv/config';
import { computeAnalyticsBlock } from './src/modules/analytics/service.ts';
import { closeDwhPool } from './src/integrations/dwh.ts';
const b = await computeAnalyticsBlock('pipeline', { range: 'last_7_days' });
console.log(b.kpis, b.breakdown.length);
await closeDwhPool();
"
```

---

## Sensible next work (if continuing)

1. **Unmapped stages in UI** — decide whether to show order-99 stages (Application Approved, etc.) in breakdown / funnel KPIs.
2. **Align Sales copy** with real stage names present in DWH (spot-check distinct `stage` on `public.zoho_deals`).
3. ~~Wire remaining categories (CS / Finance) to dimensions~~ — **done** (`support` / `receivables`).
   Optional follow-ups: expose the agent picker on Billing (the backend already scopes it), and
   reconcile Billing's raw open-invoice count with Finance's ≥ $1-owed rule if the two figures
   sitting side by side confuse anyone.
4. **Reconcile with `origin/build`** — stash/commit, pull, merge conflicts on analytics CRM + lockfile.
5. Optional: pause warmer more aggressively under consecutive statement timeouts; optional metrics on softQuery miss rate.
6. Do **not** “fix” blank dashboards by bumping `statement_timeout` alone without fixing SQL — that just hangs the shared DWH longer.

---

## Quick “is it broken again?” checklist

1. Server log: `ANALYTICS_DWH_ERROR` + `statement timeout` → which query label? (`pipeline.stages` should no longer dominate if still on `zoho_deals`).
2. Server log: `timeout exceeded when trying to connect` → pool stampede / network; check warmer + parallel UI fetches.
3. Server log: `column … does not exist` → schema drift; fix SQL, don’t mask with empty UI.
4. UI empty but 200 → check agent has zero fills in range (expected) vs breakdown filtered by stage_order.
5. Vite import errors under `analyst/tabs/` → path depth to `_shared` is `../../_shared/…`.

---

## One-liner for a new Claude session

> Analyst Sales dashboards send agent/date filters to `/v1/analytics/:dimension`; pipeline stages must use `public.zoho_deals` (not `intm_zoho_deals`); filtered cache + softQuery + parallel≤2 exist because the DWH pool is tiny and 30s timeouts blanked the UI — preserve those unless you have a better measured plan.
