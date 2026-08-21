---
name: collection-mytrion
description: Product facts for Collection Mytrion — finder-owned cases/invoices/Array reports, stages, remaining>$100, API caps, invoice error-vs-empty, --co-pad/svh. Use when editing Collection schema, repos, routes, CRM collection UI, collectionNav, or mytrions collection access.
---

# Collection Mytrion

Collection is a workspace product skill. Siblings: Sales, Customer Service, Billing, HR, Admin.

Finder-owned snapshots in app Postgres. The desk is **read-only**. Tables have **no `tenant_id`**; isolation is `canReadCollectionSnapshot` (only the `octane` tenant sees the book; others get empty pages).

## Seeded book (product, Aug 2026)

| Table | Rows | Notes |
| --- | --- | --- |
| `collection_cases` | **494** | **322 open / 172 closed**. UNIQUE `carrier_id`. |
| `collection_case_invoices` | **526** | Belong to a case; `ON DELETE CASCADE`. |
| `array_reports` | **9258** | Metro 2 snapshot per `(carrier_id, report_period)`, May–Aug 2026. |

## Writers — do not invert

- **Cases + invoices:** the **finder** upserts here. It keeps a case only while remaining debt is **> $100**. Finder does **not** write Zoho.
- **Array reports:** this table is what the desk reads. The live **6h cron still writes Zoho**.
- Routes expose **no writes**. Advancing a case is not an API. The collection *agent* (`src/modules/agents/manifests/collection.ts`) still has Zoho tools — that is not the desk.

## Stages / close reasons

Status: `open` | `closed`.

Stages (kanban columns; a closed case can still sit on an early stage, e.g. left CMP from intake):

`intake` · `connected` · `with_agency` · `payment_plan` · `skip_tracing` · `small_claims` · `closed_successfully` · `case_lost`

Close reasons: `paid_in_full` · `below_threshold` · `left_cmp` · `manual` · `case_lost`

## API (`/v1/collection/*`)

Gated on department **`collection`** (`requireDepartment`; CRM sends `x-department-access: collection`).

| Route | Cap | Default (`normalizePagination`) |
| --- | --- | --- |
| `GET /collection/cases` | **500** (board needs every open row; ~322) | 50 |
| `GET /collection/cases/:id/invoices` | **200** | 50 |
| `GET /collection/array-reports` | **100** | 50 |

Pagination is mandatory (limit+offset). Register `/array-reports/facets` **before** `/:id`. Repos: `collectionCaseRepo`, `arrayReportRepo`, `collectionAccess`. No raw SQL in routes.

Aggregates (open/closed/remaining/by-stage, Array totals) describe the **whole book**, never the current page. Invoices load **only on case detail** — the list already has `issue_invoice_count` and debt totals.

## Map

| Layer | Path |
| --- | --- |
| Schema | `src/db/schema/collection.ts` · migration `0127_collection_workspace.sql` |
| Repos | `src/repos/collectionCaseRepo.ts`, `arrayReportRepo.ts`, `collectionAccess.ts` |
| Routes | `src/routes/v1/collection.routes.ts` |
| CRM API | `apps/mytrion-crm/src/api/collection.ts` |
| UI | `apps/mytrion-crm/src/mytrions/collection/**` · nav `collectionNav.ts` |
| Taxonomy | `src/lib/mytrions.ts` ↔ `apps/mytrion-crm/src/access/mytrions.config.ts` (`department: 'collection'`) |

## UI

Tabs: Home, Array Reports, Collection Cases (`collectionNav.ts`). Layer-2 tab access is UI-only; the endpoint is the security boundary.

- **Cases:** list (**15**/page) + **kanban** (limit 500) + detail. Scope tabs `open` / `closed` / `all` like Verification. Stages are columns, not a second status.
- **Array:** list (**50**/page) + detail. **No kanban.** Pattern is Watch: filter+page cache key, `lastGood` so a filter change does not blank the table, KPI tiles describe the **whole** snapshot.
- **Do not restyle** `MytrionShell` sidebar/header.

Invoice panel (`invoicePanelKind`): failed fetch + no rows = **error**, not empty. Empty is only a successful zero-item payload. Invoice pages are **50** (under the 200 cap); cache key includes page+limit.

Gutter: `--co-pad` (`clamp(20px, 3vw, 34px)`) on `.co-page` / `.cc-list` / `.cc-case`. Flush-to-shell was a screenshot bug. **No bare `vh`** — use `svh` (board: `min(72svh, 760px)`).

Visual references (copy structure, do not restyle those Mytrions):

- Cases list/detail → Verification applicant queue
- Kanban → Sales Retention board
- Array → Watch

## Keep in sync

If you change Collection **schema, routes, nav, stages, or API caps**, update this skill in the **same PR** (mirrors: `.claude/skills/collection-mytrion/`, `.cursor/skills/collection-mytrion/`, `.agents/skills/collection-mytrion/`). `.agents/` is gitignored; `git add -f` the skill like the Zoho mirrors.
