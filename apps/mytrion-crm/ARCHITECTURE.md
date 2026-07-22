# Mytrion external app — architecture & handoff spec

This is the architecture doc for the **Mytrion** external React app. It replaced the old single
Zoho-SDK chat widget with a multi-department app. Identity has since moved a second time: from
URL params (the original shim contract, kept below for history) to a **verified Zoho OAuth
session** — workers sign in with their own Zoho account and the backend mints a Bearer session.

> Status: **live app.** Sales is a full multi-tab workspace (`mytrions/sales/redesign/` — Home /
> Inbox / Tickets / Open Pool / Data Center / Create / Automations / Dashboard / Carriers, wired
> to Desk/CRM/servercrm + WebSockets); Finance is redesigned; other Mytrions range from scoped
> chat shells to in-progress panels. Deployment (root mount + SPA fallback + committed `app/`
> build) is wired. See README.md for the current quick-start.

---

## 1. The pivot (what changed and why)

- **No Zoho Embedded App SDK on our side.** The old `apps/mytrion-crm/src/zoho/*`, `useZohoUser`, org-variable
  config, and the Zoho HTTP proxy are **deleted**.
- **Zoho side = a thin internal widget** (a tiny Deluge/HTML snippet you create in CRM) whose only
  job is: read the current CRM user → redirect to this app with identity as URL values.
- **This app reads identity from the URL** (`context/userContext.ts`), routes to the right
  **Mytrion** by an access table, and talks to the backend **same-origin** at `/v1/*`.

We always receive four values: `userId`, `profile`, `role`, `userName`.

---

## 2. Identity — Zoho OAuth session (supersedes the URL contract)

> The original URL contract (`/m/:mytrion?uid=…&profile=…&role=…&uname=…` populated by a Zoho
> shim) is **retired**. URL params no longer carry identity; `/m/billing` etc. are plain in-app
> routes. The §8 "advisory params" decision is superseded by this section.

- `api/auth.ts` — `beginZohoLogin()` redirects to the backend's Zoho OAuth start (authorization-
  code flow, `FF_ZOHO_OAUTH_ENABLED` server-side); `completeZohoCallbackIfPresent()` finishes the
  exchange. The **backend** talks to Zoho and reads the CRM user — the browser never sees Zoho
  credentials.
- `api/session.ts` — the minted Bearer session (`octane.session.v1` in localStorage):
  `{ accessToken, refreshToken, worker }` where `worker` is the VERIFIED identity
  (zohoUserId / userName / profile / role). `api/transport.ts` attaches the Bearer and
  auto-refreshes on 401.
- Admin **View-as** (`api/impersonation.ts`): only `x-act-as-zoho-user-id` is sent; the backend
  verifies the target against the CRM directory, gates it to admins, and audits it.

---

## 3. Context ingestion — `apps/mytrion-crm/src/context/`

- `userContext.ts` — `contextFromWorker(session.worker)` maps the verified session onto
  `UserContext`; the only non-session path is the explicit dev bypass (`VITE_DEV_MOCK_AUTH=1`,
  mock admin) so `vite dev` can run standalone.
- `UserContextProvider.tsx` — no session → renders `LoginGate` (sign-in screen); with a session
  provides `UserContext` via `useUserContext()`.

`UserContext = { userId, profile, role, userName, trusted }` (`trusted` is false only for the
dev mock).

---

## 4. Access model — `apps/mytrion-crm/src/access/`

**One declarative table** decides who enters each Mytrion: `mytrions.config.ts`.

```ts
MytrionAccessRule = {
  id, title, icon, blurb,
  department,        // canonical backend slug forwarded on chat/knowledge calls
  allDepartments,    // true → knowledge query sends allDepartments:true (admin-style)
  allowedProfiles[], // DEFAULT access by CRM profile (case-insensitive)
  allowedRoles[],    // optional access by CRM role
  allowedUsernames[],// ADDITIVE override: named users also get in, regardless of profile
  adminBypass,       // ADMIN_PROFILES/ADMIN_ROLES also get in
  status,            // 'ported' | 'new'
  portedFrom?,       // existing Zoho folder this is ported from
}
```

