---
name: admin-mytrion
description: Product facts for Admin Mytrion — live tabs (Horizon AI, Knowledge, Train, Browser, User Management, Octane Telegram Users, Permission Sets, Carrier User Management + invitations, KPI, Data Loader, Client News, Deals, Escalation Routing, Audit/Vitest/Automation logs, Jobs, four schema browsers, Octane-Scope), allDepartmentAccess vs role admin, invites/access/schema writes, View-as vs Test-as vs kitchen. Use when editing adminTabs, CRM admin UI, /admin routes, mytrion access, permission sets, comms admin routing, data loader, or mytrions admin access.
---

# Admin Mytrion

RnD / platform desk at `/main/adminmytrion`. MytrionId **`admin`**. Tag **RnD**. **No department agent** (`agentKeyFor('admin')` → orchestrator). `department: 'admin'` is a **placeholder** — `departmentsForMytrions` drops it; it is **not** a `department_access` tag. Admins are gated by **`allDepartmentAccess`**, never by an `admin` department. Not in `MYTRION_WRITE_ENFORCED`. Default rail tab: **Knowledge Base** (`kb`).

Layer-2 tab grants (`adminTabs.ts` → permission sets) are **UI-only**; the endpoint is the security boundary. `canSeeTab`: all-dept sees every tab; scoped users filter; **absent grant = unrestricted** (including tabs added later). Empty array = scoped to nothing. Do not sell tab permissions as data security.

## Who can enter

| Layer | Who |
| --- | --- |
| **Tile / shell** | Verified `accessibleMytrions` includes `admin`. FE fallback: profile **Administrator**, role **CEO**, or `isAdmin` (`allDepartmentAccess`). |
| **True API admin** | `allDepartmentAccess` or `bypassRbac`. Seeded on Administrator (`DEFAULT_PROFILE_SEED`: all Mytrions, all-dept, home `null` → picker). |
| **`ctx.role === 'admin'`** | Zoho session = `allDepartmentAccess \|\| markerAdmin`. Marker = `ADMIN_PROFILE_MARKERS` (default `administrator,ceo`) **exact** match, plus `ADMIN_USERS` / `BYPASS_USERS`. |
| **Break-glass** | `ADMIN_USERS` / `BYPASS_USERS` — immovable from the app. Recovery if Admin is mis-configured. |

Granting the **`admin` Mytrion** (permission set / profile / override) **opens the shell**. It does **not** grant `allDepartmentAccess`. Schema, User Management, jobs, deals, KPI, Telegram directory still **403**.

Administrator is **overridable** (not pinned). A deny list on an all-access grant **downgrades** `allDepartmentAccess` (`enforceableAllDept`) so the deny actually enforces. **Last-admin**: `POST .../users/:id` with `allDepartmentAccess: false` is **409 `LAST_ADMIN`** if nobody else still resolves all-access. Access cache **10s**.

`requireRole('admin')` / `adminOnlyOptions` is **not** the same gate as `allDepartmentAccess`. The comment in `admin.routes.ts` that “every Zoho worker carries role admin” is **stale** — role is re-derived in `contextFromClaims`. Prefer `allDepartmentAccess` for new Admin writes.

## Parking / not the rail

No `soon` in `ADMIN_TABS`. The whole rail is live. Internal park only: Deals **Recovery** (`RECOVERY_TAB_ENABLED = false`).

**Not Admin tabs:** `/kitchen` (design-system KitchenSink, no session). Header **View as** (`ActAsPicker` — global). Horizon **Test as** (chat-scoped, `enableTestAs` on the Horizon AI tab only). Carrier **password resets** (pane under Registered companies). Profile / Role Defaults (User Management chips). `RadioToggleGroup` / `SchemaBrowser` (widgets). `GET/POST /admin/users` local password CRUD (not this UI).

## Live tab map (`adminTabs.ts` + `index.tsx`)

`carrier-invites` is a **child** of `carriers`, not a registry key — granting “Carrier User Management” means the screen. One `CarrierUsers` mount keeps both lists.

