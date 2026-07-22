# Mytrion portal (React + TS)

The standalone multi-Mytrion web app for Octane workers: one React SPA hosting a **Mytrion**
(department workspace) per team — Sales, Billing, Finance, Customer Service, Retention,
Verification, Collection, Admin, Manager, Analyst — each lazy-loaded behind an access check.
Workers sign in with their **own Zoho account** (OAuth authorization-code flow handled by the
backend); the backend mints a Bearer session carrying the *verified* identity, and all data calls
go same-origin to the Mytrion Ops backend at `/v1/*`.

> This replaced two earlier models: the single Zoho-SDK chat **widget** (Embedded App SDK,
> `ZOHO.CRM.HTTP` proxy, org variables, zet packaging — all deleted) and the URL-param identity
> shim (spoofable `?uid=…` values — superseded by the OAuth session). See `ARCHITECTURE.md`.

## How it works

**Auth / identity**
- `src/api/auth.ts` — `beginZohoLogin()` redirects to the backend's Zoho OAuth start;
  `completeZohoCallbackIfPresent()` finishes the code exchange and stores the session.
- `src/api/session.ts` — persists `{ accessToken, refreshToken, worker }` in localStorage
  (`octane.session.v1`); `worker` is the backend-verified identity (zohoUserId, userName,
  profile, role).
- `src/api/transport.ts` — every request sends `Authorization: Bearer <accessToken>` and
  transparently refreshes on 401. In `vite dev` an `x-api-key` (`VITE_API_KEY`) fallback exists.
- `src/context/UserContextProvider.tsx` — no session → `LoginGate` (sign-in screen); with a
  session, `contextFromWorker()` provides the trusted `UserContext` to the app.
- `src/api/impersonation.ts` — admin **View-as**: sends `x-act-as-zoho-user-id`; the backend
  verifies the target against the CRM directory and audits it. Non-admins can't use it.
- RBAC is **session-authoritative on the server**: department access derives from the verified
  Zoho profile/role. Client-sent department headers are legacy no-ops for signed-in users.

**Routing** (`src/app/router.tsx`)
- `/` → `Landing`: resolves accessible Mytrions (0 → `Forbidden`, 1 → auto-enter, 2+ → picker).
- `/m/:mytrion` → `MytrionGuard`: access check, then lazy-loads the module from
  `src/mytrions/registry.ts` (one code-split chunk per Mytrion).
- Access rules live in `src/access/mytrions.config.ts` (profile default + username override +
  admin bypass).

**Mytrions** (`src/mytrions/<id>/`)
- **Sales** is the flagship: `sales/redesign/` — a full multi-tab workspace (Home, Inbox,
  Tickets, Open Pool, Data Center, Create Ticket, Automations, Dashboard, Carriers) wired to
  Zoho Desk/CRM via `/v1/desk` + `/v1/data-center`, servercrm WebSockets for real-time inbox
  and ticket badges, the RingCentral softphone, and WEX/EFS automations via touchpoints.
- **Finance** has its own redesigned workspace; other Mytrions range from scoped chat shells to
  in-progress panels. Shared chrome is `src/mytrions/_shared/` + `src/features/chat/`.

**Backend transport** (`src/api/`)
- Same-origin `/v1` in production; `VITE_API_URL` points at a dev backend cross-origin.
- `stream.ts` — SSE token streaming for chat; `desk.ts`, `dataCenter.ts`, `touchpoints.ts`,
  `retention.ts`, `knowledge.ts`, … are thin typed clients per backend surface.

## Local dev

```bash
pnpm install
pnpm dev          # vite on :5173 (backend CORS allowlist includes it)
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest
pnpm build        # tsc + vite build → ./app  (the deployed web root)
```

Sign in through the real Zoho OAuth flow against your dev backend (`VITE_API_URL`), or set
`VITE_DEV_MOCK_AUTH=1` to run the UI standalone with a mock admin.

## Deployment

`pnpm build` writes `apps/mytrion-crm/app/` (relative asset base), which is **committed** — the
Docker runtime stage copies it and the backend serves it same-origin with an SPA fallback for
`/m/:mytrion` deep links. After changing the app, rebuild and commit `app/` so Render ships it.

Static export helpers (jsPDF + Mytrion pdf/excel/download utils) are vendored under
`public/vendor/mytrion/` — no runtime CDN dependencies.

## Security notes

- Identity is never client-asserted: the Bearer session is the boundary, and the backend
  re-derives role/department access from the verified Zoho profile on every request.
- Never bundle secrets: `VITE_API_KEY` is dev-only (gated behind `import.meta.env.DEV`).
- Read/unread state in localStorage is scoped per signed-in (or acted-as) user.