- **Profile = default.** **Username = additive override** (the one place to write "these users also
  get Mytrion X" → `allowedUsernames`). **Admin = bypass.**
- ⚠️ **EDIT the placeholder profile/role/user names** in `mytrions.config.ts` to your real Zoho values.
- `resolveAccess.ts`: `resolveAccessibleMytrions(ctx)` → `{accessible[], isAdmin}`; `canAccess(ctx,id)`.
- `normalizeDept.ts`: trim→lowercase→hyphenate to match backend canonical slugs.

---

## 5. Routing — `apps/mytrion-crm/src/app/`

| Path | Component | Behavior |
|------|-----------|----------|
| `/` | `Landing` | resolve access → 0: `Forbidden` · 1: auto-`Navigate` to `/m/{one}` · 2+: `MytrionPicker` |
| `/m/:mytrion` | `MytrionGuard` | bad slug → `NotFound`; not allowed → `Forbidden`; else lazy-load the module |
| `*` | `NotFound` | 404 |

Modules are lazy (`mytrions/registry.ts`) so a Sales agent never downloads the Admin bundle (verified:
the build code-splits one chunk per Mytrion).

---

## 6. Per-Mytrion structure — `apps/mytrion-crm/src/mytrions/<id>/`

Every Mytrion is `mytrions/<id>/index.tsx` with a **default export**. Two shapes exist today:
- **Bespoke workspaces** — Sales (`sales/index.tsx` re-exports `sales/redesign/`: Shell + nine
  tabs + live data layer + WebSocket badges) and Finance's redesign. These own their whole UI.
- **Scaffold Mytrions** — `<MytrionScaffold id=…>` (shared `MytrionShell` chrome + the scoped
  `ChatPanel`), the starting shape for departments whose panels aren't built yet.

**Shared (do not duplicate):** `features/chat/*` (the AI chat surface), `components/*` (Card/Badge/
StatusMessage/KeyValueList), `api/*` (transport + stream). A Mytrion that's "chat + dept scope" is
mostly shell + `ChatPanel`.

### Porting map (existing Zoho/Vue widget → this Mytrion)

Reuse **logic only** (formatters, endpoint maps, filter/pagination, constants) — NOT Vue
templates/reactivity. Existing widgets live in `~/Desktop/Octane-Project/zoho-octane/app/`.

| Mytrion | slug | from (`zoho-octane/app/`) | reuse highlights | backends |
|---------|------|---------------------------|------------------|----------|
| Admin | `admin` | `agent-scope` | closest to current code: AS_STAGES graph (Vue Flow→React Flow), scope-color constants, toast logic; knowledge/chat/scope map 1:1 to `api/*` | octane-ops `/v1` (knowledge, chat, scope) |
| Sales | `sales` | `self-service` | **heaviest**: impersonation (`effectiveUser`), reconnecting WebSocket, SSUtils formatters, large servercrm/DWH endpoint map (carrier balance/cards/invoices/EFS/WEX/BOCA) | servercrm REST + octane-ops `/ai/*` + browser-automation svc + WS |
| Billing | `billing` | `billing-mytrion` | deal/transaction/debtor filter+pagination→useMemo, currency/date formatters, split-payment UI, read-only-role gate (now via access config) | servercrm REST; rewrite ZOHO.CRM.* → `/v1` |
| Finance | `finance` | `mytrion-finance` | **cleanest** (client already framework-agnostic): octane-client fetch→shared transport, date presets, card-masking, 7-route+4-subtab structure→`routes.ts`, pattern classification | servercrm/DWH REST |
| Customer Service | `customer-service` | `mytrion-customer-service` | column defs, picklist colors, DEAL_FIELD_MAP, modal validation→Zod, DWH ticket/call analytics | servercrm + Zoho Desk REST |
| Retention | `retention` | — (NEW) | stub: churn signals, win-back, metrics | TBD |
| Verification | `verification` | — (NEW) | stub: verification queue, checklist, audit trail | TBD |
| Manager | `manager` | — (NEW) | stub: team metrics roll-up, cross-dept KPIs (scope depends on §8 decision) | TBD |

> Sales' full endpoint inventory (carrier/card/EFS/WEX/invoice/transaction/automation/WS) is large —
> see the original `self-service/js/app.js`. When porting, keep the endpoint host split: live
> CMP/DWH/EFS/WEX go to **servercrm**; AI/RAG/CRM-proxy go to **octane-ops `/v1` (or `/ai`)**.

---

## 7. Backend forwarding (`/v1`, same-origin)

- **Chat** (`api/stream.ts`, `api/chat.ts`): forward user context FLAT, snake_case, on every call —
  `{ zoho_user_id, user_name, profile, role, department_scope }` + `message`/`conversationId`.
  `department_scope` = the active Mytrion's `department` (null for admin/broad). Conversation list is
  scoped by `zoho_user_id`. These are **owner/audit** context, not auth.
- **Knowledge / RBAC**: no per-user identity. Send the normalized `department` slug — `department` on
  ingest, `departmentAccess[]` + `allDepartments` on query. Admin sends `allDepartments:true`.
- **Auth**: the shared `x-api-key`, held by the **backend**, is the real boundary. In dev the app
  sends `VITE_API_KEY`; in prod it sends **no key** (same-origin) — see §8.

---

## 8. Trust & auth (decided)

- **The Bearer session is the boundary (DECIDED — supersedes the "advisory URL params" model).**
  Identity comes from the verified Zoho OAuth session (§2); the backend re-derives role and
  department access from the verified Zoho profile/role on EVERY request
  (session-authoritative RBAC). Client-supplied identity/department headers are ignored for
  signed-in users — `x-department-access` assertions in the api clients are legacy no-ops kept
  only for the rollback flag.
- **Act-as is admin-only and audited** — the target's authority is looked up server-side in the
  CRM directory, never taken from headers.
- The old "same-origin auth without a key" open question is resolved by the session: prod sends
  the Bearer token; the static `x-api-key` remains a dev/server-to-server path only.

---

## 9. Deployment (wired)

The app builds to `apps/mytrion-crm/app/` (vite `base: './'`, relative assets), which is
**committed** — the Docker runtime stage copies it and the backend serves it same-origin with an
SPA fallback for `/m/:mytrion` deep links. Ship a UI change by rebuilding
(`pnpm -C apps/mytrion-crm build`) and committing `apps/mytrion-crm/app/`. Client export helpers
(jsPDF + pdf/excel/download utils) are vendored under `public/vendor/mytrion/` and ride along in
the build — no runtime CDN loads.

---

## 10. Open decisions (remaining)

1. **Admin/Manager/Finance scope**: are managers/finance **hierarchical** (retrieve across all
   departments like admin, `allDepartments:true`) or own-slug only? Sets their `department_scope`.
   (Manager's `allDepartments` is currently `false`.)
2. **Scaffold Mytrions** (retention/verification/manager/…): which gets a bespoke workspace next,
   following the Sales redesign's shape.

---

## 11. History — original porting plan

The porting map in §6 and the file map below describe the original skeleton handoff; they remain
as background for porting the remaining Mytrions.

**File map of the skeleton**

```
apps/mytrion-crm/src/context/    userContext.ts, UserContextProvider.tsx
apps/mytrion-crm/src/access/     mytrions.config.ts, resolveAccess.ts, normalizeDept.ts
apps/mytrion-crm/src/app/        router.tsx, Landing.tsx, MytrionPicker.tsx(+css), MytrionGuard.tsx, Forbidden.tsx, NotFound.tsx
apps/mytrion-crm/src/mytrions/   registry.ts, _shared/MytrionShell.tsx(+css), _shared/MytrionScaffold.tsx, <8 ids>/index.tsx
apps/mytrion-crm/src/api/        transport.ts, stream.ts, config.ts, chat.ts   (refactored same-origin)
apps/mytrion-crm/src/features/chat/  (reused as-is; ChatPanel/useChat now take UserContext + department)
```