| Tab (nav id) | Kind | Primary APIs | Agents get wrong |
| --- | --- | --- | --- |
| **Horizon AI** (`horizon`) | Orchestrator chat | `POST /v1/agent` (no `admin` agent) | **Test as** ≠ header View-as. Separate store (`features/chat/testAs.ts`). |
| **Knowledge Base** (`kb`) | Corpus list | `GET /knowledge/{stats,docs}`; delete / verify | Search is **client-side**. Empty box pages **10**; typing fetches cap **200**. Chunks **100**/window. |
| **Train** (`train`) | Ingest | `POST /knowledge/embed` (JSON, `source: mytrion-admin`) | **Not** `/knowledge/upload`. Text only, **1MB**/file, **20**/batch. Queue is a **module store** — survives leaving the tab. `FF_KNOWLEDGE_INGEST_ENABLED`. |
| **Knowledge Browser** (`browser`) | Retrieval | `POST /knowledge/query` | Titles from a separate docs list (cap 200). Invalidate on scope chip. |
| **User Management** (`access`) | Zoho workers + defaults | `GET/POST /admin/mytrion-access/{users,profiles,roles}` | **allDepartmentAccess**. `impersonate: false`. Seed the form from **effective** all-dept, not the override row (Save would strip a marker admin). Single-Mytrion grant **auto-homes**. Sets are **additive** unless `override`. Modes: most-permissive wins; a set `read` cannot lower a grant from another layer. |
| **Octane Telegram Users** (`octane-telegram-users`) | Horizon links | `GET /horizon/telegram/links` | Read-only. `horizon_worker_telegram_links` after Zoho + Mini App bind. **allDepartmentAccess**. Not the carrier support-bot map. |
| **Permission Sets** (`permission-sets`) | Salesforce-style sets | `/admin/permission-sets*` | Snapshot GET + granular PATCH. Tab whitelist: **absent = all tabs**; `[]` = none. UI gating only. |
| **Carrier User Management** (`carriers` + `carrier-invites`) | Roster + invites | `/carrier-invitations`, `/carrier-registrations`, password-resets, `/support-bot/chat-map` | Sales **write** gate (`requireMytrionWrite('sales')`). Invite metadata/TTL override only if **real admin and not View-as**. Re-pointing a bot group: **DELETE old chatId first**. Resets are on the **registered** pane. |
| **KPI Collection & Data** (`kpi-data`) | Inspector | `GET /admin/kpi/*` | **Read-only**. Facts max **500**. `FF_KPI_COLLECTION_ENABLED`. |
| **Data Loader** (`data-loader`) | NocoDB journal | `GET /admin/data-loader/{config,batches}`; `POST .../revert` | This tab does **not** import. Writer is **NocoDB**. Allowlist: `client_news`, `client_news_reads`, `scope_risk_items`, `mytrion_calls`. Revert is the write. Page **10**, API max **200**. `adminOnlyOptions`. |
| **Client News** (`news`) | Mini-app feed | `GET/POST /client-news` | Create only. EN required. **4000** chars/locale (HTML counts). Server sanitizes. `important` + targeted carriers → Telegram push. List **100**. Gate is `role === 'admin'`. |
| **Deals** (`deals`) | Org-wide + transfer | `/admin/deals`, `POST .../transfer` | **allDepartmentAccess**. Transfers Deal **+ Contact + Account**. Browse **200**. Recovery **parked**. |
| **Escalation Routing** (`escalation-routing`) | Ladder | `/v1/comms/admin/*` | **Mounted.** NULL = **refuse loudly**, never a wildcard. Departments from **`hr_departments`**, not `KNOWN_DEPARTMENTS`. Readiness is **server-derived** — refresh after save, do not patch locally. ConfirmDialog at **panel root**. Candidates max **500**. |
| **Audit Log** (`audit`) | Human audit | `GET /admin/audit` + `/facets` | `source=human`. **Logins** = exact `auth.login` / `auth.zoho.login` / `mini_app.auth.login` — **not** `auth.` (that swept `auth.act_as`). Page **50**, export **10_000**. `impersonate: false`. Formula-injection guard on CSV/XLSX. |
| **Vitest Logs** (`vitest-logs`) | Fixture actors | same AuditLog `source=vitest` | Do not merge into Audit. |
| **Automation Logs** (`automation-logs`) | Run feed | `GET /admin/automation-logs` | Own table (migration **0118**). Same export ceiling. |
| **Jobs** (`jobs`) | pg-boss | `GET/POST /agent/jobs` | **allDepartmentAccess**. Trigger lookback **3–365**, limit **2000** (UI 45 / 500). Runs default **40**, max **100**. |
| **Mytrion / CMP / DWH / Verification DB** | Schema browsers | `GET /admin/{mytrion,cmp,dwh,verification}-schema` | **Metadata only. Never table rows.** Shared `SchemaBrowser`. **allDepartmentAccess**. CMP needs the MySQL tunnel. |
| **Octane-Scope** (`scope`) | Lifecycle map | `GET/POST /scope/risks` | Risk CRUD (blocker / red_flag / manual). Route gate is **internal audience**, not all-dept. |

