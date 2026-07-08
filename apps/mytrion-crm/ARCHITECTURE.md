# Mytrion external app — architecture & handoff spec

This is the skeleton + contract for the **Mytrion** external React app. It replaces the old single
Zoho-SDK chat widget with a multi-department app where **Zoho is a thin shim** that redirects here
with the user's identity in the URL. Hand this file to the design agent (Claude Design) to flesh out
each Mytrion's UI.

> Status: **scaffold complete, builds clean** (`pnpm -C apps/mytrion-crm build`). Per-Mytrion bodies are stubs
> (shared shell + scoped chat + a "panels to build" checklist). The deployment wiring and the
> per-Mytrion panels are the remaining work.

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

## 2. URL contract (Zoho shim → this app)

```
https://<host>/m/:mytrion?uid=<userId>&profile=<profile>&role=<role>&uname=<userName>[&ts=<epochMs>&sig=<hmacHex>]
```

- `:mytrion` — destination slug (`admin|sales|billing|finance|retention|verification|customer-service|manager`).
  **Optional**: if the shim can't pick one, target `/` and the app resolves the landing (picker / auto-enter).
- `uid, profile, role, uname` — always present, URL-encoded.
- `ts, sig` — optional trust params (see §8 trust model). Currently **advisory** (captured, forwarded, not verified client-side).

On load, `UserContextProvider` parses these **once**, then **strips them from the address bar**
(`history.replaceState`) so identity isn't bookmarked/re-shared. `/m/billing` is the clean canonical
in-app URL; cross-Mytrion navigation is client-side (no re-redirect through Zoho).

### The Zoho shim (you create this in CRM — pseudo/Deluge)

A widget or button whose HTML reads the user and redirects. Sketch:

```javascript
// In a Zoho widget that DOES have the SDK (or a Deluge button that has the user in context):
ZOHO.embeddedApp.on("PageLoad", function () {
  ZOHO.CRM.CONFIG.getCurrentUser().then(function (res) {
    var u = res.users[0];
    var base = "https://octane-ops-ai.onrender.com/m/" + pickMytrion(u);  // or "/" to let the app decide
    var qs =
      "uid=" + encodeURIComponent(u.id) +
      "&profile=" + encodeURIComponent(u.profile.name) +
      "&role=" + encodeURIComponent(u.role.name) +
      "&uname=" + encodeURIComponent(u.full_name);
    window.open(base + "?" + qs, "_blank");   // or location.href to navigate in place
  });
  ZOHO.embeddedApp.init();
});
```

`pickMytrion(u)` can map profile→slug, or just omit the slug and let this app's picker resolve it.
The shim is the **only** place any Zoho SDK code now lives.

---

## 3. Context ingestion — `apps/mytrion-crm/src/context/`

- `userContext.ts` — `readUserContext(search)` → `{ok, context}|{ok:false,error}`. Requires all four
  values; in `import.meta.env.DEV` falls back to a mock admin so `vite dev` works standalone.
- `UserContextProvider.tsx` — reads once, strips params, provides `UserContext`; `useUserContext()`
  hook for any component. Missing/invalid → renders the "open from CRM" fallback.

`UserContext = { userId, profile, role, userName, ts?, sig?, trusted }`.

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

Every Mytrion is `mytrions/<id>/index.tsx` with a **default export** that renders `<MytrionScaffold id=…>`
(shared `MytrionShell` chrome + the scoped `ChatPanel` + a "panels to build" checklist). Uniform shape;
the design agent adds panels per Mytrion.

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

## 8. Trust & auth (decided + open)

- **URL params are advisory (DECIDED).** They drive UI/routing only and are spoofable. The security
  boundary is the backend (`x-api-key` + server-side `department_access` RBAC). Spoofing `profile=`
  only reaches a Mytrion **shell**, not data the backend won't release. `ts`/`sig` are captured and
  can be forwarded (`x-octane-sig`/`x-octane-ts`) for future HMAC verification; the browser never
  holds the secret.
- **OPEN — same-origin auth to `/v1`:** in prod the browser sends no `x-api-key`. The backend must
  accept same-origin widget requests without it (e.g. Origin/Referer check, a widget-scoped route
  prefix, or a short session minted when the app loads). Decide before launch.

---

## 9. Deployment (remaining wiring — not done in the skeleton)

The app builds to `apps/mytrion-crm/app/` (vite `base: './'`, so assets are relative and work at any mount point).
**`apps/mytrion-crm/app` was intentionally left at the previous committed build** so the current `/widget` deploy
isn't broken mid-pivot. To go live:

1. **Decide the mount point.** URL contract uses **root** `/m/:mytrion`. Either:
   - serve the app at **root `/`** (recommended; matches the contract), or
   - keep it at `/widget` and set a router `basename="/widget"` + adjust the shim URL.
2. **SPA fallback (required).** Deep-links like `/m/billing` have no file on disk — the server must
   serve `index.html` for any non-`/v1`, non-asset path. Update the static host
   (`src/plugins/widgetStatic.ts`) or add a catch-all that returns the app's `index.html`.
3. **Rebuild + vendor:** `pnpm -C apps/mytrion-crm build` (writes `apps/mytrion-crm/app/`), then commit `apps/mytrion-crm/app` so the
   Dockerfile ships it (see the repo's `render-builds-from-dockerfile` note: the Docker runtime stage
   copies `apps/mytrion-crm/app`).
4. Confirm `Dockerfile` still `COPY --from=build /app/apps/mytrion-crm/app ./apps/mytrion-crm/app`.

---

## 10. Open decisions (confirm before/while building)

1. **Mount point**: root `/` vs `/widget` + basename (§9.1). Recommend root.
2. **Same-origin `/v1` auth** without shipping the key (§8). Backend owner decides.
3. **Admin/Manager/Finance scope**: are managers/finance **hierarchical** (retrieve across all
   departments like admin, `allDepartments:true`) or own-slug only? Sets their `department_scope`.
   (Manager's `allDepartments` is currently `false`.)
4. **New Mytrions** (retention/verification/manager) ship as **stubs** now; real panels later.

---

## 11. Claude Design — next steps

1. Fill real profile/role/user names in `mytrions.config.ts`.
2. Build per-Mytrion panels following the porting map (§6), reusing the existing widgets' logic.
3. Wire deployment (§9): mount point + SPA fallback + rebuild + vendor `apps/mytrion-crm/app`.
4. (If chosen) implement HMAC verify on the backend for `sig`/`ts` (§8).

**File map of the skeleton**

```
apps/mytrion-crm/src/context/    userContext.ts, UserContextProvider.tsx
apps/mytrion-crm/src/access/     mytrions.config.ts, resolveAccess.ts, normalizeDept.ts
apps/mytrion-crm/src/app/        router.tsx, Landing.tsx, MytrionPicker.tsx(+css), MytrionGuard.tsx, Forbidden.tsx, NotFound.tsx
apps/mytrion-crm/src/mytrions/   registry.ts, _shared/MytrionShell.tsx(+css), _shared/MytrionScaffold.tsx, <8 ids>/index.tsx
apps/mytrion-crm/src/api/        transport.ts, stream.ts, config.ts, chat.ts   (refactored same-origin)
apps/mytrion-crm/src/features/chat/  (reused as-is; ChatPanel/useChat now take UserContext + department)
```
