---
name: sales-mytrion
description: Product facts for Sales Mytrion — live tabs (Home, Inbox, Data Center, Create, Carriers, Retention, Automations, Dashboard, My Tasks, Call Hub, admin-only Verification), parked Tickets, Zoho vs DWH vs EFS vs app Postgres writes, View-as zoho_user_id, pagination caps. Use when editing Sales nav, CRM sales UI, data-center/inbox/call-hub/sales-kpi/desk/retention/verification-application routes, or mytrions sales access.
---

# Sales Mytrion

Sales is the **second workspace product skill** (Collection is first). Next: CS / Billing — do not invent Verification Mytrion or the rest.

Self-service desk at `/main/salesmytrion` (`department: 'sales'`). Write-enforced (`MYTRION_WRITE_ENFORCED`). Profile defaults: Sales Agent / Plus / Assistant, Referral Standard Plus, Standard Plus. `profileContainsAny: ['Sales Agent']`. Admin bypass. View-as remounts the shell (`actAsKey` / `x-act-as-*`). **Exception:** `GET /data-center/clients` does **not** read those headers — pass `?zoho_user_id` or an admin sees their own empty roster.

## Parking (do not invert)

Two gates, one predicate (`isSectionParked` in `salesData.ts`):

- **`comingSoon: true` in NAV_GROUPS** — parked for **everyone**. Today: **Tickets** only. `TICKETS_ENABLED` is derived from that flag. Create files **Zoho Desk**; do not jump to Tickets or poll `/v1/comms/unread`.
- **`ADMIN_ONLY_SECTIONS`** — parked for non-admins only. Today: **Verification** (Sales projection of the agent's applications — not Verification Mytrion).

`SOON_TABS` may still hold leftover copy for tabs that already shipped. The invariant is parked ⊆ `SOON_TABS`, not equality. Do not re-park Tasks: Manager assigns into `mytrion_worker_tasks`; this tab is the agent half of that loop.

## Live tab map

| Tab (nav id) | Purpose | Primary APIs | Agents get wrong |
| --- | --- | --- | --- |
| **Home** (`home`) | Workday (NY 10–19), snapshot, announcements, inbox preview, app streak | `dashboard.home_snapshot` + `loadDebtorsHomeSummary`; then `inbox.announcements`, `activity.agent`, `/inbox/messages` limit **6** | Do **not** use `GET /sales/bootstrap` — its debtor totals skip `filterDebtors`. Snapshot is the first HTTP/2 wave; the rest wait (`homeLoadGate`). |
| **Inbox** (`inbox`) | Owner-scoped messages, cursor pages, optimistic read/delete | `GET/PATCH/DELETE /inbox/messages` → `mytrion_inbox_messages` | Not Zoho `inbox.list`. View-as via `owner_id`. Filters are server-side. |
| **Data Center** (`records`) | Clients / Leads / Deals / Rejection Reports / Money Codes | Clients: `GET /data-center/clients` (one DWH query, whole roster). Leads/Deals: COQL `GET /data-center/leads\|deals`, writes `PATCH` same. Rejections: `GET /data-center/rejections` (app PG). Money codes: `money_code.list` / `money_code.void` | Loyalty tiers from **monthly** gallon fields, never the cycle `gallons` string. Client debt is DWH `cmp_invoice` (~3h), not live CMP. Lead field is **`Status`**, not `Lead_Status`. Rejections are **not** a live Desk scan — Desk webhook → our table; owner-scoped (id-OR-name); `?all=1` is admin opt-in. Money **codes are never shown**. Client modal cards: **EFS** roster (`efs.cards`); DWH only `cardType` / fallback. |
| **Create** (`create`) | Ticket · Escalation · Lead | `createDeskTicket` / `createEscalation` (Desk, 20 MB, one multipart); `leads.create` (Zoho CRM) | Tickets/escalations do **not** land in `/v1/comms`. No “open it now” jump. Escalation has no department picker (Deluge routes). |
| **Carriers** (`carriers`) | Broker-snapshot search → create lead | `sales.carriers_search`; `leads.create` | Bound to **50** in UI (catalog cap 100). Refine the query — do not raise the limit toward 200–500. |
| **Retention** (`retention`) | My cases (kanban/list) + Open Pool | `retention.my_cases` / `pool_list` / `pool_claim` / `pool_quota` / `record_outcome` / `log_attempt` (limit **200**) | Pool is never your own former deals. **2 claims / UTC day**, reason required. Dissatisfied cards are **locked** for Sales. Not a separate nav tab (`PoolTab` is a pane). |
| **Automations** (`auto`) | Self-serve CS / Billing / Verification actions | `AUTO_LIST` + `autoRunners` (EFS writes, DWH/CMP reads, `zapier.ticket_email`, `browser.boca` / `browser.close_application`); invoice bytes `GET /sales/invoices/:id/:type` | No `soon: true` on the catalog today — all ids are runnable. Limit change max **350** gal. Invoice download is **ownership-gated** (not a bare invoice id). Fetch invoices with an explicit limit (UI uses 500). |
| **Dashboard** (`dash`) | Sales · Company · Debtors · Power BI | `dashboard.agent_sales` / `dashboard.company` / `dashboard.debtors`; Power BI is an iframe | 5-min **localStorage** cache keyed by effective Zoho id (`dashCache`). Debtors = Billing floors: PENDING / PARTIALLY_PAID, remaining **≥ $1**, age **≥ 2 days**, hard = **15+**. Do not truncate the sales dash payload. |
| **My Tasks** (`tasks`) | Agent kanban over manager assignments | `GET /sales/tasks`, `PATCH /sales/tasks/:id/status` → `mytrion_worker_tasks` | PATCH needs **`version`**. 50/page, cap 100. Badge = open tasks never opened in the detail modal. |
| **Call Hub** (`callHub`) | Merged Mytrion + Zoho call history | `GET /sales/call-hub/calls` | Identity from View-as, **not** a query spoof. 25/page, cap 50. UI filters All / Mytrion / Zoho (no Gong tab). Softphone is global, not this tab. |
| **Verification** (`verification`) | Admin-only: complete intake, watch underwriting | `GET /verification/applications` (first **24**, client-side filters); writes `/verification/applications/:id*` | **Not** Verification Mytrion (`/verification/flow/*` is the other desk). Apps are created by the Deal poller (`automation.verification.case-ingest`), not this tab. `POST /verification/applications` is **admin-only backfill**. Red/green **is** `verification_process`. Completeness is **server** verdict — the browser must not invent a gate. |

## Data sources — which writes where

| Source | Sales reads | Sales writes |
| --- | --- | --- |
| **Zoho CRM** | Leads, Deals, notes, calls, `activity.agent`, announcements | `leads.create`; `PATCH /data-center/leads\|deals`; notes; blueprint transitions; post-call Status |
| **Zoho Desk** | — (Tickets tab parked) | Create ticket + escalation only |
| **App Postgres** | Inbox, tasks, rejection reports, verification applications, retention cases | Inbox read/delete; task status; retention outcomes/claims; verification intake |
| **DWH** | Client roster, app-stats, dashboards, debtor overlay | None |
| **CMP** | Invoices, payments, debt figures (via touchpoints / DWH snapshot) | None from the desk |
| **EFS / WEX** | Live cards, balances, last-used | Card activate/deactivate/limits/info/override; money-code draw/void; BOCA / close-app |
| **servercrm** | Carrier search, many Auto touchpoints | Same (Deluge / EFS proxies) |

Finder/collection cron and the Verification underwriting desk are **not** this Mytrion. Mini-app invite / password-reset writes use `requireMytrionWrite('sales')`.

## Fetching

Pagination is mandatory on list routes. Do not add unbounded “load all” clients.

| Surface | UI page | API cap / default |
| --- | --- | --- |
| Inbox | **25** (cursor) | max **100**, default 25 |
| Home inbox preview | **6** | same route |
| Tasks | **50** | max **100**, default 50 |
| Call Hub | **25** | max **50** |
| Carriers search | **50** | catalog max **100** |
| Retention my/pool | one shot **200** | route max 200 (ops list 2000 is not this UI) |
| Money codes | **25** | max **200** |
| Verification apps (Sales tab) | first **24** only | max **200**; filters are **client-side** |
| Leads / Deals COQL | whole owner book | **2000** |
| Clients roster | whole owner book | one DWH query — do not add a second loyalty round-trip |
| Client activity | load-more **20** | growing limit |
| Auto invoices | **500** | do not omit limit |
| Rejections | no UI pager today | `normalizePagination` default **50**, repo max **200** |
| Dashboards | — | 5 min localStorage / user id |

Caches: `dedupedFetch` (inbox 30s, in-flight share); `useCachedLoad` / `_shared/swrCache` (`lastGood` so a refresh does not blank); dash `localStorage`. Invalidate on write (leads after create, inbox on WS/delete). `money` is whole dollars (dash aggregates); `moneyExact` is cents (CMP invoices).

## Map

| Layer | Path |
| --- | --- |
| Nav / parking | `apps/mytrion-crm/src/mytrions/sales/redesign/salesData.ts` · `soonTabs.ts` |
| UI | `apps/mytrion-crm/src/mytrions/sales/**` · shell `redesign/Shell.tsx` |
| CRM API | `apps/mytrion-crm/src/api/{dataCenter,inbox,callHub,salesKpi,desk,touchpoints,verificationFlow,carrierUsers}.ts` |
| Routes | `src/routes/v1/{dataCenter,inboxMessages,callHub,salesKpi,desk,retention,verificationApplications,verificationWriteback,rejectionReports,salesInvoices,salesCardReports}.routes.ts` |
| Touchpoints | `src/modules/touchpoints/catalog/**` (`AUTO_LIST` ids ↔ runners) |
| Taxonomy | `src/lib/mytrions.ts` ↔ `apps/mytrion-crm/src/access/mytrions.config.ts` |

## UI

Horizon tokens (`ss-horizon.css`, `.ss-card-h`). Shared page chrome is `SalesPage` / `sales-page.css` — the top bar is the **only** section name; tabs do not repeat it. One `ss-fu` mount. Accent buttons use `var(--on-accent)`, not `#fff`. Modals: `max-height: 100%`, not `vh`. Dates/workday: **`America/New_York`**. **Do not restyle** `MytrionShell` sidebar/header.

## Keep in sync

If you change Sales **nav, parking, tabs, routes, caps, or which store a write hits**, update this skill in the **same PR** (mirrors: `.claude/skills/sales-mytrion/`, `.cursor/skills/sales-mytrion/`, `.agents/skills/sales-mytrion/`). `.agents/` is gitignored; `git add -f` the skill like the Zoho mirrors.