Admin mutating calls that inspect the **real** admin use `impersonate: false` (access, permission sets, audit, jobs, KPI, schema, deals, data loader, Telegram directory). Do not send View-as headers on those.

## View-as / Test-as / kitchen (do not invert)

| Thing | Where | What it is |
| --- | --- | --- |
| **View as** | `MytrionShell` header (`ActAsPicker`) | Global impersonation (`x-act-as-zoho-user-id`). Chrome stays the **real** admin. Non-admin cannot View-as an all-access user. **Not an Admin tab.** |
| **Test as** | Horizon AI `ChatPanel` only | Chat-scoped. Must not write `octane.actAs.*`. |
| **Kitchen** | `/kitchen` | Design-system sink. No session. **Not Admin.** |
| **`/admin/agents`** | View-as roster | **allDepartmentAccess**. Default sales-filtered; `?all=1` lists everyone. |

## Data sources — which writes where

| Store | Admin reads | Admin writes |
| --- | --- | --- |
| **App Postgres** | Access, permission sets, audit, automation logs, KPI, data-loader journal, client news, scope risks, knowledge | Same (except schema browsers — catalog only) |
| **Zoho CRM** | Deals, worker directory | Deal + Contact + Account owner transfer |
| **DWH** | Carrier client picker, cards/operators | None |
| **CMP MySQL** | Schema metadata | None |
| **NocoDB** | — | **Outside this UI**; journaled in `bulk_change_log` |
| **Telegram** | Horizon worker links; support-bot chat-map | Chat-map set/re-point; news push |

## Fetching

| Surface | UI | API |
| --- | --- | --- |
| Carrier / KB / Data Loader pager | **10** | Data loader max **200** |
| Audit / Automation | **50** | max **10_000** (export one shot) |
| Knowledge list / search | **10** / **200** | max **200** |
| Knowledge chunks | **100** | max **500** |
| Train | **20** files, **1MB** | embed **1_000_000** chars |
| Deals browse | **200** | 200 |
| Routing candidates | **500** | max 500 |
| Client news | one list | **100** |
| KPI facts | — | max **500** |
| Jobs runs | **40** | max **100** |

## UI

**Do not restyle** `MytrionShell` sidebar/header. Access toggles use `RadioToggleGroup` (roving tabindex) — do not replace with independent chips. Escalation / Deals / Data Loader / Carrier confirms mount at the **page root** (`backdrop-filter` on a row clips `position: fixed`). `.admin` panels live in `admin.module.css`.

## Map

| Layer | Path |
| --- | --- |
| Nav / tabs | `apps/mytrion-crm/src/mytrions/admin/adminTabs.ts` · shell `index.tsx` |
| UI | `apps/mytrion-crm/src/mytrions/admin/**` |
| CRM API | `apps/mytrion-crm/src/api/{mytrionAccess,permissionSets,audit,automationLogs,adminDeals,adminKpi,dataLoader,commsAdmin,carrierUsers,clientNews,jobs,knowledge,mytrionSchema,cmpSchema,dwhSchema,verificationSchema,octaneTelegramUsers}.ts` |
| Routes | `admin.routes.ts`, `mytrionAccess.routes.ts`, `mytrionPermissionSets.routes.ts`, `auditLogs.routes.ts`, `dataLoader.routes.ts`, `kpiAdmin.routes.ts`, `commsAdmin.routes.ts`, `{mytrion,cmp,dwh,verification}Schema.routes.ts`, `clientNews.routes.ts`, `knowledge.routes.ts`, `scope.routes.ts`, `carrierMiniApp.routes.ts`, `horizonTelegramLink.routes.ts`, jobs in `tasks.routes.ts` |
| Access | `src/modules/access/mytrionAccessService.ts` · `src/lib/mytrions.ts` ↔ `apps/mytrion-crm/src/access/mytrions.config.ts` |

## Keep in sync

If you change Admin **tabs, gates (`allDepartmentAccess` vs role), caps, parked flags, or which store a write hits**, update this skill in the **same PR** (mirrors: `.claude/skills/admin-mytrion/`, `.cursor/skills/admin-mytrion/`, `.agents/skills/admin-mytrion/`). `.agents/` is gitignored; `git add -f` the skill like the Zoho mirrors.
