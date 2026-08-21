---
name: customer-service-mytrion
description: Product facts for Customer Service Mytrion — live tabs (Home, Applications, Maintenance, Retention Cases, Open Pool, CITI Folder, Citifuel, Analytics), CS vs Sales retention, Desk vs comms, snapshot cache, assignee scope, leaderboard roster. Use when editing CS schema, repos, /cs routes, retention.cs_* touchpoints, CRM customer-service UI, csNav, or mytrions customer-service access.
---

# Customer Service Mytrion

CS desk. MytrionId **`customer-service`**, URL slug **`csmytrion`** (`/main/csmytrion`). Department **`customer-service`**. CRM pins `x-department-access: customer-service` and touchpoint `departmentAccess: ['customer-service']` (verified sessions ignore the header). Profile default: **Customer Retention**. **Standard must not auto-enter.** Admin-grant otherwise. `adminBypass: true`.

`customer-service` is **not** in `MYTRION_WRITE_ENFORCED` — writes are `requireDepartment`, not `requireMytrionWrite`. Layer-2 tab grants (`csTabs.ts`) are UI-only; the endpoint is the security boundary.

## Do not confuse

| Thing | What it actually is |
| --- | --- |
| **This desk** | CRM CS Mytrion (`apps/mytrion-crm/src/mytrions/customer-service/**`). |
| **`octane-customer-service`** | agent-gateway Telegram **support-bot** playbook. Different product. Token `TELEGRAM_BOT_TOKEN`. |
| **Horizon** | CRM Mini App inside Telegram (`HORIZON_BOT_TOKEN` / `HORIZON_BOT_SECRET`, webhook `/v1/telegram/horizon-webhook`). Maintenance `/bytes` exists because Mini App cannot fetch a cross-origin signed URL. Never put that token in agent-gateway. |
| **`/v1/retention/*`** | Sales/admin retention CRUD. Department **`retention`**. CS UI must not call it. |
| **`retention.cs_*`** | CS desk. Department **`customer-service`**. |
| **CITI Folder** | Retention Phase 3 (`retention_cases`). |
| **Citifuel Clients** | Zoho CRM `Citifuel_Clients`. |
| **Sales Open Pool** | Sales claims. CS Open Pool is **readonly**. |
| **Home tickets** | Zoho Desk deep links. Native `/v1/comms` Tickets tab is parked. |

## Live tabs (`csNav.ts` + `Shell.tsx`)

Mounted + clickable (not `soon`). Panels lazy-mount and stay mounted. `useCsRetentionRealtime` lives on the Shell (pool toasts fire on every tab).

| Tab | Kind | Source | Writes |
| --- | --- | --- | --- |
| **Home** | Dashboard | `cs.home.metrics` (Deluge) + `GET /cs/analytics/tickets/team-open` + scoped tickets analytics + `GET /cs/analytics/maintenance/count` | **None.** No fake streak / CSAT / Home leaderboard. |
| **Applications** | Apps / Clients / Card Tracking | `cs.applications.list` (COQL drain + per-tenant snapshot). Tracking is Deal-level, not Applications. | `POST /cs/applications/:id` + `/onboarding`. Edit_History + Deal mirror. |
| **Maintenance** | Cases (card / list / kanban) | Postgres `maintenance_cases`. **No Zoho.** | `POST/PATCH /cs/maintenance`. **No case delete** (set `Cancelled`). Attachments may delete. |
| **Retention Cases** | Phase 2 desk | `retention.cs_cases` / `cs_case_get` / `cs_desk_quota` | `retention.cs_case_outcome`, `retention.cs_log_attempt` (Phase 2 only). |
| **Open Pool** | Watch Sales pool | `retention.cs_cases` `{phase:sales, status:open_pool}` | **None.** Sales claims. |
| **CITI Folder** | Phase 3 bulk | `retention.cs_citi_list` | confirm / export / mark_sent (max **100** ids). |
| **Citifuel Clients** | Citi vs Octane clients | Zoho `Citifuel_Clients` `/cs/citifuel` | create / update / **real delete**. |
| **Analytics** | Tickets / Calls / Maintenance | DWH tickets+calls via servercrm; Maintenance SQL on `maintenance_cases` | **None.** Roster manager-only. |

Applications sub-tabs: **Apps in Process** = no `Carrier_ID`; **Clients** = has `Carrier_ID`; **Card Tracking** = `cs.carrier.trucking_number_request` (no `carrierParam` — CS has no Sales "own book"). Agent column is **Deal owner**, never Application Owner. Clients Tracking # is `POST /cs/applications/tracking` (bulk, max **2000** ids) — not the empty Applications tracking field.

Retention phases: `phase_1_agent` (Sales, view-only here) · `phase_2_retention` (actions) · `phase_3_citi` (CITI panel). Live Phase 2 outcomes: `claim` · `mark_pending` (Offer out) · `refused` · `out_of_business` · `escalate_citi`. Log Call 1 listen + Call 2 solution on channel `ringcentral` before Refused. **No Saved button** in the live UI (backend still has `saved` / `start_working`). Caps: **40** assignments/UTC day · Offer-out **≤15%** of open (min 1).

## Do not document as current

- **Data Center / Inbox / Service Center** — `soon` in Shell; **not mounted**. `DataCenter.tsx`, `cs.datacenter.deals`, and `POST /cs/data-center/deals` exist; do not treat as live.
- **Tickets** — `TICKETS_PARKED` (2026-08-03). Sales files Zoho Desk again; a native comms queue would read empty. `TicketConsole` stays gated off.
- **CsCopilot** — file + CSS exist; **not mounted**.
- **Home leaderboard** — live leaderboard is **Analytics** only (manager roster join).
- **`index.tsx` "Claims"** — stale label; the live tab is **Retention Cases**.
- **`/v1/retention`** setup CRUD / DWH sync — not this desk.
- **Maintenance kanban as a full-book board** — same **24-row page** as card/list. Not Collection's 500.

## Isolation / RBAC

| Store | Isolation |
| --- | --- |
| `maintenance_cases` | **No `tenant_id`.** Global on `carrier_id`. Gate is `requireDepartment(..., 'customer-service')`. |
| `retention_cases` (+ events / claims) | **`tenant_id`.** CS touchpoints still require `customer-service`. Non-admin list/get is **assignee-scoped** (empty if no Zoho id). Open Pool + CITI Folder are shared. |
| Applications / Citifuel | Zoho CRM org. Casing-resolved writes; unknown field = **400**, never Zoho silent no-op. |
| Desk tickets | Desk dept `DESK_DEPARTMENTS.cs` (`1057080000000323033`). |

Analytics: `GET /cs/context` is the only manager verdict (`isCsManager` — admin / all-dept / `CS_MANAGER_ROLE_MARKERS` substring on profile/role). Non-managers are **forced** to own Desk assignee / owner email. Unmatched → `{ unmatched: true }`, **never org-wide**. Manager leaderboard joins `/cs/analytics/roster`: Mytrion CS grant ∩ Desk email, **exclude marker-admins**. DWH is unscoped; the roster join **is** the department filter (QA 2026-08-07).

Home team-open: subjects `CRM Ticket:` or `Mini-app:` only. Exclude `Rejection Report:`. Cap 100/status × Open/On Hold/Escalated. KPI is derived from that list, not DWH.

## Writers — do not invert

- **Maintenance:** Postgres is SoT. Zoho `Maintenance` was migrated once (~2.7k rows; almost all `Completed`). No sync, no write-back. Register `/stats` `/meta` `/lookup` **before** `/:id`. Servercrm prepay ledger still sums Zoho `Total_Amount` for `Prepay / EFS` — Mytrion-created cases undercount until that is repointed. Carrier widget `createmaintenance` still writes Zoho and does **not** appear here. IDs `mtc_*` / attachments `mca_*`.
- **Applications:** Zoho Applications + Deal mirror. Snapshot is **per-tenant**, not per-user (`applicationsSnapshotCache`: soft **5m** / hard **30m**). FE cache **90s** keyed tab+search+page+filters. Save patches the snapshot in place. Facets describe the **whole snapshot** (after tab/search/filter), never the current page.
- **Citifuel:** Zoho `Citifuel_Clients`. Stats are server-built COQL — do not accept client COQL. Word search + status is filtered **after** the word page (widget parity). `decision-split` is Citi-vs-Octane over `Date_of_Request`.
- **Retention CS:** writes go through `retention.cs_*` (`riskClass: 'write'`). Open Pool is read-only for CS.
- Compensation defaults (independent, empty-only): completion **$5** · half **$2.50** · lead **$10**. Analytics bonus uses those rates server-side — do not recompute in the UI.

## API caps / pagination

| Surface | Server | UI |
| --- | --- | --- |
| Applications list | `perPage` default **200**, max **500**; drain max **60k** | **200**/page (`APPLICATIONS_PAGE_SIZE`) |
| Tracking bulk | max **2000** carrier ids | one call per Clients page |
| Maintenance list | `perPage` default **24**, max **100** | **24**; card = list = kanban |
| Maintenance `/stats` | unfiltered facets | header tiles |
| Maintenance list facets | strip the counted dimension (status tabs keep counts) | |
| Citifuel list | default **50**, max **200** | **50** |
| Retention CS cases / CITI list | default **200**, max **500** | **200** |
| CITI batch writes | max **100** ids | |

Search debounce **400ms** (Applications / Maintenance / Citifuel). Applications facets stay in component state so `useLoad` nulling data does not blank filter dropdowns.

## UI

- **Do not restyle** `MytrionShell` sidebar/header.
- `.cs-root` is a **token scope** (~8.7k `.cs-root .cs-*` rules). Light is default; `.dark-mode` is the override (inverted from the app).
- Maintenance default: unfiltered newest-first (Completed-heavy archive). Status tabs jump to the live few.
- Company picker fills **carrier id** from DWH `octane.dim_company` (49 names map to >1 carrier — show the id).
- Home ticket rows link `deskUrls.ts` (`…/octanefuel/customer-service/tickets/details/<Desk id>`), not `ticketNumber`.
- Failed Home metrics: error banner, not fake zeros. Analytics empty block must keep the **rejection reason** (bonus $0 vs load failed).

## Map

| Layer | Path |
| --- | --- |
| Schema | `src/db/schema/maintenance_cases.ts` · `retention_cases.ts` |
| Repos | `maintenanceCaseRepo`, `maintenanceAttachmentRepo`, `maintenanceCaseHistoryRepo`, `retentionCaseCsRepo`, `retentionPoolClaimRepo` |
| Routes | `csApplications.routes.ts`, `csMaintenance.routes.ts`, `csCitifuel.routes.ts`, `csAnalytics.routes.ts` |
| Touchpoints | `src/modules/touchpoints/catalog/csDeluge.ts`, `retentionCs.ts` |
| CS modules | `src/modules/customerService/**`, `src/modules/retention/csCaps.ts` |
| Snapshot | `src/lib/applicationsSnapshotCache.ts` |
| CRM API | `apps/mytrion-crm/src/api/cs.ts`, `csRetention.ts` |
| UI | `apps/mytrion-crm/src/mytrions/customer-service/**` · nav `csNav.ts` · tabs `csTabs.ts` |
| Taxonomy | `src/lib/mytrions.ts` ↔ `apps/mytrion-crm/src/access/mytrions.config.ts` (`department: 'customer-service'`) |

## Keep in sync

If you change CS **schema, /cs routes, retention.cs_* keys, nav/soon/parked flags, caps, or Applications snapshot TTL**, update this skill in the **same PR** (mirrors: `.claude/skills/customer-service-mytrion/`, `.cursor/skills/customer-service-mytrion/`, `.agents/skills/customer-service-mytrion/`). `.agents/` is gitignored; `git add -f` the skill like the Zoho mirrors.
